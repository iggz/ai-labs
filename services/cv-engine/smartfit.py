"""
smartfit.py — SmartFit Body Sizing Processor
============================================
Analyzes a photo silhouette to estimate body proportions and recommend
HHB apparel size (S/M/L/XL). 

Privacy guarantee: 
  - Photo processed in memory only, never written to disk or database.
  - Only the size recommendation (e.g. "M") is returned.
  - No body measurements, silhouette masks, or biometric data are stored.
"""

import cv2
import numpy as np
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Generic HHB sizing thresholds based on shoulder-to-hip width ratio
# and estimated torso proportions. Calibrated for adult women.
SIZE_THRESHOLDS = {
    # shoulder_hip_ratio → size
    # ratio < 1.05 = narrow = XS/S
    # ratio 1.05–1.15 = medium = S/M
    # ratio 1.15–1.25 = wider = M/L
    # ratio > 1.25 = broad = L/XL
    "S":  (0.0,  1.08),
    "M":  (1.05, 1.18),
    "L":  (1.14, 1.28),
    "XL": (1.22, 9.99),
}

# Recommended garment size map by type
GARMENT_DEFAULTS = {
    "crop_top":  {"S": "XS/S", "M": "S/M", "L": "M/L", "XL": "L/XL"},
    "leggings":  {"S": "XS",   "M": "S",   "L": "M",   "XL": "L"},
    "hoodie":    {"S": "S",    "M": "M",   "L": "L",   "XL": "XL"},
    "shorts":    {"S": "XS",   "M": "S",   "L": "M",   "XL": "L"},
}


def _estimate_size_from_ratio(shoulder_hip_ratio: float) -> str:
    """Map shoulder-to-hip ratio to a generic size letter."""
    if shoulder_hip_ratio < 1.08:
        return "S"
    elif shoulder_hip_ratio < 1.18:
        return "M"
    elif shoulder_hip_ratio < 1.28:
        return "L"
    else:
        return "XL"


def _extract_body_proportions(image_bytes: bytes) -> Optional[dict]:
    """
    Extract shoulder-to-hip width ratio from a front-facing body photo
    using YOLOv8 pose estimation.

    Args:
        image_bytes: Raw JPEG/PNG image bytes

    Returns:
        Dict with 'shoulder_hip_ratio' and 'confidence', or None if detection fails.
        NOTE: No raw coordinates or measurements are returned from this function.
    """
    # Decode image from bytes (never touches disk)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        logger.warning("Could not decode image bytes")
        return None

    # Try to load ONNX model (DirectML or OpenCV DNN) if available
    import os
    use_onnx = os.path.exists("yolov8s-pose.onnx")
    
    if use_onnx:
        try:
            try:
                from dml_pose import DMLPoseModel
                model = DMLPoseModel("yolov8s-pose.onnx")
                logger.info(f"SmartFit: Loaded DirectML pose model ({model.device})")
            except Exception:
                from dnn_pose import OpenCVPoseModel
                model = OpenCVPoseModel("yolov8s-pose.onnx")
                logger.info(f"SmartFit: Loaded OpenCV pose model ({model.device})")
                
            result = model.predict(img)
            kps = result["keypoints"]
            confs = result["confidences"]
            # If the model returned zero keypoints, treat it as a detection failure
            if np.all(kps == 0):
                return None
        except Exception as e:
            logger.warning(f"ONNX inference failed in SmartFit: {e}. Falling back to Ultralytics.")
            use_onnx = False

    if not use_onnx:
        # Lazy-load pose model
        from ultralytics import YOLO
        import torch

        model = YOLO("yolov8s-pose.pt")
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model.to(device)

        results = model(img, verbose=False)

        if not results[0].keypoints or len(results[0].keypoints.xy) == 0:
            return None

        kps = results[0].keypoints.xy[0].cpu().numpy()       # (17, 2)
        confs = results[0].keypoints.conf[0].cpu().numpy()   # (17,)

    # COCO indices: l_shoulder=5, r_shoulder=6, l_hip=11, r_hip=12
    shoulder_conf = min(float(confs[5]), float(confs[6]))
    hip_conf      = min(float(confs[11]), float(confs[12]))

    if shoulder_conf < 0.4 or hip_conf < 0.4:
        return None  # Not enough confidence to estimate size

    shoulder_width_px = abs(float(kps[6][0]) - float(kps[5][0]))
    hip_width_px      = abs(float(kps[12][0]) - float(kps[11][0]))

    if hip_width_px < 10:  # Degenerate case guard
        return None

    ratio = shoulder_width_px / hip_width_px
    confidence = round((shoulder_conf + hip_conf) / 2.0, 2)

    # IMPORTANT: Only ratio and confidence are returned — NO coordinates or px widths
    # kps, confs → garbage collected here
    return {"shoulder_hip_ratio": round(ratio, 3), "confidence": confidence}


async def process_smartfit(payload: dict) -> dict:
    """
    Async processor for SmartFit sizing.

    Payload keys:
        image_bytes (bytes): Raw image data
        garment_types (list[str]): e.g. ["crop_top", "leggings"]

    Returns:
        recommended_sizes (dict): garment_type → size string
        confidence (float): model detection confidence
        
    NOTE: Result is returned to the caller only — NOT stored in cv_analyses table.
    """
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _process_smartfit_sync, payload)


def _process_smartfit_sync(payload: dict) -> dict:
    image_bytes: bytes = payload["image_bytes"]
    garment_types: list = payload.get("garment_types", list(GARMENT_DEFAULTS.keys()))

    proportions = _extract_body_proportions(image_bytes)

    if proportions is None:
        return {
            "success": False,
            "error": "Could not detect body proportions from this photo. "
                     "Please ensure you are standing in a front-facing, full-body view.",
            "recommended_sizes": {},
        }

    size_letter = _estimate_size_from_ratio(proportions["shoulder_hip_ratio"])

    recommended_sizes = {
        garment: GARMENT_DEFAULTS.get(garment, {}).get(size_letter, size_letter)
        for garment in garment_types
        if garment in GARMENT_DEFAULTS
    }

    # image_bytes → goes out of scope / garbage collected
    # proportions → pixel coordinates were never included

    return {
        "success": True,
        "recommended_sizes": recommended_sizes,
        "base_size": size_letter,
        "confidence": proportions["confidence"],
        "processing_log": {
            "biometric_data_persisted": False,
            "image_stored": False,
        },
    }

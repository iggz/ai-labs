"""
yolo_pose.py — YOLOv8-Pose inference via Ultralytics
=====================================================
Wraps the Ultralytics YOLO API to produce the same output dict as
OpenCVPoseModel.predict(), enabling seamless backend switching.
"""
import numpy as np
import logging
import time
logger = logging.getLogger(__name__)
class UltralyticsYOLOModel:
    """
    YOLOv8-pose inference via Ultralytics + PyTorch.
    Produces the same dict as OpenCVPoseModel.predict():
        {"keypoints": (17,2), "confidences": (17,), "bbox": tuple, "score": float}
    """
    def __init__(self, model_path: str = "yolov8s-pose.pt"):
        from ultralytics import YOLO
        import torch
        logger.info(f"Loading YOLO model from: {model_path}")
        t0 = time.perf_counter()
        self.model = YOLO(model_path)
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model.to(self.device)
        t1 = time.perf_counter()
        logger.info(f"YOLO model loaded on {self.device} in {(t1-t0)*1000:.0f}ms")
    def predict(self, frame: np.ndarray, conf_threshold: float = 0.25) -> dict:
        """Run YOLO inference, return dict matching OpenCVPoseModel.predict() format."""
        results = self.model(frame, verbose=False, conf=conf_threshold)
        if results[0].keypoints is not None and len(results[0].keypoints.xy) > 0:
            kps = results[0].keypoints.xy[0].cpu().numpy().astype(np.float32)
            confs = results[0].keypoints.conf[0].cpu().numpy().astype(np.float32)
            if results[0].boxes is not None and len(results[0].boxes.xyxy) > 0:
                bbox = tuple(results[0].boxes.xyxy[0].cpu().numpy().astype(int))
                score = float(results[0].boxes.conf[0].cpu())
            else:
                bbox = (0, 0, 0, 0)
                score = 0.0
        else:
            kps = np.zeros((17, 2), dtype=np.float32)
            confs = np.zeros(17, dtype=np.float32)
            bbox = (0, 0, 0, 0)
            score = 0.0
        return {"keypoints": kps, "confidences": confs, "bbox": bbox, "score": score}

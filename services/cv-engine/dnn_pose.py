"""
dnn_pose.py — OpenCV DNN YOLOv8-Pose Inference
================================================
Drop-in replacement for Ultralytics YOLO pose inference.
Uses cv2.dnn.readNetFromONNX() with pure OpenCV post-processing.
Zero dependency on PyTorch, torchvision, or ultralytics.
"""
import cv2
import numpy as np
import logging
import time

logger = logging.getLogger(__name__)

MODEL_INPUT_SIZE = 640
CONF_THRESHOLD = 0.25
NMS_THRESHOLD = 0.45


class OpenCVPoseModel:
    """
    YOLOv8-pose inference via OpenCV DNN.

    Produces the same (17, 2) keypoints and (17,) confidences arrays
    as the Ultralytics YOLO model, but without PyTorch.
    """

    def __init__(self, onnx_path: str = "yolov8s-pose.onnx"):
        logger.info(f"Loading ONNX model from: {onnx_path}")
        t0 = time.perf_counter()
        self.net = cv2.dnn.readNetFromONNX(onnx_path)
        self.conf_threshold = CONF_THRESHOLD
        self._select_backend()
        t1 = time.perf_counter()
        self.load_time_ms = round((t1 - t0) * 1000, 1)
        logger.info(
            f"OpenCV DNN model loaded on {self.device} in {self.load_time_ms:.0f}ms"
        )

    def _select_backend(self):
        """Auto-select best available DNN backend."""
        # Try CUDA first (Linux with NVIDIA)
        try:
            self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
            self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA)
            # Test with a dummy forward pass to confirm CUDA works
            dummy = np.zeros((1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE), dtype=np.float32)
            self.net.setInput(dummy)
            self.net.forward()
            self.device = "cuda"
            return
        except Exception:
            pass

        # OpenCL (works on some platforms)
        try:
            if cv2.ocl.haveOpenCL():
                self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_OPENCL)
                self.device = "opencl"
                return
        except Exception:
            pass

        # CPU fallback (always works)
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.device = "cpu"

    def _letterbox(self, img: np.ndarray) -> tuple:
        """
        Resize with aspect-ratio-preserving padding.

        Returns:
            (padded_img, scale_ratio, (pad_w, pad_h))

        The scale_ratio and pad offsets are needed to map output coordinates
        back to the original image space.
        """
        shape = img.shape[:2]  # (height, width)
        new_shape = (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

        # Scale ratio: pick the smaller ratio so the image fits inside the square
        r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])

        # New unpadded dimensions (what the image looks like after scaling, before padding)
        new_unpad_w = int(round(shape[1] * r))
        new_unpad_h = int(round(shape[0] * r))

        # Padding needed on each side
        dw = (new_shape[1] - new_unpad_w) / 2.0
        dh = (new_shape[0] - new_unpad_h) / 2.0

        if shape[1] != new_unpad_w or shape[0] != new_unpad_h:
            img = cv2.resize(img, (new_unpad_w, new_unpad_h), interpolation=cv2.INTER_LINEAR)

        # Add border padding — YOLOv8 uses (114, 114, 114) gray
        top = int(round(dh - 0.1))
        bottom = int(round(dh + 0.1))
        left = int(round(dw - 0.1))
        right = int(round(dw + 0.1))
        img = cv2.copyMakeBorder(
            img, top, bottom, left, right,
            cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )

        return img, r, (dw, dh)

    def _postprocess(self, output: np.ndarray, scale: float, pad: tuple) -> dict | None:
        """
        Parse YOLOv8-pose raw output tensor.

        Args:
            output: Raw model output, shape (1, 56, 8400)
            scale:  Scale ratio from letterbox (r)
            pad:    (dw, dh) padding offsets from letterbox

        Returns:
            Best detection dict, or None if no person found.

        YOLOv8-Pose output tensor layout (after transpose to (8400, 56)):
            [0:4]   — Bounding box: cx, cy, w, h
            [4]     — Object confidence score
            [5:56]  — 17 keypoints × 3: (kp_x, kp_y, kp_visibility)
        """
        # Step 1: Reshape — (1, 56, 8400) → (8400, 56)
        predictions = np.squeeze(output).T

        # Step 2: Filter by confidence — column index 4
        scores = predictions[:, 4]
        mask = scores > self.conf_threshold
        predictions = predictions[mask]
        scores = scores[mask]

        if len(predictions) == 0:
            return None

        # Step 3: Extract bounding boxes for NMS
        # Columns 0-3: cx, cy, w, h (center format)
        # Convert to x1, y1, w, h format for cv2.dnn.NMSBoxes
        boxes_for_nms = []
        for pred in predictions[:, :4]:
            cx, cy, w, h = pred
            x1 = cx - w / 2
            y1 = cy - h / 2
            boxes_for_nms.append([float(x1), float(y1), float(w), float(h)])

        # Step 4: Non-Maximum Suppression
        indices = cv2.dnn.NMSBoxes(
            boxes_for_nms,
            scores.tolist(),
            self.conf_threshold,
            NMS_THRESHOLD,
        )

        if len(indices) == 0:
            return None

        # Step 5: Take the highest-confidence detection
        # NMSBoxes returns indices — handle both old and new OpenCV formats
        best_idx = indices[0] if isinstance(indices[0], (int, np.integer)) else indices[0][0]

        dw, dh = pad

        # Step 6: Extract bounding box in original image coordinates
        cx, cy, w, h = predictions[best_idx, :4]
        bbox = (
            float((cx - w / 2 - dw) / scale),  # x1
            float((cy - h / 2 - dh) / scale),  # y1
            float((cx + w / 2 - dw) / scale),  # x2
            float((cy + h / 2 - dh) / scale),  # y2
        )

        # Step 7: Extract 17 keypoints from columns 5:56
        # Layout: [kp0_x, kp0_y, kp0_vis, kp1_x, kp1_y, kp1_vis, ...]
        raw_kpts = predictions[best_idx, 5:56].reshape(17, 3)

        keypoints = np.zeros((17, 2), dtype=np.float32)
        confidences = np.zeros(17, dtype=np.float32)

        for j in range(17):
            # Map from letterbox space → original image space
            kx = (raw_kpts[j, 0] - dw) / scale
            ky = (raw_kpts[j, 1] - dh) / scale
            kvis = raw_kpts[j, 2]

            keypoints[j] = [kx, ky]
            confidences[j] = kvis

        return {
            "keypoints": keypoints,       # (17, 2) float32
            "confidences": confidences,   # (17,) float32
            "bbox": bbox,
            "score": float(scores[best_idx]),
        }

    def predict(self, frame: np.ndarray, conf_threshold: float = 0.25) -> dict:
        """
        Run full inference pipeline on a single BGR frame.

        Returns:
            dict with:
                "keypoints": np.ndarray shape (17, 2) — pixel coords in original frame space
                "confidences": np.ndarray shape (17,) — per-keypoint visibility scores
                "bbox": tuple (x1, y1, x2, y2) — bounding box in original frame space
                "score": float — detection confidence
        """
        t0 = time.perf_counter()

        # Update confidence threshold if caller overrides
        self.conf_threshold = conf_threshold

        # Letterbox
        letterboxed, scale, pad = self._letterbox(frame)

        # Create blob
        blob = cv2.dnn.blobFromImage(
            letterboxed,
            scalefactor=1.0 / 255.0,   # Normalize [0,255] → [0,1]
            size=(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
            mean=(0, 0, 0),             # YOLOv8 has NO mean subtraction
            swapRB=True,                # OpenCV loads BGR, model expects RGB
            crop=False,                 # Already letterboxed — do NOT crop
        )

        # Forward pass
        self.net.setInput(blob)
        output = self.net.forward()  # shape: (1, 56, 8400)

        # Post-process
        result = self._postprocess(output, scale, pad)

        # Track per-call inference time (essentially free)
        self._last_predict_ms = round((time.perf_counter() - t0) * 1000, 2)

        if result is None:
            return {
                "keypoints": np.zeros((17, 2), dtype=np.float32),
                "confidences": np.zeros(17, dtype=np.float32),
                "bbox": (0, 0, 0, 0),
                "score": 0.0,
            }

        return result

"""
dml_pose.py — DirectML YOLOv8-Pose Inference via ONNX Runtime
==============================================================
Provides hardware-accelerated YOLOv8-pose inference on Windows using AMD GPUs
via the ONNX Runtime DirectML Execution Provider.
Matches the output interface of OpenCVPoseModel.
"""
import cv2
import numpy as np
import logging
import time
import onnxruntime as ort

logger = logging.getLogger(__name__)

MODEL_INPUT_SIZE = 640
CONF_THRESHOLD = 0.25
NMS_THRESHOLD = 0.45


class DMLPoseModel:
    """
    YOLOv8-pose inference via ONNX Runtime + DirectML.

    Produces the same (17, 2) keypoints and (17,) confidences arrays
    as OpenCVPoseModel, enabling seamless drop-in acceleration on AMD GPUs.
    """

    def __init__(self, onnx_path: str = "yolov8s-pose.onnx", use_dml: bool = True):
        logger.info(f"Loading ONNX model for ONNX Runtime from: {onnx_path}")
        t0 = time.perf_counter()

        # Check for DirectML provider availability
        available_providers = ort.get_available_providers()
        logger.info(f"Available ONNX Runtime Providers: {available_providers}")

        providers = []
        if use_dml and "DmlExecutionProvider" in available_providers:
            # DirectML GPU acceleration
            providers = ["DmlExecutionProvider", "CPUExecutionProvider"]
            self.device = "dml"
        else:
            if use_dml:
                logger.warning("DmlExecutionProvider not available. Falling back to CPU.")
            providers = ["CPUExecutionProvider"]
            self.device = "cpu"

        # Load session with preferred execution providers
        self.session = ort.InferenceSession(onnx_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        self.conf_threshold = CONF_THRESHOLD

        t1 = time.perf_counter()
        logger.info(
            f"ONNX Runtime model loaded on {self.device} in {(t1-t0)*1000:.0f}ms"
        )

    def _letterbox(self, img: np.ndarray) -> tuple:
        """
        Resize with aspect-ratio-preserving padding.

        Returns:
            (padded_img, scale_ratio, (pad_w, pad_h))
        """
        shape = img.shape[:2]  # (height, width)
        new_shape = (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

        # Scale ratio
        r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])

        # New unpadded dimensions
        new_unpad_w = int(round(shape[1] * r))
        new_unpad_h = int(round(shape[0] * r))

        # Padding needed on each side
        dw = (new_shape[1] - new_unpad_w) / 2.0
        dh = (new_shape[0] - new_unpad_h) / 2.0

        if shape[1] != new_unpad_w or shape[0] != new_unpad_h:
            img = cv2.resize(img, (new_unpad_w, new_unpad_h), interpolation=cv2.INTER_LINEAR)

        # Add border padding
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

        # Step 3: Extract bounding boxes for NMS (x1, y1, w, h format)
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
        Run inference on a single BGR frame.
        """
        self.conf_threshold = conf_threshold

        # Preprocess
        letterboxed, scale, pad = self._letterbox(frame)

        # Create blob: [0, 255] -> [0, 1], Swap BGR to RGB
        blob = cv2.dnn.blobFromImage(
            letterboxed,
            scalefactor=1.0 / 255.0,
            size=(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
            mean=(0, 0, 0),
            swapRB=True,
            crop=False,
        )

        # Run ONNX Runtime session
        outputs = self.session.run([self.output_name], {self.input_name: blob})
        output = outputs[0]

        # Postprocess
        result = self._postprocess(output, scale, pad)

        if result is None:
            return {
                "keypoints": np.zeros((17, 2), dtype=np.float32),
                "confidences": np.zeros(17, dtype=np.float32),
                "bbox": (0, 0, 0, 0),
                "score": 0.0,
            }

        return result

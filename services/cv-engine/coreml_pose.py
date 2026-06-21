"""
coreml_pose.py — CoreML YOLOv8-Pose Inference via Apple Neural Engine
======================================================================
Provides hardware-accelerated YOLOv8-pose inference on Apple Silicon Macs
using CoreML with compute_units=ALL, targeting the Neural Engine (ANE).
Matches the output interface of OpenCVPoseModel and DMLPoseModel exactly.

Expected model: yolov8s-pose.mlpackage (exported via export_coreml.py)
"""
import cv2
import numpy as np
import logging
import time

logger = logging.getLogger(__name__)

MODEL_INPUT_SIZE = 640
CONF_THRESHOLD   = 0.25
NMS_THRESHOLD    = 0.45


class CoreMLPoseModel:
    """
    YOLOv8-pose inference via CoreML + Apple Neural Engine.

    Produces the same (17, 2) keypoints and (17,) confidences arrays
    as OpenCVPoseModel and DMLPoseModel, enabling seamless drop-in
    acceleration on Apple Silicon.
    """

    def __init__(self, mlpackage_path: str = "yolov8s-pose.mlpackage"):
        import coremltools as ct

        logger.info(f"Loading CoreML model from: {mlpackage_path}")
        t0 = time.perf_counter()

        # ALL targets ANE → GPU → CPU in priority order
        self.model = ct.models.MLModel(
            mlpackage_path,
            compute_units=ct.ComputeUnit.ALL,
        )

        # Inspect I/O names from the model spec (set at export time)
        spec = self.model.get_spec()
        self._input_name  = spec.description.input[0].name
        self._output_name = spec.description.output[0].name

        self.conf_threshold   = CONF_THRESHOLD
        self._last_predict_ms: float = 0.0   # per-frame timing, matches interface

        self.device = "ane"

        t1 = time.perf_counter()
        logger.info(
            f"CoreML model loaded on {self.device} in {(t1 - t0) * 1000:.0f}ms "
            f"| input='{self._input_name}' output='{self._output_name}'"
        )

    # ── Pre-processing ─────────────────────────────────────────────────────────

    def _letterbox(self, img: np.ndarray) -> tuple:
        """
        Aspect-ratio-preserving resize + gray padding to MODEL_INPUT_SIZE.

        Returns:
            (padded_img, scale_ratio, (pad_w, pad_h))
        """
        shape     = img.shape[:2]          # (H, W)
        new_shape = (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

        r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])

        new_unpad_w = int(round(shape[1] * r))
        new_unpad_h = int(round(shape[0] * r))

        dw = (new_shape[1] - new_unpad_w) / 2.0
        dh = (new_shape[0] - new_unpad_h) / 2.0

        if shape[1] != new_unpad_w or shape[0] != new_unpad_h:
            img = cv2.resize(img, (new_unpad_w, new_unpad_h), interpolation=cv2.INTER_LINEAR)

        top    = int(round(dh - 0.1))
        bottom = int(round(dh + 0.1))
        left   = int(round(dw - 0.1))
        right  = int(round(dw + 0.1))
        img = cv2.copyMakeBorder(
            img, top, bottom, left, right,
            cv2.BORDER_CONSTANT, value=(114, 114, 114),
        )

        return img, r, (dw, dh)

    def _preprocess(self, letterboxed: np.ndarray) -> np.ndarray:
        """
        BGR letterboxed frame → float32 NCHW RGB tensor in [0, 1].
        Shape: (1, 3, 640, 640)
        """
        img_rgb   = cv2.cvtColor(letterboxed, cv2.COLOR_BGR2RGB)
        img_float = img_rgb.astype(np.float32) / 255.0
        img_nchw  = np.transpose(img_float, (2, 0, 1))[np.newaxis, ...]  # (1, 3, H, W)
        return img_nchw

    # ── Post-processing ────────────────────────────────────────────────────────

    def _postprocess(self, output: np.ndarray, scale: float, pad: tuple) -> dict | None:
        """
        Parse YOLOv8-pose raw output tensor (1, 56, 8400) → keypoints dict.
        Identical logic to DMLPoseModel._postprocess().
        """
        # (1, 56, 8400) → (8400, 56)
        predictions = np.squeeze(output).T

        # Filter by objectness score (col 4)
        scores = predictions[:, 4]
        mask   = scores > self.conf_threshold
        predictions = predictions[mask]
        scores      = scores[mask]

        if len(predictions) == 0:
            return None

        # Build boxes for NMS (x1, y1, w, h format)
        boxes_for_nms = []
        for pred in predictions[:, :4]:
            cx, cy, w, h = pred
            boxes_for_nms.append([float(cx - w / 2), float(cy - h / 2), float(w), float(h)])

        indices = cv2.dnn.NMSBoxes(
            boxes_for_nms,
            scores.tolist(),
            self.conf_threshold,
            NMS_THRESHOLD,
        )

        if len(indices) == 0:
            return None

        best_idx = indices[0] if isinstance(indices[0], (int, np.integer)) else indices[0][0]

        dw, dh = pad

        # Bounding box in original image coordinates
        cx, cy, w, h = predictions[best_idx, :4]
        bbox = (
            float((cx - w / 2 - dw) / scale),
            float((cy - h / 2 - dh) / scale),
            float((cx + w / 2 - dw) / scale),
            float((cy + h / 2 - dh) / scale),
        )

        # 17 keypoints: columns 5:56 → (17, 3) [x, y, visibility]
        raw_kpts    = predictions[best_idx, 5:56].reshape(17, 3)
        keypoints   = np.zeros((17, 2), dtype=np.float32)
        confidences = np.zeros(17, dtype=np.float32)

        for j in range(17):
            keypoints[j]   = [(raw_kpts[j, 0] - dw) / scale, (raw_kpts[j, 1] - dh) / scale]
            confidences[j] = raw_kpts[j, 2]

        return {
            "keypoints":   keypoints,    # (17, 2) float32
            "confidences": confidences,  # (17,)  float32
            "bbox":        bbox,
            "score":       float(scores[best_idx]),
        }

    # ── Public inference API ───────────────────────────────────────────────────

    def predict(self, frame: np.ndarray, conf_threshold: float = 0.25) -> dict:
        """
        Run CoreML/ANE inference on a single BGR frame.
        Returns the same dict format as OpenCVPoseModel.predict().
        """
        self.conf_threshold = conf_threshold

        # Pre-process
        letterboxed, scale, pad = self._letterbox(frame)
        input_tensor = self._preprocess(letterboxed)

        # Run CoreML inference (ANE dispatch is internal to the runtime)
        t_infer = time.perf_counter()
        preds   = self.model.predict({self._input_name: input_tensor})
        self._last_predict_ms = (time.perf_counter() - t_infer) * 1000.0

        # Extract the raw output array
        output = preds[self._output_name]  # (1, 56, 8400) float32

        # Post-process
        result = self._postprocess(output, scale, pad)

        if result is None:
            return {
                "keypoints":   np.zeros((17, 2), dtype=np.float32),
                "confidences": np.zeros(17, dtype=np.float32),
                "bbox":        (0, 0, 0, 0),
                "score":       0.0,
            }

        return result

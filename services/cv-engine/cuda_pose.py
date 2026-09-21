"""
cuda_pose.py — High-Performance NVIDIA CUDA/TensorRT YOLO Pose Inference
========================================================================
Accelerates YOLO pose estimation (YOLO11 / YOLOv8) on NVIDIA GPUs (such as the
RTX 5090 Blackwell) using TensorRT and CUDA execution providers.

Matches the exact interface of OpenCVPoseModel and DMLPoseModel:
  predict(frame, conf_threshold) -> {
      "keypoints": (17, 2) float32,
      "confidences": (17,) float32,
      "bbox": (x1, y1, x2, y2),
      "score": float
  }
"""

import os
import time
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)

MODEL_INPUT_SIZE = 640
CONF_THRESHOLD = 0.25
NMS_THRESHOLD = 0.45


class CUDAPoseModel:
    """
    Hardware-accelerated YOLO pose estimation on NVIDIA GPUs.
    Supports ONNX Runtime (TensorRT / CUDA EP) and Ultralytics PyTorch/Engine.
    """

    def __init__(self, model_path: str = "yolov8s-pose.onnx", prefer_tensorrt: bool = True):
        self.conf_threshold = CONF_THRESHOLD
        self._last_predict_ms: float = 0.0
        self.device = "cuda"
        self._backend_type = None

        t0 = time.perf_counter()
        logger.info(f"Loading CUDA pose model from: {model_path}")

        # Check if the model is an Ultralytics .pt or .engine file
        if model_path.endswith(".pt") or model_path.endswith(".engine"):
            self._init_ultralytics(model_path)
        else:
            # ONNX model via ONNX Runtime with TensorRT / CUDA providers
            self._init_onnxruntime(model_path, prefer_tensorrt)

        t1 = time.perf_counter()
        logger.info(f"CUDA pose model loaded [{self._backend_type}] on {self.device} in {(t1 - t0)*1000:.0f}ms")

    def _init_ultralytics(self, model_path: str):
        """Load via Ultralytics YOLO with CUDA acceleration."""
        try:
            import torch
            from ultralytics import YOLO

            if not torch.cuda.is_available():
                logger.warning("torch.cuda is not available; falling back to CPU.")
                self.device = "cpu"
            else:
                self.device = f"cuda:{torch.cuda.current_device()}"

            self.model = YOLO(model_path)
            self._backend_type = "ultralytics_engine" if model_path.endswith(".engine") else "ultralytics_pt"
        except Exception as exc:
            logger.error(f"Failed to initialize Ultralytics CUDA model: {exc}")
            raise

    def _init_onnxruntime(self, onnx_path: str, prefer_tensorrt: bool):
        """Load via ONNX Runtime with TensorRT / CUDA execution provider."""
        import onnxruntime as ort

        available_providers = ort.get_available_providers()
        logger.info(f"Available ONNX Runtime providers: {available_providers}")

        providers = []
        if prefer_tensorrt and "TensorrtExecutionProvider" in available_providers:
            # FP16 → Tensor Cores; engine cache → build once (minutes), not on every restart
            providers.append(("TensorrtExecutionProvider", {
                "trt_fp16_enable": True,
                "trt_engine_cache_enable": True,
                "trt_engine_cache_path": "trt_cache",
            }))
        if "CUDAExecutionProvider" in available_providers:
            providers.append("CUDAExecutionProvider")
        if not providers:
            logger.warning("Neither TensorrtExecutionProvider nor CUDAExecutionProvider found. Falling back to CPU.")
        providers.append("CPUExecutionProvider")

        # Configure session options
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.session = ort.InferenceSession(onnx_path, sess_options=sess_options, providers=providers)
        # ORT silently drops an EP that fails to load (e.g. TensorRT DLLs missing) — record what actually won
        active = self.session.get_providers()[0]
        self.device = {"TensorrtExecutionProvider": "tensorrt", "CUDAExecutionProvider": "cuda"}.get(active, "cpu")
        self._backend_type = f"ort_{self.device}"
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def _letterbox(self, img: np.ndarray) -> tuple:
        """Resize with aspect-ratio-preserving padding to 640x640."""
        shape = img.shape[:2]
        new_shape = (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
        r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])

        new_unpad_w = int(round(shape[1] * r))
        new_unpad_h = int(round(shape[0] * r))

        dw = (new_shape[1] - new_unpad_w) / 2.0
        dh = (new_shape[0] - new_unpad_h) / 2.0

        if shape[1] != new_unpad_w or shape[0] != new_unpad_h:
            img = cv2.resize(img, (new_unpad_w, new_unpad_h), interpolation=cv2.INTER_LINEAR)

        top = int(round(dh - 0.1))
        bottom = int(round(dh + 0.1))
        left = int(round(dw - 0.1))
        right = int(round(dw + 0.1))
        img = cv2.copyMakeBorder(
            img, top, bottom, left, right,
            cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )
        return img, r, (dw, dh)

    def _postprocess_ort(self, output: np.ndarray, scale: float, pad: tuple) -> dict | None:
        """Parse YOLO pose raw output tensor (1, 56, 8400)."""
        predictions = np.squeeze(output).T  # (8400, 56)

        scores = predictions[:, 4]
        mask = scores > self.conf_threshold
        predictions = predictions[mask]
        scores = scores[mask]

        if len(predictions) == 0:
            return None

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

        cx, cy, w, h = predictions[best_idx, :4]
        bbox = (
            float((cx - w / 2 - dw) / scale),
            float((cy - h / 2 - dh) / scale),
            float((cx + w / 2 - dw) / scale),
            float((cy + h / 2 - dh) / scale),
        )

        raw_kpts = predictions[best_idx, 5:56].reshape(17, 3)
        keypoints = np.zeros((17, 2), dtype=np.float32)
        confidences = np.zeros(17, dtype=np.float32)

        for j in range(17):
            keypoints[j] = [(raw_kpts[j, 0] - dw) / scale, (raw_kpts[j, 1] - dh) / scale]
            confidences[j] = raw_kpts[j, 2]

        return {
            "keypoints": keypoints,
            "confidences": confidences,
            "bbox": bbox,
            "score": float(scores[best_idx]),
        }

    def predict(self, frame: np.ndarray, conf_threshold: float = 0.25) -> dict:
        """Run inference on a single BGR frame."""
        self.conf_threshold = conf_threshold
        empty_res = {
            "keypoints": np.zeros((17, 2), dtype=np.float32),
            "confidences": np.zeros(17, dtype=np.float32),
            "bbox": (0, 0, 0, 0),
            "score": 0.0,
        }

        t_start = time.perf_counter()

        if self._backend_type and self._backend_type.startswith("ultralytics"):
            # Direct Ultralytics path
            results = self.model(
                frame,
                conf=conf_threshold,
                device=self.device if "cuda" in self.device else "cpu",
                verbose=False,
                half=True if "cuda" in self.device else False,
            )
            self._last_predict_ms = (time.perf_counter() - t_start) * 1000.0

            if not results or len(results) == 0 or results[0].keypoints is None:
                return empty_res

            res = results[0]
            if res.keypoints.data is None or len(res.keypoints.data) == 0:
                return empty_res

            # Extract first detection
            kpts = res.keypoints.xy[0].cpu().numpy().astype(np.float32)
            confs = (
                res.keypoints.conf[0].cpu().numpy().astype(np.float32)
                if res.keypoints.conf is not None
                else np.ones(17, dtype=np.float32)
            )

            box = (0, 0, 0, 0)
            score = 0.0
            if res.boxes is not None and len(res.boxes) > 0:
                xyxy = res.boxes.xyxy[0].cpu().numpy()
                box = (float(xyxy[0]), float(xyxy[1]), float(xyxy[2]), float(xyxy[3]))
                score = float(res.boxes.conf[0].cpu().numpy())

            return {
                "keypoints": kpts,
                "confidences": confs,
                "bbox": box,
                "score": score,
            }
        else:
            # ONNX Runtime (TensorRT / CUDA EP)
            letterboxed, scale, pad = self._letterbox(frame)
            blob = cv2.dnn.blobFromImage(
                letterboxed,
                scalefactor=1.0 / 255.0,
                size=(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
                mean=(0, 0, 0),
                swapRB=True,
                crop=False,
            )

            outputs = self.session.run([self.output_name], {self.input_name: blob})
            self._last_predict_ms = (time.perf_counter() - t_start) * 1000.0

            result = self._postprocess_ort(outputs[0], scale, pad)
            return result if result is not None else empty_res

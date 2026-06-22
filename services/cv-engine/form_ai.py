"""
form_ai.py — FormAI Pose Analysis Processor
=============================================
Analyzes squat, deadlift, and hip thrust mechanics from uploaded video.
Privacy guarantee: keypoints and raw angles are NEVER written to the database.
Only non-biometric metadata (rep_count, duration_sec, exercise_type) is returned
for storage.

Feature 5: Supports exercise_type='auto' — uses ExerciseClassifier on the first
           60 frames to detect squat/deadlift/hip_thrust automatically.
Feature 7: CameraAngleDetector examines the first 30 frames to classify the
           filming angle and flag stats with reduced accuracy.
Feature 8: overlay_mode ('full'|'minimal') flows through to overlay functions.
"""

# ── Standard library ──────────────────────────────────────────────────────────
import sys
import cv2
import numpy as np
import tempfile
import os
import logging
import time
from typing import Generator
from server_info import get_server_info

# ── Analysis modules ─────────────────────────────────────────────────────────
from smoother import KeypointSmoother
from angle_utils import (
    estimate_camera_elevation_angle,
    get_exercise_angle,
    count_reps,
    compute_session_stats,
)
from exercise_classifier import ExerciseClassifier
from camera_angle import CameraAngleDetector

# ── Enhancement modules (optical flow, lens correction) ──────────────────────
from optical_flow_tracker import OpticalFlowTracker
from lens_correction import LensCorrector

# ── Rendering & encoding ─────────────────────────────────────────────────────
from overlay import create_neon_skeleton_frame, draw_rom_gauge, draw_rep_counter
from ffmpeg_writer import FFmpegPipeWriter

logger = logging.getLogger(__name__)

from dnn_pose import OpenCVPoseModel

_opencv_model  = None
_yolo_model    = None
_dml_model     = None
_coreml_model  = None
_cuda_model    = None


def _get_pose_model(protocol: str = "opencv"):
    """Lazy-load and cache the requested inference backend."""
    global _opencv_model, _yolo_model, _dml_model, _coreml_model, _cuda_model
    if protocol == "opencv":
        if _opencv_model is None:
            _opencv_model = OpenCVPoseModel("yolov8s-pose.onnx")
            logger.info(f"OpenCV DNN model loaded on: {_opencv_model.device}")
        return _opencv_model
    elif protocol == "yolo":
        if _yolo_model is None:
            if sys.platform == "darwin":
                # macOS Apple Silicon → CoreML / Apple Neural Engine
                from coreml_pose import CoreMLPoseModel
                _yolo_model = CoreMLPoseModel("yolov8s-pose.mlpackage")
                logger.info(f"CoreML model loaded on: {_yolo_model.device}")
            else:
                # Windows / Linux → Ultralytics + PyTorch (MPS or CPU)
                from yolo_pose import UltralyticsYOLOModel
                _yolo_model = UltralyticsYOLOModel("yolov8s-pose.pt")
                logger.info(f"Ultralytics YOLO model loaded on: {_yolo_model.device}")
        return _yolo_model
    elif protocol == "dml":
        if _dml_model is None:
            from dml_pose import DMLPoseModel
            _dml_model = DMLPoseModel("yolov8s-pose.onnx")
            logger.info(f"DirectML model loaded on: {_dml_model.device}")
        return _dml_model
    elif protocol == "cuda":
        if _cuda_model is None:
            raise NotImplementedError(
                "CUDA backend not yet available on this machine. "
                "Deploy cv-engine on the NVIDIA laptop to enable this protocol."
            )
        return _cuda_model
    else:
        raise ValueError(f"Unknown protocol: {protocol}")


def _iter_frames(video_path: str) -> Generator[np.ndarray, None, None]:
    cap = cv2.VideoCapture(video_path)
    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            yield frame
    finally:
        cap.release()


async def process_form_ai(payload: dict) -> dict:
    """
    Async processor for FormAI analysis.

    Payload keys:
        video_bytes   (bytes): Raw video data
        filename      (str):   Original filename
        exercise_type (str):   'squat' | 'deadlift' | 'hip_thrust'

    Returns non-biometric metadata dict only.
    Annotated video bytes are returned for Supabase storage upload by main.py.
    """
    import asyncio

    # Run CPU/GPU-bound processing in a thread to not block the event loop
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _process_form_ai_sync, payload)


def _process_form_ai_sync(payload: dict) -> dict:
    """Synchronous core — runs in executor thread."""
    video_bytes: bytes = payload["video_bytes"]
    exercise_type: str = payload.get("exercise_type", "squat")
    overlay_mode: str  = payload.get("overlay_mode", "full")
    protocol: str      = payload.get("protocol", "opencv")
    filename: str      = payload.get("filename", "input.mp4")
    debug = payload.get("debug", False)

    t_model = time.perf_counter()
    was_cached = (
        (_opencv_model is not None) if protocol == "opencv"
        else (_yolo_model is not None) if protocol == "yolo"
        else (_dml_model is not None) if protocol == "dml"
        else False
    )
    pose_model = _get_pose_model(protocol)
    model_load_ms = round((time.perf_counter() - t_model) * 1000, 1)
    smoother = KeypointSmoother(num_keypoints=17, max_interpolation_frames=8)

    # Write video to temp file for OpenCV
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
        tmp_in.write(video_bytes)
        input_path = tmp_in.name

    try:
        t_start = time.perf_counter()
        cap = cv2.VideoCapture(input_path)
        fps = max(1, int(cap.get(cv2.CAP_PROP_FPS)))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        # ── Per-frame processing ─────────────────────────────────────────────
        # These lists exist ONLY in local scope — never serialized to DB
        angles_per_frame: list[float | None] = []
        confidences_per_frame: list[float] = []
        camera_elevations: list[float] = []
        keypoints_history: list[np.ndarray] = []  # (17, 2) per frame — ephemeral

        # Accumulators for auto-detection classifiers (Feature 5 & 7)
        clf_kps_seq:   list[np.ndarray] = []  # first 60 frames for exercise classifier
        clf_confs_seq: list[np.ndarray] = []  # corresponding confidences
        cam_kps_seq:   list[np.ndarray] = []  # first 30 frames for camera angle detector
        cam_confs_seq: list[np.ndarray] = []

        # Optical flow + lens correction for improved keypoint accuracy
        of_tracker = OpticalFlowTracker(num_keypoints=17)
        fov = LensCorrector.detect_fov_preset(w, h)
        lens = LensCorrector(w, h, fov_preset=fov)
        logger.info(f"Lens correction: fov={fov}, enabled={lens.enabled}")
        # Hybrid cache — store per-frame data for zero-inference Pass 2
        raw_confs_cache: list[np.ndarray] = []
        smoothed_kps_cache: list[np.ndarray] = []

        frame_times_ms = []  # Per-frame inference timing
        frame_idx = 0
        for frame in _iter_frames(input_path):
            result = pose_model.predict(frame)
            frame_times_ms.append(pose_model._last_predict_ms)
            raw_kps = result["keypoints"]
            raw_confs = result["confidences"]

            # Optical flow fills in occluded keypoints, then lens correction
            flow_kps = of_tracker.track(frame, raw_kps, raw_confs)
            flow_kps = lens.correct_keypoints(flow_kps)
            smoothed_kps = smoother.update(flow_kps, raw_confs)
            # Cache for zero-inference render pass
            raw_confs_cache.append(raw_confs.copy())
            smoothed_kps_cache.append(smoothed_kps.copy())

            # Collect frames for auto-detection classifiers (Feature 5 & 7)
            if frame_idx < 60:
                clf_kps_seq.append(smoothed_kps.copy())
                clf_confs_seq.append(raw_confs.copy())
            if frame_idx < 30:
                cam_kps_seq.append(smoothed_kps.copy())
                cam_confs_seq.append(raw_confs.copy())

            # ── Feature 5: Resolve exercise type from auto-detection ────────
            # Deferred until we have enough frames (runs once after frame 60)
            if frame_idx == 60 and exercise_type == "auto":
                clf_result = ExerciseClassifier().classify(clf_kps_seq, clf_confs_seq)
                resolved_exercise = clf_result.exercise_type
                if resolved_exercise == "uncertain":
                    resolved_exercise = "squat"  # safe fallback
                exercise_type = resolved_exercise
                logger.info(
                    f"[Feature 5] Auto-detected exercise: {exercise_type} "
                    f"(conf={clf_result.confidence:.2f})"
                )

            # Estimate camera angle (use every 30 frames to smooth)
            cam_elev = estimate_camera_elevation_angle(smoothed_kps)
            camera_elevations.append(cam_elev)

            # Calculate primary angle (uses resolved exercise_type after frame 60)
            effective_exercise = exercise_type if exercise_type != "auto" else "squat"
            angle_result = get_exercise_angle(
                smoothed_kps,
                raw_confs,
                effective_exercise,
                camera_elevation_deg=cam_elev,
                occlusion_ratio=smoother.occlusion_ratio,
            )

            angle_val = angle_result["corrected_angle"]
            angles_per_frame.append(angle_val)
            confidences_per_frame.append(angle_result["confidence"])
            keypoints_history.append(smoothed_kps.copy())  # Copy for later symmetry analysis

            frame_idx += 1

        t_loop_end = time.perf_counter()

        # ── Feature 5: Run exercise classifier if still 'auto' (short videos) ──
        # If the video was shorter than 60 frames, classification runs here.
        auto_exercise_type: str | None = None
        auto_exercise_confidence: float = 1.0
        if exercise_type == "auto" or (exercise_type in ("squat", "deadlift", "hip_thrust") and clf_kps_seq):
            # If originally 'auto', run the classifier now on all collected frames
            original_was_auto = payload.get("exercise_type", "squat") == "auto"
            if original_was_auto:
                clf_result = ExerciseClassifier().classify(clf_kps_seq, clf_confs_seq)
                auto_exercise_type = clf_result.exercise_type
                auto_exercise_confidence = clf_result.confidence
                if exercise_type == "auto":
                    # Resolve for downstream (if video was < 60 frames)
                    exercise_type = auto_exercise_type if auto_exercise_type != "uncertain" else "squat"

        # ── Feature 7: Run camera angle detector ─────────────────────────────
        cam_det_result = CameraAngleDetector().detect(
            cam_kps_seq,
            cam_confs_seq,
            frame_width=float(w),
            exercise_type=exercise_type if exercise_type != "auto" else "squat",
        )

        # ── Compute non-biometric metadata ────────────────────────────────────
        rep_count = count_reps(angles_per_frame, exercise_type if exercise_type != "auto" else "squat")
        duration_sec = round(len(angles_per_frame) / fps, 1)
        avg_cam_elevation = round(float(np.mean(camera_elevations)) if camera_elevations else 0.0, 1)

        # ── Compute session stats (ephemeral — never stored) ──────────────────
        resolved_exercise = exercise_type if exercise_type != "auto" else "squat"
        session_stats = compute_session_stats(
            angles_per_frame,
            confidences_per_frame,
            rep_count,
            duration_sec,
            resolved_exercise,
            keypoints_history=keypoints_history,
            fps=float(fps),
        )

        t_analysis = time.perf_counter()
        analysis_ms = round((t_analysis - t_start) * 1000, 1)
        logger.info(
            "Pass 1 (analysis): %.2fs (%d frames, %.1fms/frame)",
            t_analysis - t_start,
            len(angles_per_frame),
            (t_analysis - t_start) / max(1, len(angles_per_frame)) * 1000,
        )

        # ── Post-processing timing ────────────────────────────────────────────
        t_postprocess = time.perf_counter()

        # ── PASS 2: Render + Encode (zero inference, piped to FFmpeg) ────
        t_render_start = time.perf_counter()
        overlay_total_ms = 0.0
        with FFmpegPipeWriter(
            width=w, height=h, fps=fps,
            target_width=1280, target_bitrate="4M",
        ) as writer:
            for idx, frame in enumerate(_iter_frames(input_path)):
                cached_kps = smoothed_kps_cache[idx] if idx < len(smoothed_kps_cache) else np.zeros((17, 2))
                cached_confs = raw_confs_cache[idx] if idx < len(raw_confs_cache) else np.zeros(17)
                a_val = angles_per_frame[idx] if idx < len(angles_per_frame) else None
                # Render skeleton overlay (Feature 8: overlay_mode)
                t_overlay = time.perf_counter()
                annotated = create_neon_skeleton_frame(
                    frame,
                    cached_kps,
                    cached_confs,
                    angle=a_val if a_val is not None else float("nan"),
                    angle_confidence=confidences_per_frame[idx] if idx < len(confidences_per_frame) else 0.0,
                    exercise_type=resolved_exercise,
                    overlay_mode=overlay_mode,
                )
                # Add HUD elements (ROM gauge + rep counter) — previously required a separate pass
                if a_val is not None and not np.isnan(a_val):
                    annotated = draw_rom_gauge(annotated, a_val, resolved_exercise, overlay_mode=overlay_mode)
                annotated = draw_rep_counter(annotated, rep_count, overlay_mode=overlay_mode)
                overlay_total_ms += (time.perf_counter() - t_overlay) * 1000
                writer.write(annotated)
            compressed_bytes = writer.finish()

        # Frame count mismatch warning (VFR videos may decode different counts)
        render_frame_count = idx + 1 if 'idx' in dir() else 0
        if render_frame_count != len(smoothed_kps_cache):
            logger.warning(
                "Frame count mismatch: Pass 1 processed %d frames, "
                "Pass 2 rendered %d frames",
                len(smoothed_kps_cache),
                render_frame_count,
            )

        t_render = time.perf_counter()
        logger.info(
            "Pass 2 (render+encode): %.2fs (%.1fms/frame)",
            t_render - t_analysis,
            (t_render - t_analysis) / max(1, len(angles_per_frame)) * 1000,
        )
        logger.info(
            "Total pipeline: %.2fs, output=%d bytes",
            t_render - t_start,
            len(compressed_bytes),
        )

        # Free caches
        del raw_confs_cache, smoothed_kps_cache

        # angles_per_frame / keypoints_history → go out of scope here (garbage collected)
        # BIOMETRIC DATA IS NEVER RETURNED OR STORED

        # ── Build debug_timings (always collected, only returned if debug=True) ──
        sorted_frame_times = sorted(frame_times_ms) if frame_times_ms else [0]
        n_frames = len(frame_times_ms) or 1
        debug_timings = {
            "model_load_ms":        model_load_ms,
            "cold_start":           not was_cached,
            "video_decode_ms":      round((t_analysis - t_start - sum(frame_times_ms) / 1000) * 1000, 1) if frame_times_ms else 0,
            "frame_count":          n_frames,
            "input_resolution":     f"{w}×{h}",
            "processing_resolution": f"{640}×{640}",
            "inference_total_ms":   round(sum(frame_times_ms), 1),
            "inference_per_frame_ms": round(sum(frame_times_ms) / n_frames, 1),
            "inference_min_ms":     round(sorted_frame_times[0], 1),
            "inference_max_ms":     round(sorted_frame_times[-1], 1),
            "inference_p95_ms":     round(sorted_frame_times[min(int(n_frames * 0.95), n_frames - 1)], 1) if n_frames > 1 else round(sorted_frame_times[0], 1),
            "postprocess_ms":       round((t_analysis - t_loop_end) * 1000, 1),
            "overlay_render_ms":    round(overlay_total_ms, 1),
            "video_encode_ms":      round((t_render - t_render_start) * 1000 - overlay_total_ms, 1),
            "total_server_ms":      round((t_render - t_start) * 1000, 1),
            "output_video_size_bytes": len(compressed_bytes),
            "protocol":             protocol,
            "server_info":          get_server_info(device=pose_model.device),
        }

        return {
            # Non-biometric metadata only (stats are ephemeral, not stored)
            "metadata": {
                "rep_count":   rep_count,
                "duration_sec": duration_sec,
                "exercise_type": resolved_exercise,
                "stats": session_stats,
                # Feature 5: auto-detection results
                "detected_exercise_type":   auto_exercise_type,
                "exercise_confidence":       round(auto_exercise_confidence, 3) if auto_exercise_type else None,
                # Feature 7: camera angle detection results
                "detected_camera_angle":     cam_det_result.detected_angle,
                "camera_angle_confidence":   round(cam_det_result.confidence, 3),
                "camera_angle_warnings":     cam_det_result.warnings,
            },
            "annotated_video_bytes": compressed_bytes,
            "processing_log": {
                "biometric_data_persisted":    False,
                "avg_camera_elevation_deg":    avg_cam_elevation,
                "total_frames_processed":      len(angles_per_frame),
                "detected_camera_angle":       cam_det_result.detected_angle,
                "camera_angle_spread_ratio":   round(cam_det_result.spread_ratio, 3),
            },
            # Debug timings — always collected (cheap), only surfaced when debug=True
            **({
                "debug_timings": debug_timings
            } if debug else {}),
        }

    finally:
        for path in (input_path,):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass

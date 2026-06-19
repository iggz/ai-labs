"""
slingshot.py — SlingShot Video Pipeline
=========================================
Tracks the largest moving object (barbell) using sv.ByteTrack,
crops to stable 9:16 vertical window, overlays velocity trail + watermark,
and writes output with hardware encoding via FFmpeg pipe (zero temp files).
"""

import cv2
import numpy as np
import supervision as sv
import tempfile
import os
import logging
import time
from pathlib import Path

from overlay import draw_velocity_trail, apply_watermark, draw_speed_hud
from ffmpeg_writer import FFmpegPipeWriter

logger = logging.getLogger(__name__)

WATERMARK_PATH = str(
    Path(__file__).parent.parent.parent / "images" / "watermark.png"
)


def _load_watermark(wm_target_width: int) -> np.ndarray | None:
    """Load and scale the HHB watermark to 22% of the cropped video width."""
    wm = cv2.imread(WATERMARK_PATH, cv2.IMREAD_UNCHANGED)
    if wm is None:
        logger.warning(f"Watermark not found at {WATERMARK_PATH}")
        return None

    # Ensure 4 channels (BGRA)
    if wm.shape[2] == 3:
        wm = cv2.cvtColor(wm, cv2.COLOR_BGR2BGRA)

    scale = (wm_target_width * 0.22) / wm.shape[1]
    new_w = max(1, int(wm.shape[1] * scale))
    new_h = max(1, int(wm.shape[0] * scale))
    return cv2.resize(wm, (new_w, new_h), interpolation=cv2.INTER_AREA)


def process_slingshot(payload: dict) -> dict:
    """
    Processor for the SlingShot pipeline. Accepts a payload dict with:
        video_bytes (bytes): raw video data
        filename    (str):   original filename (for extension)

    Returns a dict with:
        video_bytes (bytes): processed MP4 bytes (caller uploads to storage)
        stats       (dict):  peak_speed_kmh, avg_speed_kmh, total_distance_cm, total_frames
    """
    video_bytes: bytes = payload["video_bytes"]
    filename: str = payload.get("filename", "input.mp4")

    # Write input bytes to a temp file (OpenCV needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
        tmp_in.write(video_bytes)
        input_path = tmp_in.name

    try:
        result = _run_slingshot_pipeline(input_path)
        return {"video_bytes": result.pop("video_bytes"), "stats": result}
    finally:
        try:
            os.unlink(input_path)
        except FileNotFoundError:
            pass


def _run_slingshot_pipeline(input_video_path: str) -> dict:
    """
    Two-pass pipeline:
      Pass 1 — Track object centers to find the optimal horizontal crop window.
      Pass 2 — Render overlays, crop, watermark, and encode output via FFmpeg pipe.
    """
    t_start = time.perf_counter()
    cap = cv2.VideoCapture(input_video_path)
    fps = max(1, int(cap.get(cv2.CAP_PROP_FPS)))
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # ── PASS 1: Build track history ───────────────────────────────────────────
    tracker = sv.ByteTrack()
    motion_detector = cv2.createBackgroundSubtractorMOG2(
        history=500, varThreshold=16, detectShadows=False
    )

    track_history_x: list[float] = []
    all_centers: list[tuple] = []

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        fg_mask = motion_detector.apply(frame)
        contours, _ = cv2.findContours(
            fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        detections = []
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            if w > 20 and h > 20 and w * h > 1000:
                detections.append([x, y, x + w, y + h])

        if detections:
            detections_sorted = sorted(
                detections, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True
            )[:3]
            sv_dets = sv.Detections(
                xyxy=np.array(detections_sorted, dtype=np.float32),
                confidence=np.ones(len(detections_sorted), dtype=np.float32),
            )
            tracked = tracker.update_with_detections(sv_dets)

            if len(tracked) > 0:
                main_box = tracked.xyxy[0]
                cx = (main_box[0] + main_box[2]) / 2.0
                cy = (main_box[1] + main_box[3]) / 2.0
                track_history_x.append(cx)
                all_centers.append((cx, cy))

    cap.release()

    # ── Determine stable crop window ─────────────────────────────────────────
    if not track_history_x:
        # No moving object detected — video may be static, too dark, or too short
        raise ValueError(
            "No moving object detected in the video. "
            "Try a brighter clip showing clear barbell movement, or use a landscape orientation."
        )

    median_x = float(np.median(track_history_x)) if track_history_x else orig_w / 2.0

    is_landscape = orig_w > orig_h
    if is_landscape:
        target_w = (int(orig_h * 9.0 / 16.0) // 2) * 2  # Must be even for FFmpeg
        x_min = int(median_x - target_w / 2.0)
        x_max = x_min + target_w

        if x_min < 0:
            x_min, x_max = 0, target_w
        elif x_max > orig_w:
            x_max = orig_w
            x_min = orig_w - target_w

        y_min, y_max = 0, orig_h
    else:
        x_min, x_max = 0, orig_w
        y_min, y_max = 0, orig_h
        target_w = orig_w

    crop_h = y_max - y_min
    crop_w = x_max - x_min

    # ── Load watermark ────────────────────────────────────────────────────────
    watermark = _load_watermark(crop_w)

    # ── Compute speeds from track centers ─────────────────────────────────────
    speeds_px_per_frame: list[float] = [0.0]
    for i in range(1, len(all_centers)):
        dx = all_centers[i][0] - all_centers[i - 1][0]
        dy = all_centers[i][1] - all_centers[i - 1][1]
        speeds_px_per_frame.append(float(np.sqrt(dx**2 + dy**2)))

    # Convert px/frame → km/h (assume 1 px ≈ 0.5 mm at typical gym distance)
    PX_TO_MM = 0.5
    speeds_kmh = [s * PX_TO_MM * fps * 3.6 / 1000.0 for s in speeds_px_per_frame]
    max_speed = max(speeds_kmh) if speeds_kmh else 1.0

    total_distance_px = sum(speeds_px_per_frame)
    total_distance_cm = total_distance_px * PX_TO_MM / 10.0
    peak_speed = max(speeds_kmh) if speeds_kmh else 0.0
    avg_speed = float(np.mean(speeds_kmh)) if speeds_kmh else 0.0

    # ── PASS 2: Render and encode (piped to FFmpeg — zero disk writes) ────────
    t_analysis = time.perf_counter()
    logger.info(
        "SlingShot Pass 1 (tracking): %.2fs (%d centers)",
        t_analysis - t_start,
        len(all_centers),
    )
    cap2 = cv2.VideoCapture(input_video_path)

    with FFmpegPipeWriter(
        width=crop_w, height=crop_h, fps=fps,
        target_width=crop_w,  # Already cropped to target size
        target_bitrate="4M",
    ) as writer:
        frame_idx = 0
        trail_points: list[tuple] = []

        while cap2.isOpened():
            ret, frame = cap2.read()
            if not ret:
                break

            # Crop frame
            cropped = frame[y_min:y_max, x_min:x_max].copy()

            # Update trail from track history (offset by crop x_min)
            if frame_idx < len(all_centers):
                cx, cy = all_centers[frame_idx]
                trail_points.append((cx - x_min, cy - y_min))

            # Draw velocity trail
            if len(trail_points) > 1:
                frame_speeds = speeds_kmh[max(0, frame_idx - 45) : frame_idx + 1]
                cropped = draw_velocity_trail(
                    cropped, trail_points, frame_speeds, max_speed
                )

            # Detect lift phase (concentric = moving up, eccentric = moving down)
            phase_label = ""
            if frame_idx < len(speeds_px_per_frame) and frame_idx > 0:
                if len(all_centers) > frame_idx:
                    dy = all_centers[frame_idx][1] - all_centers[frame_idx - 1][1]
                    phase_label = "PULL ↑" if dy < -1.5 else ("LOWER ↓" if dy > 1.5 else "")

            # Draw speed HUD
            cropped = draw_speed_hud(
                cropped,
                peak_speed,
                avg_speed,
                total_distance_cm,
                phase_label,
            )

            # Overlay watermark
            if watermark is not None:
                cropped = apply_watermark(cropped, watermark)

            writer.write(cropped)
            frame_idx += 1

        cap2.release()
        compressed_bytes = writer.finish()

    t_render = time.perf_counter()
    logger.info(
        "SlingShot Pass 2 (render+encode): %.2fs (%.1fms/frame)",
        t_render - t_analysis,
        (t_render - t_analysis) / max(1, frame_idx) * 1000,
    )
    logger.info(
        "SlingShot total pipeline: %.2fs, output=%d bytes",
        t_render - t_start,
        len(compressed_bytes),
    )

    return {
        "peak_speed_kmh": round(peak_speed, 2),
        "avg_speed_kmh": round(avg_speed, 2),
        "total_distance_cm": round(total_distance_cm, 1),
        "total_frames": frame_idx,
        "video_bytes": compressed_bytes,
    }

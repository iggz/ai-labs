"""
encoding_utils.py — Shared FFmpeg Encoder Detection
=====================================================
Centralised detection and caching of H.264 encoder availability.
Supports imageio-ffmpeg for portable path resolution on Windows.
"""

import subprocess
import logging
import imageio_ffmpeg

logger = logging.getLogger(__name__)

# Resolve FFmpeg executable path portably
FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


def _detect_available_encoders() -> set[str]:
    """Detect all available H.264 encoders in the FFmpeg binary."""
    try:
        result = subprocess.run(
            [FFMPEG_EXE, "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        encoders = set()
        for line in result.stdout.splitlines():
            if "H.264" in line or "h264" in line:
                # Encoders are listed like:  V..... h264_amf            AMD AMF H.264 Encoder (codec h264)
                parts = line.split()
                if len(parts) >= 2:
                    encoder_name = parts[1]
                    if encoder_name.startswith("h264") or "h264" in encoder_name:
                        encoders.add(encoder_name)
        return encoders
    except Exception as e:
        logger.error(f"Failed to detect FFmpeg encoders: {e}")
        return set()


AVAILABLE_ENCODERS = _detect_available_encoders()
logger.info(f"Available H.264 encoders: {AVAILABLE_ENCODERS}")

# Select the best hardware encoder
if "h264_amf" in AVAILABLE_ENCODERS:
    BEST_ENCODER = "h264_amf"
    USE_HW_ENCODER = True
elif "h264_videotoolbox" in AVAILABLE_ENCODERS:
    BEST_ENCODER = "h264_videotoolbox"
    USE_HW_ENCODER = True
elif "h264_mf" in AVAILABLE_ENCODERS:
    BEST_ENCODER = "h264_mf"
    USE_HW_ENCODER = True
else:
    BEST_ENCODER = "libx264"
    USE_HW_ENCODER = False


def get_encoder() -> str:
    """Return the best available H.264 encoder name."""
    return BEST_ENCODER


def get_encoder_flags() -> list[str]:
    """Return encoder-specific FFmpeg flags for the active encoder."""
    if BEST_ENCODER == "h264_amf":
        return ["-quality", "balanced"]
    elif BEST_ENCODER == "h264_videotoolbox":
        return ["-q:v", "65"]
    elif BEST_ENCODER == "h264_mf":
        # h264_mf doesn't support -crf or -q:v easily, defaults are usually fine
        return []
    # Fallback to libx264 CPU encoder
    return ["-preset", "fast", "-crf", "23"]

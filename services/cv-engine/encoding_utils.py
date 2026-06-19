"""
encoding_utils.py — Shared FFmpeg Encoder Detection
=====================================================
Centralised detection and caching of h264_videotoolbox availability.
Both ``ffmpeg_writer.py`` and ``compress.py`` import from this module
to avoid duplicating the detection logic.
"""

import subprocess
import logging

logger = logging.getLogger(__name__)


def _has_videotoolbox() -> bool:
    """Return True if h264_videotoolbox encoder is available."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return "h264_videotoolbox" in result.stdout
    except Exception:
        return False


# Cache encoder detection at module load time
USE_HW_ENCODER: bool = _has_videotoolbox()


def get_encoder() -> str:
    """Return the best available H.264 encoder name."""
    return "h264_videotoolbox" if USE_HW_ENCODER else "libx264"


def get_encoder_flags() -> list[str]:
    """Return encoder-specific FFmpeg flags for the active encoder."""
    if USE_HW_ENCODER:
        return ["-q:v", "65"]
    return ["-preset", "fast", "-crf", "23"]

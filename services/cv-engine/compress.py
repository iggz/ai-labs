"""
compress.py — Hardware Video Encoding
======================================
Wraps FFmpeg with h264_videotoolbox (macOS Apple Silicon) for fast H.264 output.
Falls back gracefully to libx264 if VideoToolbox is unavailable.
"""

import subprocess
import tempfile
import os
import logging

from encoding_utils import USE_HW_ENCODER, get_encoder, get_encoder_flags, FFMPEG_EXE

logger = logging.getLogger(__name__)


def compress_video_hardware(
    input_path: str,
    output_path: str,
    target_width: int = 1080,
    target_fps: int = 30,
    target_bitrate: str = "4M",
) -> None:
    """
    Re-encode a video using hardware acceleration when available.

    Args:
        input_path:     Path to input MP4
        output_path:    Path to write output MP4
        target_width:   Output width in pixels (-2 = keep aspect ratio)
        target_fps:     Output frame rate
        target_bitrate: Video bitrate (e.g. '2M', '4M')

    Raises:
        subprocess.CalledProcessError on encoding failure
    """
    encoder = get_encoder()
    logger.info(f"Encoding with {encoder} (HW={'yes' if USE_HW_ENCODER else 'no'})")

    cmd = [
        FFMPEG_EXE, "-y",
        "-i", input_path,
        "-vf", f"scale={target_width}:-2",
        "-r", str(target_fps),
        "-c:v", encoder,
        "-b:v", target_bitrate,
        "-an",                          # Strip audio (workout videos)
        "-movflags", "+faststart",      # Progressive download
    ]

    cmd += get_encoder_flags()

    cmd.append(output_path)
    subprocess.run(cmd, check=True, capture_output=True)
    logger.info(f"Encoding complete → {output_path}")


def bytes_to_mp4(
    video_bytes: bytes,
    target_width: int = 1080,
    target_fps: int = 30,
    target_bitrate: str = "4M",
) -> bytes:
    """
    Re-encode raw video bytes → hardware-compressed MP4 bytes.
    Uses named temp files (required by FFmpeg).

    Args:
        video_bytes:    Raw input video data
        target_width:   Output width in pixels
        target_fps:     Output frame rate
        target_bitrate: Target bitrate

    Returns:
        Compressed MP4 as bytes
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
        tmp_in.write(video_bytes)
        tmp_in_path = tmp_in.name

    tmp_out_path = tmp_in_path.replace(".mp4", "_out.mp4")

    try:
        compress_video_hardware(tmp_in_path, tmp_out_path, target_width, target_fps, target_bitrate)
        with open(tmp_out_path, "rb") as f:
            return f.read()
    finally:
        for path in (tmp_in_path, tmp_out_path):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass


def bytes_to_mp4_piped(
    video_bytes: bytes,
    target_width: int = 1080,
    target_fps: int = 30,
    target_bitrate: str = "4M",
) -> bytes:
    """
    Re-encode video bytes via FFmpeg stdin→stdout pipes.
    Zero temp files on disk. Falls back to bytes_to_mp4() on failure.

    Args:
        video_bytes:    Raw input video data
        target_width:   Output width in pixels
        target_fps:     Output frame rate
        target_bitrate: Target bitrate

    Returns:
        Compressed MP4 as bytes
    """
    encoder = get_encoder()
    encoder_flags = get_encoder_flags()

    cmd = [
        FFMPEG_EXE, "-y",
        "-i", "pipe:0",
        "-vf", f"scale={target_width}:-2",
        "-r", str(target_fps),
        "-c:v", encoder,
        "-b:v", target_bitrate,
        "-an",
        "-movflags", "+faststart+frag_keyframe",
        *encoder_flags,
        "-f", "mp4",
        "pipe:1",
    ]


    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = proc.communicate(input=video_bytes, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(stderr_bytes.decode(errors='replace'))
        if len(stdout_bytes) < 100:
            raise RuntimeError("Output too small — likely encoding failure")
        logger.info(f"Piped encoding complete: {len(video_bytes)} → {len(stdout_bytes)} bytes")
        return stdout_bytes
    except Exception as exc:
        logger.warning(f"Piped encoding failed ({exc}), falling back to temp-file method")
        return bytes_to_mp4(video_bytes, target_width, target_fps, target_bitrate)


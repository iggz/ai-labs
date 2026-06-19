"""
ffmpeg_writer.py — Zero-disk FFmpeg Pipe Writer
================================================
Pipes raw BGR frames directly to FFmpeg via subprocess stdin.
No temp files are written; the encoded MP4 is returned as bytes.
Uses h264_videotoolbox (macOS Apple Silicon) when available,
falling back to libx264.

Deadlock prevention
-------------------
On macOS the OS pipe buffer is ~65 KB.  A single 590×1280 BGR frame is
≈ 2.3 MB — far larger than the pipe buffer.  If Python writes frames to
FFmpeg's stdin faster than FFmpeg drains them, *and* FFmpeg simultaneously
writes encoded output to its stdout pipe faster than Python reads it, both
processes block each other: a classic bidirectional pipe deadlock.

The fix: spawn a background ``threading.Thread`` in :meth:`__init__` that
continuously reads FFmpeg's stdout into an in-memory ``bytearray``.  This
keeps the stdout pipe perpetually drained, so FFmpeg never blocks on output
writes, and Python's stdin writes complete promptly.  :meth:`finish` joins
the reader thread and returns the accumulated bytes.
"""

import io
import subprocess
import threading
import logging
import numpy as np

from encoding_utils import USE_HW_ENCODER, get_encoder, get_encoder_flags

logger = logging.getLogger(__name__)


class FFmpegPipeWriter:
    """
    Encode a sequence of raw BGR frames into a compressed MP4 via FFmpeg.

    Frames are piped directly to FFmpeg's stdin (no temp files).
    The resulting MP4 bytes are returned by :meth:`finish`.

    A background thread continuously drains FFmpeg's stdout to prevent
    the bidirectional pipe deadlock that would otherwise occur when the
    OS pipe buffer fills up during encoding of large frames.

    Usage::

        writer = FFmpegPipeWriter(width=1920, height=1080, fps=30)
        for frame in frames:          # numpy BGR arrays
            writer.write(frame)
        mp4_bytes = writer.finish()

    Args:
        width:          Frame width in pixels.
        height:         Frame height in pixels.
        fps:            Input (and output) frame rate.
        target_width:   Output width; height is scaled proportionally (-2 rule).
        target_bitrate: FFmpeg bitrate string, e.g. ``"4M"``.
    """

    def __init__(
        self,
        width: int,
        height: int,
        fps: int = 30,
        target_width: int = 1280,
        target_bitrate: str = "4M",
        timeout: int = 300,
    ) -> None:
        self._finished = False
        self._timeout = timeout

        encoder = get_encoder()
        encoder_flags = get_encoder_flags()
        logger.info(
            "FFmpegPipeWriter: encoder=%s HW=%s %dx%d@%dfps → %dpx %s",
            encoder,
            "yes" if USE_HW_ENCODER else "no",
            width,
            height,
            fps,
            target_width,
            target_bitrate,
        )

        cmd = [
            "ffmpeg", "-y",
            # Input from stdin — raw BGR frames
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "pipe:0",
            # Output
            "-vf", f"scale={target_width}:-2",
            "-r", str(fps),
            "-c:v", encoder,
            "-b:v", target_bitrate,
            "-an",                                          # Strip audio
            "-movflags", "+faststart+frag_keyframe",       # Progressive + fragmented
            *encoder_flags,
            "-f", "mp4",
            "pipe:1",                                      # Write MP4 to stdout
        ]

        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # ── Background stdout-reader thread ───────────────────────────────────
        # Continuously drains FFmpeg's stdout pipe into _output_buf so that the
        # OS pipe buffer never fills up and blocks FFmpeg's output writes — which
        # would in turn block Python's stdin writes, deadlocking both sides.
        self._output_buf = io.BytesIO()
        self._reader_thread = threading.Thread(
            target=self._drain_stdout, daemon=True
        )
        self._reader_thread.start()

    # ── Context manager support ───────────────────────────────────────────────

    def __enter__(self) -> "FFmpegPipeWriter":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Clean up subprocess resources on context exit.

        If *finish()* was already called successfully, this is a no-op.
        Otherwise forces the process to terminate and joins the reader thread.
        """
        if self._finished:
            return
        self.close()

    def __del__(self) -> None:
        """Fallback cleanup if the writer is garbage-collected without close()."""
        if not self._finished and hasattr(self, "process") and self.process.poll() is None:
            self.close()

    def close(self) -> None:
        """Force-terminate the FFmpeg process and clean up resources."""
        if self._finished:
            return
        self._finished = True
        try:
            if self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.close()
        except Exception:
            pass
        try:
            self.process.kill()
        except Exception:
            pass
        self._reader_thread.join(timeout=5)
        try:
            self.process.wait(timeout=5)
        except Exception:
            pass

    def _drain_stdout(self) -> None:
        """Background thread: read all of FFmpeg's stdout until EOF."""
        try:
            for chunk in iter(lambda: self.process.stdout.read(65536), b""):
                self._output_buf.write(chunk)
        except Exception:
            pass  # Process termination is handled in finish()

    def write(self, frame: np.ndarray) -> None:
        """
        Write a single BGR frame to the FFmpeg process stdin.

        Args:
            frame: BGR numpy array with the same width/height as specified
                   in :meth:`__init__`.

        Raises:
            RuntimeError: If the FFmpeg process has terminated unexpectedly
                          (i.e. a BrokenPipeError occurs on write).
        """
        try:
            self.process.stdin.write(frame.tobytes())
        except BrokenPipeError:
            stderr_bytes = self.process.stderr.read()
            raise RuntimeError(
                f"FFmpeg process died unexpectedly.\nFFmpeg stderr:\n"
                f"{stderr_bytes.decode(errors='replace')}"
            )

    def finish(self) -> bytes:
        """
        Signal end-of-input, wait for FFmpeg to finish, and return the MP4 bytes.

        Closes stdin to signal EOF to FFmpeg, waits for the background stdout
        reader thread to drain all output, then returns the encoded bytes.

        If already called, returns empty bytes (idempotent).

        Returns:
            Encoded MP4 as :class:`bytes`.

        Raises:
            RuntimeError: If FFmpeg exits with a non-zero return code.
        """
        if self._finished:
            return b""
        self._finished = True

        self.process.stdin.close()
        self._reader_thread.join(timeout=self._timeout)
        if self._reader_thread.is_alive():
            self.process.kill()
            self._reader_thread.join(timeout=5)
            raise RuntimeError("FFmpeg encoding timed out (reader thread still alive)")
        stderr_bytes = self.process.stderr.read()
        try:
            self.process.wait(timeout=self._timeout)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
            raise RuntimeError("FFmpeg encoding timed out (process still running)")

        if self.process.returncode != 0:
            raise RuntimeError(
                f"FFmpeg encoding failed (exit code {self.process.returncode}).\n"
                f"FFmpeg stderr:\n{stderr_bytes.decode(errors='replace')}"
            )

        result = self._output_buf.getvalue()
        logger.info("FFmpegPipeWriter: encoded %d bytes", len(result))
        return result


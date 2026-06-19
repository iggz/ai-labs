"""
lens_correction.py — Phone Camera Lens Distortion Correction
=============================================================
Corrects barrel distortion introduced by phone cameras using
preset distortion coefficients tuned for common field-of-view
configurations.

Presets
-------
``"standard"``
    Typical smartphone rear camera (~70° FOV).  Mild barrel correction.
``"wide"``
    Wide-angle secondary lens (~90° FOV).  Moderate barrel correction.
``"ultrawide"``
    Ultra-wide lens (~120° FOV or wider).  Strong barrel correction.
``"none"``
    Passthrough — correction is disabled entirely.
"""

import cv2
import numpy as np


# Distortion coefficients per preset: (k1, k2, p1, p2, k3)
_DIST_PRESETS: dict[str, list[float]] = {
    "standard":  [-0.05,  0.0,   0.0, 0.0, 0.0],
    "wide":      [-0.15,  0.01,  0.0, 0.0, 0.0],
    "ultrawide": [-0.30,  0.05,  0.0, 0.0, 0.0],
}


class LensCorrector:
    """
    Corrects barrel distortion from phone cameras using OpenCV remap tables.

    Remap tables are precomputed in :meth:`__init__` so that per-frame
    correction via :meth:`correct_frame` is a single efficient lookup.
    Keypoint coordinates can be corrected independently via
    :meth:`correct_keypoints`.

    Args:
        frame_width:  Width of the video frames to be corrected (pixels).
        frame_height: Height of the video frames to be corrected (pixels).
        fov_preset:   One of ``"standard"``, ``"wide"``, ``"ultrawide"``,
                      or ``"none"`` (disables correction).
    """

    def __init__(
        self,
        frame_width: int,
        frame_height: int,
        fov_preset: str = "standard",
    ) -> None:
        if fov_preset == "none":
            self.enabled = False
            return

        self.enabled = True
        w, h = frame_width, frame_height

        # Build camera matrix — assume square pixels and principal point at
        # the image centre.
        f = float(max(w, h))
        self.camera_matrix = np.array(
            [
                [f,   0.0, w / 2.0],
                [0.0, f,   h / 2.0],
                [0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )

        dist_values = _DIST_PRESETS.get(fov_preset, _DIST_PRESETS["standard"])
        self.dist_coeffs = np.array(dist_values, dtype=np.float64)

        # Compute an optimal new camera matrix that keeps all valid pixels
        self.new_camera_matrix, _ = cv2.getOptimalNewCameraMatrix(
            self.camera_matrix,
            self.dist_coeffs,
            (w, h),
            alpha=1.0,
        )

        # Precompute remap tables (CV_16SC2 for fast bilinear interpolation)
        self.map1, self.map2 = cv2.initUndistortRectifyMap(
            self.camera_matrix,
            self.dist_coeffs,
            None,
            self.new_camera_matrix,
            (w, h),
            cv2.CV_16SC2,
        )

    def correct_keypoints(self, keypoints: np.ndarray) -> np.ndarray:
        """
        Apply lens undistortion to an array of 2-D keypoint coordinates.

        NaN keypoints are preserved as-is (they represent occluded or
        missing detections).

        Args:
            keypoints: ``(N, 2)`` float array of ``[x, y]`` coordinates.

        Returns:
            ``(N, 2)`` float array of corrected coordinates.
        """
        if not self.enabled:
            return keypoints

        result = keypoints.copy()

        # Identify rows that are not NaN
        valid_mask = ~np.any(np.isnan(keypoints), axis=1)
        if not np.any(valid_mask):
            return result

        valid_pts = keypoints[valid_mask].reshape(-1, 1, 2).astype(np.float64)

        corrected = cv2.undistortPoints(
            valid_pts,
            self.camera_matrix,
            self.dist_coeffs,
            P=self.new_camera_matrix,
        )

        result[valid_mask] = corrected.reshape(-1, 2)
        return result

    def correct_frame(self, frame: np.ndarray) -> np.ndarray:
        """
        Apply lens undistortion to a full video frame using precomputed remap
        tables.

        Args:
            frame: BGR numpy array.

        Returns:
            Undistorted BGR frame (same shape as input).
        """
        if not self.enabled:
            return frame

        return cv2.remap(frame, self.map1, self.map2, cv2.INTER_LINEAR)

    @staticmethod
    def detect_fov_preset(frame_width: int, frame_height: int) -> str:
        """
        Heuristically select a distortion preset based on the frame aspect
        ratio.

        Ultra-wide sensors typically produce video with a very high aspect
        ratio (e.g. 21:9), while standard lenses stay closer to 16:9.

        Args:
            frame_width:  Frame width in pixels.
            frame_height: Frame height in pixels.

        Returns:
            One of ``"ultrawide"``, ``"wide"``, or ``"standard"``.
        """
        aspect = max(frame_width, frame_height) / min(frame_width, frame_height)
        if aspect > 2.1:
            return "ultrawide"
        if aspect > 1.85:
            return "wide"
        return "standard"

"""
smoother.py — Kalman Filter Keypoint Smoother
==============================================
Handles occlusion interpolation and jitter reduction for YOLOv8 pose keypoints.

Design:
  - 1D Kalman filter per keypoint coordinate [x, y, vx, vy]
  - Falls back to predicted state (interpolation) for brief dropouts
  - Marks keypoints as NaN after max_interpolation_frames consecutive misses
"""

import numpy as np


class KeypointSmoother:
    """
    Applies a Kalman filter per keypoint coordinate to handle
    occlusion and jitter. Falls back to EMA for brief dropouts.

    Args:
        num_keypoints: Number of body keypoints (17 for COCO-format YOLOv8)
        process_noise: Q matrix scale — higher = trust motion model more
        measurement_noise: R matrix scale — higher = trust detections less
        max_interpolation_frames: Consecutive occluded frames before NaN
    """

    def __init__(
        self,
        num_keypoints: int = 17,
        process_noise: float = 0.01,
        measurement_noise: float = 0.1,
        max_interpolation_frames: int = 8,
    ):
        self.num_kp = num_keypoints
        self.max_interp = max_interpolation_frames

        # Kalman state: [x, y, vx, vy] per keypoint
        self.states = np.zeros((num_keypoints, 4))
        self.covariances = np.eye(4)[None].repeat(num_keypoints, axis=0) * 1.0

        dt = 1.0 / 30.0  # Assume 30 FPS
        self.F = np.array(
            [
                [1, 0, dt, 0],
                [0, 1, 0, dt],
                [0, 0, 1, 0],
                [0, 0, 0, 1],
            ]
        )
        self.Q = np.eye(4) * process_noise
        self.R = np.eye(2) * measurement_noise
        self.H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]])

        self.frames_since_seen = np.zeros(num_keypoints, dtype=int)
        self.initialized = np.zeros(num_keypoints, dtype=bool)

    def update(self, keypoints: np.ndarray, confidences: np.ndarray) -> np.ndarray:
        """
        Process one frame of raw detections.

        Args:
            keypoints:   (N, 2) array of [x, y] pixel coordinates
            confidences: (N,) array of detection confidences [0.0–1.0]

        Returns:
            smoothed: (N, 2) array — NaN where keypoint is lost
        """
        smoothed = np.zeros_like(keypoints, dtype=float)

        for i in range(self.num_kp):
            # ── PREDICT step ──────────────────────────────────────────
            if self.initialized[i]:
                self.states[i] = self.F @ self.states[i]
                self.covariances[i] = self.F @ self.covariances[i] @ self.F.T + self.Q

            if confidences[i] > 0.3:
                # ── UPDATE step ───────────────────────────────────────
                measurement = keypoints[i]

                if not self.initialized[i]:
                    self.states[i] = np.array([measurement[0], measurement[1], 0.0, 0.0])
                    self.initialized[i] = True
                else:
                    innovation = measurement - self.H @ self.states[i]
                    S = self.H @ self.covariances[i] @ self.H.T + self.R
                    K = self.covariances[i] @ self.H.T @ np.linalg.inv(S)
                    self.states[i] += K @ innovation
                    self.covariances[i] = (np.eye(4) - K @ self.H) @ self.covariances[i]

                self.frames_since_seen[i] = 0
                smoothed[i] = self.states[i][:2]

            elif self.initialized[i] and self.frames_since_seen[i] < self.max_interp:
                # ── INTERPOLATE via predicted state ───────────────────
                smoothed[i] = self.states[i][:2]
                self.frames_since_seen[i] += 1

            else:
                # ── LOST: too many consecutive misses ─────────────────
                smoothed[i] = np.array([np.nan, np.nan])
                self.frames_since_seen[i] += 1

        return smoothed

    def reset(self):
        """Reset smoother state (call between videos)."""
        self.states[:] = 0
        self.covariances = np.eye(4)[None].repeat(self.num_kp, axis=0) * 1.0
        self.frames_since_seen[:] = 0
        self.initialized[:] = False

    @property
    def occlusion_ratio(self) -> float:
        """Fraction of keypoints currently in interpolation or lost state."""
        occluded = np.sum(self.frames_since_seen > 0)
        return float(occluded) / self.num_kp

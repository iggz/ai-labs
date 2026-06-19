"""
optical_flow_tracker.py — Lucas-Kanade Optical Flow Keypoint Tracker
======================================================================
Bridges raw YOLO pose detection and the Kalman smoother by recovering
low-confidence keypoints using sparse optical flow.

Pipeline position::

    raw_kps → OpticalFlowTracker.track() → KeypointSmoother.update()

When YOLO's detection confidence for a keypoint falls below
``confidence_threshold``, the tracker substitutes the position predicted
by Lucas-Kanade optical flow (tracked from the previous frame) instead of
passing through the low-confidence YOLO estimate.  This reduces jitter and
avoids NaN gaps during brief occlusions (e.g. a hand passing in front of a
knee).
"""

import cv2
import numpy as np


class OpticalFlowTracker:
    """
    Sparse optical flow tracker for pose keypoints.

    Uses the Lukas-Kanade pyramid method (:func:`cv2.calcOpticalFlowPyrLK`)
    to propagate keypoint positions between consecutive frames.  Only
    keypoints whose YOLO detection confidence is below
    ``confidence_threshold`` are overridden with the flow estimate; high-
    confidence YOLO detections are always kept as-is.

    Args:
        num_keypoints:        Expected number of keypoints (17 for COCO).
        confidence_threshold: Keypoints below this confidence level may be
                              replaced by optical flow predictions.
    """

    def __init__(self, num_keypoints: int = 17, confidence_threshold: float = 0.3) -> None:
        self.num_keypoints = num_keypoints
        self.confidence_threshold = confidence_threshold

        # Lucas-Kanade parameters
        self.lk_params = dict(
            winSize=(21, 21),
            maxLevel=3,
            criteria=(
                cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
                30,
                0.01,
            ),
        )

        self.prev_gray: np.ndarray | None = None
        self.prev_keypoints: np.ndarray | None = None

    def track(
        self,
        frame: np.ndarray,
        detected_keypoints: np.ndarray,
        confidences: np.ndarray,
    ) -> np.ndarray:
        """
        Merge YOLO detections with optical flow estimates.

        For each keypoint:
        - If YOLO confidence ≥ threshold → keep the YOLO position.
        - If YOLO confidence < threshold AND flow tracking succeeded →
          substitute the optical flow predicted position.
        - Otherwise → keep whatever YOLO returned (may be NaN).

        Args:
            frame:              Current BGR video frame.
            detected_keypoints: ``(N, 2)`` array of keypoint ``[x, y]``
                                positions from the YOLO detector.
            confidences:        ``(N,)`` array of per-keypoint detection
                                confidences.

        Returns:
            ``(N, 2)`` float32 array of merged keypoint positions.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Guard: if frame dimensions changed (e.g. tracker reused across videos
        # without reset, or OpenCV resizes on read), reset to avoid
        # calcOpticalFlowPyrLK crash.
        if self.prev_gray is not None and self.prev_gray.shape != gray.shape:
            self.reset()

        result = detected_keypoints.copy()

        if self.prev_gray is not None and self.prev_keypoints is not None:
            # Collect indices of keypoints that were valid in the previous frame
            valid_idx = [
                i for i in range(self.num_keypoints)
                if not np.any(np.isnan(self.prev_keypoints[i]))
            ]

            if valid_idx:
                prev_pts = np.array(
                    [self.prev_keypoints[i] for i in valid_idx],
                    dtype=np.float32,
                ).reshape(-1, 1, 2)

                next_pts, status, _ = cv2.calcOpticalFlowPyrLK(
                    self.prev_gray,
                    gray,
                    prev_pts,
                    None,
                    **self.lk_params,
                )

                for out_i, orig_idx in enumerate(valid_idx):
                    tracked_ok = status[out_i, 0] == 1
                    low_confidence = confidences[orig_idx] < self.confidence_threshold

                    if tracked_ok and low_confidence:
                        # Use optical flow position for low-confidence keypoint
                        result[orig_idx] = next_pts[out_i, 0]
                    # else: keep YOLO detection (already in result)

        self.prev_gray = gray
        self.prev_keypoints = result.copy()
        return result

    def reset(self) -> None:
        """
        Reset internal state (e.g. between different video clips or subjects).

        After reset, the next call to :meth:`track` will behave as if it is
        the first frame — no optical flow will be computed until a second
        frame is provided.
        """
        self.prev_gray = None
        self.prev_keypoints = None

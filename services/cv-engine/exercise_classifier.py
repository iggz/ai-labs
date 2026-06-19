"""
exercise_classifier.py — Heuristic Exercise Auto-Detector
==========================================================
Classifies 'squat', 'deadlift', or 'hip_thrust' from the first 60 frames
(≈2 s @ 30 fps) of a 17-keypoint COCO pose sequence using biomechanical rules.

COCO keypoint indices used:
    0  nose
    5  left_shoulder   6  right_shoulder
    7  left_elbow      8  right_elbow
    11 left_hip       12  right_hip
    13 left_knee      14  right_knee
    15 left_ankle     16  right_ankle

Privacy: operates only on ephemeral NumPy arrays; no data is persisted.
"""

from __future__ import annotations

import logging
import math
from typing import NamedTuple

import numpy as np

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Analyse only the first N frames (2 s @ 30 fps)
CLASSIFIER_FRAME_LIMIT = 60

# Minimum per-keypoint confidence to trust a reading
MIN_KP_CONF = 0.3

# Confidence threshold below which we flag 'uncertain'
UNCERTAIN_THRESHOLD = 0.70  # 70 %

# COCO keypoint indices
KP_L_SHOULDER = 5
KP_R_SHOULDER = 6
KP_L_HIP      = 11
KP_R_HIP      = 12
KP_L_KNEE     = 13
KP_R_KNEE     = 14
KP_L_ANKLE    = 15
KP_R_ANKLE    = 16


class ClassificationResult(NamedTuple):
    exercise_type: str   # 'squat' | 'deadlift' | 'hip_thrust' | 'uncertain'
    confidence: float    # 0.0 – 1.0


# ── Geometry helpers ──────────────────────────────────────────────────────────

def _angle_deg(a: np.ndarray, vertex: np.ndarray, b: np.ndarray) -> float | None:
    """Return the angle (degrees) at *vertex* formed by rays to *a* and *b*.
    Returns None if any point is all-zero (undetected)."""
    if (
        np.allclose(a, 0) or np.allclose(vertex, 0) or np.allclose(b, 0)
        or np.isnan(a).any() or np.isnan(vertex).any() or np.isnan(b).any()
    ):
        return None
    v1 = a - vertex
    v2 = b - vertex
    cos_val = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
    return float(math.degrees(math.acos(float(np.clip(cos_val, -1.0, 1.0)))))


def _mean_angle(
    kps_seq: list[np.ndarray],
    confs_seq: list[np.ndarray],
    vertex_idx: int,
    arm1_idx: int,
    arm2_idx: int,
) -> float | None:
    """Average the 3-point angle across all frames where all three keypoints
    pass the confidence threshold.  Returns None if no valid frames."""
    angles: list[float] = []
    for kps, confs in zip(kps_seq, confs_seq):
        if (
            confs[vertex_idx] >= MIN_KP_CONF
            and confs[arm1_idx] >= MIN_KP_CONF
            and confs[arm2_idx] >= MIN_KP_CONF
        ):
            ang = _angle_deg(kps[arm1_idx], kps[vertex_idx], kps[arm2_idx])
            if ang is not None:
                angles.append(ang)
    return float(np.mean(angles)) if angles else None


def _min_angle(
    kps_seq: list[np.ndarray],
    confs_seq: list[np.ndarray],
    vertex_idx: int,
    arm1_idx: int,
    arm2_idx: int,
) -> float | None:
    """Minimum 3-point angle across confident frames."""
    angles: list[float] = []
    for kps, confs in zip(kps_seq, confs_seq):
        if (
            confs[vertex_idx] >= MIN_KP_CONF
            and confs[arm1_idx] >= MIN_KP_CONF
            and confs[arm2_idx] >= MIN_KP_CONF
        ):
            ang = _angle_deg(kps[arm1_idx], kps[vertex_idx], kps[arm2_idx])
            if ang is not None:
                angles.append(ang)
    return float(min(angles)) if angles else None


def _max_angle(
    kps_seq: list[np.ndarray],
    confs_seq: list[np.ndarray],
    vertex_idx: int,
    arm1_idx: int,
    arm2_idx: int,
) -> float | None:
    """Maximum 3-point angle across confident frames."""
    angles: list[float] = []
    for kps, confs in zip(kps_seq, confs_seq):
        if (
            confs[vertex_idx] >= MIN_KP_CONF
            and confs[arm1_idx] >= MIN_KP_CONF
            and confs[arm2_idx] >= MIN_KP_CONF
        ):
            ang = _angle_deg(kps[arm1_idx], kps[vertex_idx], kps[arm2_idx])
            if ang is not None:
                angles.append(ang)
    return float(max(angles)) if angles else None


def _avg_shoulder_y_frac(
    kps_seq: list[np.ndarray],
    confs_seq: list[np.ndarray],
    frame_height: float,
) -> float | None:
    """Average shoulder y-position as fraction of frame height (0 = top, 1 = bottom)."""
    ys: list[float] = []
    for kps, confs in zip(kps_seq, confs_seq):
        for idx in (KP_L_SHOULDER, KP_R_SHOULDER):
            if confs[idx] >= MIN_KP_CONF and not np.isnan(kps[idx]).any():
                ys.append(float(kps[idx][1]) / max(frame_height, 1.0))
    return float(np.mean(ys)) if ys else None


# ── Main classifier ───────────────────────────────────────────────────────────

class ExerciseClassifier:
    """
    Heuristic classifier that examines the first ≤60 frames of a pose sequence
    and returns the most likely exercise type with a confidence score.

    Usage::

        clf = ExerciseClassifier()
        result = clf.classify(kps_list, confs_list, frame_height=1080)
        # result.exercise_type → 'squat' | 'deadlift' | 'hip_thrust' | 'uncertain'
        # result.confidence   → 0.0–1.0

    Parameters
    ----------
    kps_list  : list of (17, 2) np.ndarray — smoothed keypoint xy positions
    confs_list: list of (17,)   np.ndarray — per-keypoint confidence scores
    frame_height : int or float — pixel height of the video frame
    """

    def classify(
        self,
        kps_list: list[np.ndarray],
        confs_list: list[np.ndarray],
        frame_height: float = 1080.0,
    ) -> ClassificationResult:
        """Classify exercise type from a keypoint sequence."""
        # Clamp to first CLASSIFIER_FRAME_LIMIT frames
        kps  = kps_list[:CLASSIFIER_FRAME_LIMIT]
        confs = confs_list[:CLASSIFIER_FRAME_LIMIT]

        if not kps:
            logger.warning("ExerciseClassifier: received empty keypoint list")
            return ClassificationResult("uncertain", 0.0)

        scores: dict[str, float] = {
            "squat":      self._score_squat(kps, confs),
            "deadlift":   self._score_deadlift(kps, confs),
            "hip_thrust": self._score_hip_thrust(kps, confs, frame_height),
        }

        logger.info(f"ExerciseClassifier scores: {scores}")

        best_type = max(scores, key=lambda k: scores[k])
        best_score = scores[best_type]

        if best_score < UNCERTAIN_THRESHOLD:
            return ClassificationResult("uncertain", best_score)

        return ClassificationResult(best_type, best_score)

    # ── Per-exercise scorers ──────────────────────────────────────────────────

    def _score_squat(
        self,
        kps: list[np.ndarray],
        confs: list[np.ndarray],
    ) -> float:
        """
        Squat signature:
        - Knee angle (hip → knee → ankle) drops below 120° at some point
        - Significant knee-flexion range (max – min angle > 40°)
        - Hip angle stays relatively symmetric
        """
        min_knee = _min_angle(kps, confs, KP_L_KNEE, KP_L_HIP, KP_L_ANKLE)
        if min_knee is None:
            min_knee = _min_angle(kps, confs, KP_R_KNEE, KP_R_HIP, KP_R_ANKLE)
        if min_knee is None:
            return 0.0

        max_knee = _max_angle(kps, confs, KP_L_KNEE, KP_L_HIP, KP_L_ANKLE)
        if max_knee is None:
            max_knee = _max_angle(kps, confs, KP_R_KNEE, KP_R_HIP, KP_R_ANKLE)

        knee_range = (max_knee - min_knee) if max_knee is not None else 0.0

        # Strong squat signal: knee drops well below parallel
        depth_score = max(0.0, (120.0 - min_knee) / 120.0)   # 0 at 120°, 1 at 0°
        range_score = min(1.0, knee_range / 60.0)             # 1 if ≥60° ROM

        # Penalty if hip angle also extends widely (may be deadlift)
        max_hip = _max_angle(kps, confs, KP_L_HIP, KP_L_SHOULDER, KP_L_KNEE)
        hip_penalty = 0.0
        if max_hip is not None and max_hip > 165.0:
            hip_penalty = 0.25

        score = (depth_score * 0.55 + range_score * 0.45) - hip_penalty
        return float(np.clip(score, 0.0, 1.0))

    def _score_deadlift(
        self,
        kps: list[np.ndarray],
        confs: list[np.ndarray],
    ) -> float:
        """
        Deadlift signature:
        - Hip angle (shoulder → hip → knee) starts below 140° and extends to ≥155°
        - Knee angle stays relatively high (legs stay relatively straight, ≥130°)
        - Clear hip hinge pattern: large hip angle range
        """
        min_hip = _min_angle(kps, confs, KP_L_HIP, KP_L_SHOULDER, KP_L_KNEE)
        max_hip = _max_angle(kps, confs, KP_L_HIP, KP_L_SHOULDER, KP_L_KNEE)

        if min_hip is None or max_hip is None:
            return 0.0

        hip_range = max_hip - min_hip
        lockout_score = max(0.0, (max_hip - 140.0) / 40.0)   # 1 if hip reaches 180°
        hinge_score   = min(1.0, hip_range / 50.0)            # 1 if ≥50° hip ROM

        # Deadlift: knees stay relatively extended
        min_knee = _min_angle(kps, confs, KP_L_KNEE, KP_L_HIP, KP_L_ANKLE)
        knee_straight_bonus = 0.0
        if min_knee is not None and min_knee > 130.0:
            knee_straight_bonus = 0.15  # knees don't flex much → deadlift, not squat

        # Deadlift starts low (hip hinge down from standing)
        hinge_depth_score = max(0.0, (150.0 - min_hip) / 90.0)  # 1 if hip starts at 60°

        score = (lockout_score * 0.40 + hinge_score * 0.35 + hinge_depth_score * 0.25) + knee_straight_bonus
        return float(np.clip(score, 0.0, 1.0))

    def _score_hip_thrust(
        self,
        kps: list[np.ndarray],
        confs: list[np.ndarray],
        frame_height: float,
    ) -> float:
        """
        Hip thrust signature:
        - Hip angle peaks above 155° (full extension)
        - Shoulders stay near the top of the frame (person is reclined/elevated)
        - Knees stay roughly at 90° throughout
        """
        max_hip = _max_angle(kps, confs, KP_L_HIP, KP_L_SHOULDER, KP_L_KNEE)
        if max_hip is None:
            max_hip = _max_angle(kps, confs, KP_R_HIP, KP_R_SHOULDER, KP_R_KNEE)
        if max_hip is None:
            return 0.0

        extension_score = max(0.0, (max_hip - 130.0) / 50.0)   # 1 if hip reaches 180°

        # Hip thrust: shoulders stay in upper portion of frame
        avg_shoulder_y = _avg_shoulder_y_frac(kps, confs, frame_height)
        shoulder_high_score = 0.0
        if avg_shoulder_y is not None:
            # y_frac < 0.5 means shoulders above frame midpoint
            shoulder_high_score = max(0.0, 1.0 - avg_shoulder_y * 2)

        # Hip thrust: knees typically stay near 90°
        avg_knee = _mean_angle(kps, confs, KP_L_KNEE, KP_L_HIP, KP_L_ANKLE)
        knee_score = 0.0
        if avg_knee is not None:
            # Reward if avg knee angle is between 80°–110°
            knee_score = max(0.0, 1.0 - abs(avg_knee - 95.0) / 45.0)

        score = (extension_score * 0.50 + shoulder_high_score * 0.30 + knee_score * 0.20)
        return float(np.clip(score, 0.0, 1.0))

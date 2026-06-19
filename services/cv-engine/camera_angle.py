"""
camera_angle.py — Heuristic Camera Angle Auto-Detector
=======================================================
Detects whether a video was filmed from a 'side', 'front', or '45deg' angle
by examining the horizontal spread of shoulder and hip keypoints relative to
frame width on the first 30 frames.

COCO keypoint indices used:
    5  left_shoulder   6  right_shoulder
    11 left_hip       12  right_hip

Spread ratio thresholds:
    < 0.15  → side view  (narrow spread — only edge of body visible)
    > 0.35  → front view (wide spread — full torso width visible)
    else    → 45° view

Privacy: operates only on ephemeral NumPy arrays; no data is persisted.
"""

from __future__ import annotations

import logging
from typing import NamedTuple

import numpy as np

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

DETECTOR_FRAME_LIMIT = 30     # analyse only the first N frames
MIN_KP_CONF          = 0.3    # minimum per-keypoint confidence
SIDE_THRESHOLD       = 0.15   # spread ratio below which → side view
FRONT_THRESHOLD      = 0.35   # spread ratio above which → front view

# COCO keypoint indices
KP_L_SHOULDER = 5
KP_R_SHOULDER = 6
KP_L_HIP      = 11
KP_R_HIP      = 12


class AngleDetectionResult(NamedTuple):
    detected_angle: str       # 'side' | 'front' | '45deg' | 'unknown'
    confidence: float         # 0.0–1.0
    spread_ratio: float       # avg horizontal spread / frame_width (diagnostic)
    warnings: dict[str, str]  # stat_field → warning message for affected stats


# ── Camera angle stat warnings ────────────────────────────────────────────────

# Maps (detected_angle, exercise_type) → warnings for specific stat fields.
# These are displayed as info-icon tooltips in FormStatsDashboard.
_STAT_WARNINGS: dict[tuple[str, str], dict[str, str]] = {
    ("front", "squat"): {
        "best_rep_angle":   "Squat depth is estimated from a front-view angle. Side view gives more accurate knee flexion readings.",
        "avg_primary_angle": "Knee flexion angle accuracy is reduced from front view. Consider filming from the side.",
    },
    ("front", "deadlift"): {
        "best_rep_angle":    "Hip extension is harder to measure from front view. Side view gives more accurate results.",
        "avg_primary_angle": "Hip hinge angle accuracy is reduced from front view. Consider filming from the side.",
    },
    ("front", "hip_thrust"): {
        "best_rep_angle":    "Hip thrust extension is best measured from a side view.",
        "avg_primary_angle": "Hip extension angle accuracy is reduced from front view.",
    },
    ("45deg", "squat"): {
        "best_rep_angle":   "45° camera angle may slightly reduce squat depth measurement accuracy.",
    },
    ("45deg", "deadlift"): {
        "best_rep_angle":   "45° camera angle may slightly reduce hip extension measurement accuracy.",
    },
}


# ── Main detector ─────────────────────────────────────────────────────────────

class CameraAngleDetector:
    """
    Detects camera angle from the first ≤30 frames of a pose sequence.

    Usage::

        detector = CameraAngleDetector()
        result = detector.detect(kps_list, confs_list,
                                 frame_width=1920, exercise_type='squat')
        # result.detected_angle → 'side' | 'front' | '45deg' | 'unknown'
        # result.confidence     → 0.0–1.0
        # result.warnings       → dict[stat_field, warning_message]

    Parameters
    ----------
    kps_list     : list of (17, 2) np.ndarray — smoothed keypoint xy positions
    confs_list   : list of (17,)   np.ndarray — per-keypoint confidence scores
    frame_width  : int or float — pixel width of the video frame
    exercise_type: str — resolved exercise type (after auto-detection)
    """

    def detect(
        self,
        kps_list: list[np.ndarray],
        confs_list: list[np.ndarray],
        frame_width: float,
        exercise_type: str = "squat",
    ) -> AngleDetectionResult:
        """Detect camera angle from keypoint horizontal spread."""
        kps   = kps_list[:DETECTOR_FRAME_LIMIT]
        confs = confs_list[:DETECTOR_FRAME_LIMIT]

        if not kps or frame_width <= 0:
            logger.warning("CameraAngleDetector: empty keypoints or zero frame_width")
            return AngleDetectionResult("unknown", 0.0, 0.0, {})

        spread_ratios: list[float] = []

        for frame_kps, frame_confs in zip(kps, confs):
            frame_spread = self._frame_spread_ratio(frame_kps, frame_confs, frame_width)
            if frame_spread is not None:
                spread_ratios.append(frame_spread)

        if not spread_ratios:
            logger.warning("CameraAngleDetector: no confident keypoint pairs found")
            return AngleDetectionResult("unknown", 0.0, 0.0, {})

        avg_spread = float(np.mean(spread_ratios))
        spread_std  = float(np.std(spread_ratios))

        # Classify based on spread ratio
        if avg_spread < SIDE_THRESHOLD:
            detected = "side"
            # Confidence: how far below the threshold (lower = more confident side view)
            confidence = float(np.clip(1.0 - avg_spread / SIDE_THRESHOLD, 0.0, 1.0))
        elif avg_spread > FRONT_THRESHOLD:
            detected = "front"
            # Confidence: how far above the threshold
            confidence = float(np.clip((avg_spread - FRONT_THRESHOLD) / (1.0 - FRONT_THRESHOLD), 0.0, 1.0))
        else:
            detected = "45deg"
            # Confidence: how close to midpoint of the 45° band (0.25)
            mid = (SIDE_THRESHOLD + FRONT_THRESHOLD) / 2.0   # 0.25
            distance_from_mid = abs(avg_spread - mid)
            confidence = float(np.clip(1.0 - distance_from_mid / (mid - SIDE_THRESHOLD), 0.0, 1.0))

        # Low consistency (high std dev) reduces confidence
        if spread_std > 0.10:
            confidence *= 0.75

        confidence = float(np.clip(confidence, 0.0, 1.0))

        # Build stat warnings for affected (angle, exercise) combinations
        warnings = dict(_STAT_WARNINGS.get((detected, exercise_type), {}))

        logger.info(
            f"CameraAngleDetector: avg_spread={avg_spread:.3f} std={spread_std:.3f} "
            f"→ {detected} (conf={confidence:.2f})"
        )

        return AngleDetectionResult(
            detected_angle=detected,
            confidence=confidence,
            spread_ratio=avg_spread,
            warnings=warnings,
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _frame_spread_ratio(
        self,
        kps: np.ndarray,
        confs: np.ndarray,
        frame_width: float,
    ) -> float | None:
        """
        Compute the horizontal spread ratio for a single frame.

        Takes the maximum horizontal distance between the left and right
        shoulders AND the left and right hips, then divides by frame_width.
        Returns None if no confident pairs are found.
        """
        ratios: list[float] = []

        # Shoulder spread
        if (
            confs[KP_L_SHOULDER] >= MIN_KP_CONF
            and confs[KP_R_SHOULDER] >= MIN_KP_CONF
            and not np.isnan(kps[KP_L_SHOULDER]).any()
            and not np.isnan(kps[KP_R_SHOULDER]).any()
        ):
            shoulder_spread = abs(float(kps[KP_R_SHOULDER][0]) - float(kps[KP_L_SHOULDER][0]))
            ratios.append(shoulder_spread / frame_width)

        # Hip spread
        if (
            confs[KP_L_HIP] >= MIN_KP_CONF
            and confs[KP_R_HIP] >= MIN_KP_CONF
            and not np.isnan(kps[KP_L_HIP]).any()
            and not np.isnan(kps[KP_R_HIP]).any()
        ):
            hip_spread = abs(float(kps[KP_R_HIP][0]) - float(kps[KP_L_HIP][0]))
            ratios.append(hip_spread / frame_width)

        return float(max(ratios)) if ratios else None

"""
angle_utils.py — Biomechanical Angle Utilities
===============================================
Camera distortion correction, joint angle computation, and confidence scoring.
Also provides symmetry/imbalance detection and eccentric/concentric tempo breakdown.

FormAI launch exercises:
  1. Squat      — knee flexion angle  (hip → knee → ankle)
  2. Deadlift   — hip hinge angle     (shoulder → hip → knee)
  3. Hip Thrust — hip extension angle (shoulder → hip → knee)
"""

import numpy as np

# ── COCO keypoint indices (YOLOv8 pose model) ────────────────────────────────
KP = {
    "nose": 0,
    "l_shoulder": 5, "r_shoulder": 6,
    "l_elbow": 7,    "r_elbow": 8,
    "l_wrist": 9,    "r_wrist": 10,
    "l_hip": 11,     "r_hip": 12,
    "l_knee": 13,    "r_knee": 14,
    "l_ankle": 15,   "r_ankle": 16,
}

# ── Thresholds ────────────────────────────────────────────────────────────────
SQUAT_DEPTH_THRESHOLD = 90.0     # degrees — knee flexion ≤ 90° = depth achieved
DEADLIFT_LOCKOUT_THRESHOLD = 170.0  # degrees — hip hinge ≥ 170° = lockout
HIP_THRUST_LOCKOUT_THRESHOLD = 170.0  # degrees — hip extension ≥ 170° = lockout
CONFIDENCE_WARN = 0.6
CONFIDENCE_SUPPRESS = 0.4
CAMERA_WARN_DEGREES = 20.0


def calculate_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """
    Compute the angle at vertex B formed by vectors BA and BC.

    Args:
        a, b, c: [x, y] coordinate arrays
    Returns:
        Angle in degrees [0, 180].  Returns NaN if any point is NaN.
    """
    if np.any(np.isnan(a)) or np.any(np.isnan(b)) or np.any(np.isnan(c)):
        return float("nan")

    ba = a - b
    bc = c - b
    cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0))))


def estimate_camera_elevation_angle(keypoints: np.ndarray) -> float:
    """
    Estimates camera elevation angle from femur/tibia segment ratio.

    A level camera → femur pixel length ≈ tibia pixel length (ratio ≈ 1.03).
    A low camera foreshortens the upper segment → ratio drops.

    Args:
        keypoints: (17, 2) smoothed keypoints array
    Returns:
        Estimated camera elevation in degrees (0 = level).
    """
    hip   = keypoints[KP["l_hip"]]
    knee  = keypoints[KP["l_knee"]]
    ankle = keypoints[KP["l_ankle"]]

    if np.any(np.isnan(hip)) or np.any(np.isnan(knee)) or np.any(np.isnan(ankle)):
        return 0.0

    d_upper = np.linalg.norm(hip - knee)
    d_lower = np.linalg.norm(knee - ankle)

    EXPECTED_RATIO = 1.03
    observed_ratio = d_upper / max(d_lower, 1e-6)

    if observed_ratio < EXPECTED_RATIO * 0.85:
        cos_theta = observed_ratio / EXPECTED_RATIO
        camera_angle_rad = np.arccos(np.clip(cos_theta, -1.0, 1.0))
        return float(np.degrees(camera_angle_rad))

    return 0.0


def correct_joint_angle(raw_angle: float, camera_elevation_deg: float) -> float:
    """
    First-order perspective correction for a sagittal-plane joint angle.

    For tilt > CAMERA_WARN_DEGREES, returns uncorrected angle (flagged elsewhere).

    Args:
        raw_angle: Measured angle in degrees
        camera_elevation_deg: Estimated camera tilt from estimate_camera_elevation_angle()
    Returns:
        Corrected angle in degrees
    """
    if camera_elevation_deg > CAMERA_WARN_DEGREES:
        return raw_angle  # Return uncorrected; confidence score handles the warning

    theta = np.radians(camera_elevation_deg)
    raw_rad = np.radians(raw_angle)
    corrected_rad = np.arctan2(np.sin(raw_rad) * np.cos(theta), np.cos(raw_rad))
    return float(np.degrees(corrected_rad))


def compute_angle_confidence(
    keypoint_confs: list,
    camera_elevation_deg: float,
    occlusion_ratio: float,
) -> float:
    """
    Composite confidence score [0.0–1.0] for a joint angle measurement.

    Weights:
      50% — keypoint detection confidence
      30% — camera angle quality
      20% — temporal stability (no occlusion)
    """
    kp_score = float(np.mean(keypoint_confs))

    cam_penalty = max(0.0, 1.0 - (camera_elevation_deg - 10.0) / 30.0)
    cam_score = float(np.clip(cam_penalty, 0.3, 1.0))

    stability_score = 1.0 - occlusion_ratio

    confidence = 0.5 * kp_score + 0.3 * cam_score + 0.2 * stability_score
    return round(float(np.clip(confidence, 0.0, 1.0)), 2)


def get_exercise_angle(
    keypoints: np.ndarray,
    confidences: np.ndarray,
    exercise_type: str,
    camera_elevation_deg: float = 0.0,
    occlusion_ratio: float = 0.0,
) -> dict:
    """
    Calculate the primary biomechanical angle for an exercise.

    Returns a dict with:
        raw_angle, corrected_angle, confidence, cue, depth_status
    """
    if exercise_type == "squat":
        triplet = (KP["l_hip"], KP["l_knee"], KP["l_ankle"])
        threshold = SQUAT_DEPTH_THRESHOLD
        achieved_label = "depth_achieved"
        shallow_label = "depth_shallow"
    elif exercise_type == "deadlift":
        triplet = (KP["l_shoulder"], KP["l_hip"], KP["l_knee"])
        threshold = DEADLIFT_LOCKOUT_THRESHOLD
        achieved_label = "lockout_achieved"
        shallow_label = "not_locked_out"
    elif exercise_type == "hip_thrust":
        triplet = (KP["l_shoulder"], KP["l_hip"], KP["l_knee"])
        threshold = HIP_THRUST_LOCKOUT_THRESHOLD
        achieved_label = "lockout_achieved"
        shallow_label = "not_locked_out"
    else:
        raise ValueError(f"Unknown exercise type: {exercise_type}")

    a, b, c = keypoints[triplet[0]], keypoints[triplet[1]], keypoints[triplet[2]]
    raw_angle = calculate_angle(a, b, c)
    corrected_angle = correct_joint_angle(raw_angle, camera_elevation_deg)

    kp_confs = [float(confidences[idx]) for idx in triplet]
    confidence = compute_angle_confidence(kp_confs, camera_elevation_deg, occlusion_ratio)

    # Depth / lockout status
    if np.isnan(corrected_angle):
        depth_status = "detecting"
    elif exercise_type == "squat":
        depth_status = achieved_label if corrected_angle <= threshold else shallow_label
    else:
        depth_status = achieved_label if corrected_angle >= threshold else shallow_label

    # Observational cue text (never prescriptive)
    if np.isnan(corrected_angle) or confidence < CONFIDENCE_SUPPRESS:
        cue = None  # Suppressed entirely
    elif confidence < CONFIDENCE_WARN:
        cue = "⚠ Low confidence — camera angle may affect accuracy."
    elif depth_status == achieved_label:
        cue = "✓ Good position observed."
    else:
        if exercise_type == "squat":
            cue = f"Observed depth: {int(corrected_angle)}°. Review squat depth with your trainer."
        else:
            cue = f"Hip angle observed at {int(corrected_angle)}°. Review lockout position with your trainer."

    return {
        "raw_angle": raw_angle if not np.isnan(raw_angle) else None,
        "corrected_angle": corrected_angle if not np.isnan(corrected_angle) else None,
        "confidence": confidence,
        "depth_status": depth_status,
        "cue": cue,
        "camera_elevation_deg": round(camera_elevation_deg, 1),
        "low_confidence_warning": confidence < CONFIDENCE_WARN,
    }


def count_reps(angles: list, exercise_type: str) -> int:
    """
    Count exercise repetitions from a time-series of angles.
    Uses simple peak detection with hysteresis.

    Args:
        angles: List of angle measurements per frame (None values skipped)
        exercise_type: 'squat' | 'deadlift' | 'hip_thrust'

    Returns:
        Rep count (capped at 50 to prevent misuse)
    """
    valid = [a for a in angles if a is not None and not np.isnan(a)]
    if not valid:
        return 0

    # Squat: count troughs (low angle = deep squat = rep bottom)
    # Deadlift/Hip Thrust: count peaks (high angle = lockout = rep top)
    is_squat = exercise_type == "squat"
    threshold = SQUAT_DEPTH_THRESHOLD if is_squat else (DEADLIFT_LOCKOUT_THRESHOLD - 10)

    reps = 0
    in_rep = False

    for angle in valid:
        if is_squat:
            if not in_rep and angle <= threshold:
                in_rep = True
            elif in_rep and angle > threshold + 15:
                reps += 1
                in_rep = False
        else:
            if not in_rep and angle >= threshold:
                in_rep = True
            elif in_rep and angle < threshold - 15:
                reps += 1
                in_rep = False

    return min(reps, 50)  # Safety cap per plan spec


# ── Per-rep extraction ────────────────────────────────────────────────────────

def _extract_per_rep_angles(angles: list, exercise_type: str) -> list[float]:
    """
    Walk the angle time-series and record the extremum angle for each detected rep.

    For squats: records the *minimum* (deepest) angle reached inside each rep.
    For deadlift/hip_thrust: records the *maximum* (highest lockout) angle.

    Args:
        angles: Per-frame list of floats/None from _process_form_ai_sync
        exercise_type: 'squat' | 'deadlift' | 'hip_thrust'

    Returns:
        List of one float per rep (capped at 50). Empty list when no reps found.
    """
    valid = [a for a in angles if a is not None and not np.isnan(a)]
    if not valid:
        return []

    is_squat = exercise_type == "squat"
    enter_threshold = SQUAT_DEPTH_THRESHOLD if is_squat else (DEADLIFT_LOCKOUT_THRESHOLD - 10)
    exit_hysteresis = 15.0

    per_rep: list[float] = []
    in_rep = False
    rep_extremum: float | None = None

    for angle in valid:
        if is_squat:
            if not in_rep and angle <= enter_threshold:
                in_rep = True
                rep_extremum = angle
            elif in_rep:
                # Track minimum (deepest point) within rep
                if rep_extremum is None or angle < rep_extremum:
                    rep_extremum = angle
                if angle > enter_threshold + exit_hysteresis:
                    per_rep.append(rep_extremum)
                    in_rep = False
                    rep_extremum = None
        else:
            if not in_rep and angle >= enter_threshold:
                in_rep = True
                rep_extremum = angle
            elif in_rep:
                # Track maximum (full lockout peak) within rep
                if rep_extremum is None or angle > rep_extremum:
                    rep_extremum = angle
                if angle < enter_threshold - exit_hysteresis:
                    per_rep.append(rep_extremum)
                    in_rep = False
                    rep_extremum = None

    return per_rep[:50]  # Safety cap


# ── Symmetry & Imbalance Detection ───────────────────────────────────────────

def compute_symmetry_metrics(
    keypoints_history: list,
    exercise_type: str,
) -> dict | None:
    """
    Compare left and right joint trajectories frame-by-frame to detect
    lateral asymmetries, dominant side loading, and depth imbalances.

    Args:
        keypoints_history:  List of (17, 2) smoothed keypoint arrays, one per frame.
                            Must contain at least 10 frames for meaningful output.
        exercise_type:      'squat' | 'deadlift' | 'hip_thrust'

    Returns:
        dict with keys:
            symmetry_score     — 0–100 (100 = perfect symmetry)
            dominant_side      — 'left' | 'right' | 'balanced'
            lateral_shift_px   — avg horizontal offset of hip midpoint vs shoulder midpoint
            knee_angle_diff_deg — avg |L_knee_angle - R_knee_angle| across all frames
            depth_asymmetry_px — L vs R hip vertical gap at the bottom of each rep
            observations       — list of human-readable observation strings
        None if keypoints_history is empty or too short.
    """
    if not keypoints_history or len(keypoints_history) < 10:
        return None

    lateral_shifts: list[float] = []
    knee_diffs: list[float] = []
    l_hip_bottoms: list[float] = []
    r_hip_bottoms: list[float] = []

    for kps in keypoints_history:
        if kps is None or np.any(np.isnan(kps)):
            continue

        # ── Lateral hip shift: horizontal offset hip midpoint vs shoulder midpoint ──
        l_hip  = kps[KP["l_hip"]]
        r_hip  = kps[KP["r_hip"]]
        l_sho  = kps[KP["l_shoulder"]]
        r_sho  = kps[KP["r_shoulder"]]

        if not (np.any(np.isnan(l_hip)) or np.any(np.isnan(r_hip))
                or np.any(np.isnan(l_sho)) or np.any(np.isnan(r_sho))):
            hip_mid_x = (l_hip[0] + r_hip[0]) / 2.0
            sho_mid_x = (l_sho[0] + r_sho[0]) / 2.0
            lateral_shifts.append(hip_mid_x - sho_mid_x)   # +ve = shifted right

        # ── Knee angle asymmetry (squats most relevant; included for all) ──────────
        l_knee = kps[KP["l_knee"]]
        r_knee = kps[KP["r_knee"]]
        l_ankle = kps[KP["l_ankle"]]
        r_ankle = kps[KP["r_ankle"]]

        if not any(
            np.any(np.isnan(p)) for p in [l_hip, l_knee, l_ankle, r_hip, r_knee, r_ankle]
        ):
            l_angle = calculate_angle(l_hip, l_knee, l_ankle)
            r_angle = calculate_angle(r_hip, r_knee, r_ankle)
            if not (np.isnan(l_angle) or np.isnan(r_angle)):
                knee_diffs.append(abs(l_angle - r_angle))

        # ── Depth asymmetry: track vertical hip positions for bottom-of-rep ─────────
        # Lower y-value in image coordinates = higher on screen = less depth
        # We collect all frames and later find the frame with the minimum combined hip height
        if not (np.any(np.isnan(l_hip)) or np.any(np.isnan(r_hip))):
            l_hip_bottoms.append(float(l_hip[1]))
            r_hip_bottoms.append(float(r_hip[1]))

    # ── Aggregate ──────────────────────────────────────────────────────────────
    avg_lateral = float(np.mean(lateral_shifts)) if lateral_shifts else 0.0
    avg_knee_diff = float(np.mean(knee_diffs)) if knee_diffs else 0.0

    # Depth asymmetry: compare L vs R hip at the deepest frame
    depth_asymmetry_px = 0.0
    if l_hip_bottoms and r_hip_bottoms and len(l_hip_bottoms) == len(r_hip_bottoms):
        combined_depth = [l + r for l, r in zip(l_hip_bottoms, r_hip_bottoms)]
        bottom_idx = int(np.argmax(combined_depth))  # max y = deepest position
        depth_asymmetry_px = abs(l_hip_bottoms[bottom_idx] - r_hip_bottoms[bottom_idx])

    # ── Symmetry score ────────────────────────────────────────────────────────
    # Penalty components (each 0–1, lower is worse symmetry):
    #   lateral penalty: every 5px of shift costs 4 points (max 40 pts lost)
    lateral_penalty = min(1.0, abs(avg_lateral) / 50.0)   # 50px = full penalty
    #   knee diff penalty: every 5° diff costs 5 points (max 40 pts lost)
    knee_penalty = min(1.0, avg_knee_diff / 30.0)          # 30° = full penalty
    #   depth penalty: every 10px vertical gap costs 4 points (max 20 pts lost)
    depth_penalty = min(1.0, depth_asymmetry_px / 40.0)    # 40px = full penalty

    raw_score = 100.0 - (lateral_penalty * 40.0 + knee_penalty * 40.0 + depth_penalty * 20.0)
    symmetry_score = round(max(0.0, min(100.0, raw_score)), 1)

    # ── Dominant side ─────────────────────────────────────────────────────────
    # avg_lateral > 0 = hip shifted right relative to shoulders = left-dominant
    # avg_lateral < 0 = hip shifted left = right-dominant
    if abs(avg_lateral) < 8.0:
        dominant_side = "balanced"
    elif avg_lateral > 0:
        dominant_side = "left"    # hip shifted toward right → loading left side
    else:
        dominant_side = "right"

    # ── Human-readable observations ───────────────────────────────────────────
    observations: list[str] = []
    if abs(avg_lateral) >= 8.0:
        direction = "right" if avg_lateral > 0 else "left"
        observations.append(
            f"Hip midpoint shifts ~{abs(avg_lateral):.0f}px toward the {direction} "
            "relative to shoulders — may indicate uneven weight distribution."
        )
    if avg_knee_diff >= 8.0:
        observations.append(
            f"Average L/R knee angle difference: {avg_knee_diff:.1f}°. "
            "Consider reviewing stance width and foot turnout symmetry with your trainer."
        )
    if depth_asymmetry_px >= 12.0:
        observations.append(
            f"Left and right hips show ~{depth_asymmetry_px:.0f}px vertical gap at the bottom "
            "of the rep — depth may be uneven between sides."
        )
    if not observations:
        observations.append("Left and right sides appear well-balanced across this session.")

    return {
        "symmetry_score":      symmetry_score,
        "dominant_side":       dominant_side,
        "lateral_shift_px":    round(avg_lateral, 1),
        "knee_angle_diff_deg": round(avg_knee_diff, 1),
        "depth_asymmetry_px":  round(depth_asymmetry_px, 1),
        "observations":        observations,
    }


# ── Eccentric / Concentric Tempo Breakdown ────────────────────────────────────

def _compute_tempo_phases(
    angles: list,
    fps: float,
    exercise_type: str,
) -> dict:
    """
    Segment the angle time-series into eccentric, pause, and concentric phases
    for each detected rep, then compute average durations and a tempo label.

    Phase definitions (for squats — inverted for deadlift/hip_thrust):
      Eccentric  — angle is *decreasing* toward the load peak (going into depth/hinge)
      Pause      — angle within ±3° of the local extremum for ≥2 consecutive frames
      Concentric — angle is *increasing* back toward start position (coming up)

    Args:
        angles:        Per-frame corrected_angle list (None values filtered internally)
        fps:           Video frames-per-second (for converting frame counts → seconds)
        exercise_type: 'squat' | 'deadlift' | 'hip_thrust'

    Returns:
        dict with keys:
            per_rep_phases    — list of {ecc_frames, pause_frames, con_frames} per rep
            avg_ecc_sec       — average eccentric duration in seconds
            avg_pause_sec     — average pause duration in seconds
            avg_con_sec       — average concentric duration in seconds
            avg_ecc_con_ratio — avg_ecc_sec / avg_con_sec  (None if con=0)
            tempo_label       — e.g. '3:1:2'  ('—' if fewer than 2 reps)
    """
    fps = max(fps, 1.0)   # Guard against 0 fps
    is_squat = exercise_type == "squat"

    # Filter to valid numeric values while retaining frame indices
    valid_pairs = [
        (i, a) for i, a in enumerate(angles)
        if a is not None and not np.isnan(a)
    ]

    if len(valid_pairs) < 20:   # Not enough signal for phase segmentation
        return _empty_tempo_result()

    indices, vals = zip(*valid_pairs)
    vals = list(vals)

    # ── Enter / exit thresholds (mirror logic from count_reps) ────────────────
    enter_threshold = SQUAT_DEPTH_THRESHOLD if is_squat else (DEADLIFT_LOCKOUT_THRESHOLD - 10)
    exit_hysteresis = 15.0
    PAUSE_TOLERANCE = 3.0   # degrees: within ±3° of extremum = pause
    PAUSE_MIN_FRAMES = 2    # must hold for ≥2 frames to count as pause

    per_rep_phases: list[dict] = []
    in_rep = False
    rep_start = 0
    rep_extremum: float | None = None
    extremum_idx = 0

    i = 0
    while i < len(vals):
        angle = vals[i]

        if is_squat:
            enter = angle <= enter_threshold
            exit_cond = in_rep and angle > enter_threshold + exit_hysteresis
        else:
            enter = angle >= enter_threshold
            exit_cond = in_rep and angle < enter_threshold - exit_hysteresis

        if not in_rep and enter:
            in_rep = True
            rep_start = i
            rep_extremum = angle
            extremum_idx = i

        elif in_rep:
            # Track extremum
            if is_squat:
                if rep_extremum is None or angle < rep_extremum:
                    rep_extremum = angle
                    extremum_idx = i
            else:
                if rep_extremum is None or angle > rep_extremum:
                    rep_extremum = angle
                    extremum_idx = i

            if exit_cond:
                rep_end = i
                in_rep = False

                # ── Phase segmentation within this rep ────────────────────────
                rep_vals = vals[rep_start:rep_end + 1]
                ext_local = extremum_idx - rep_start  # local index of extremum

                # Find pause window: frames within PAUSE_TOLERANCE of extremum
                pause_start = ext_local
                pause_end   = ext_local
                for k in range(max(0, ext_local - 1), -1, -1):
                    if abs(rep_vals[k] - rep_extremum) <= PAUSE_TOLERANCE:
                        pause_start = k
                    else:
                        break
                for k in range(ext_local + 1, len(rep_vals)):
                    if abs(rep_vals[k] - rep_extremum) <= PAUSE_TOLERANCE:
                        pause_end = k
                    else:
                        break

                # Only count as a pause if it spans ≥ PAUSE_MIN_FRAMES
                pause_frames = (pause_end - pause_start + 1) if (pause_end - pause_start) >= PAUSE_MIN_FRAMES - 1 else 0
                ecc_frames   = max(0, pause_start)                          # frames before pause
                con_frames   = max(0, len(rep_vals) - 1 - pause_end)        # frames after pause

                per_rep_phases.append({
                    "ecc_frames":   ecc_frames,
                    "pause_frames": pause_frames,
                    "con_frames":   con_frames,
                })

                rep_extremum = None

        i += 1

    if len(per_rep_phases) < 2:
        return _empty_tempo_result()

    # ── Convert frames → seconds and aggregate ────────────────────────────────
    ecc_secs   = [p["ecc_frames"]   / fps for p in per_rep_phases]
    pause_secs = [p["pause_frames"] / fps for p in per_rep_phases]
    con_secs   = [p["con_frames"]   / fps for p in per_rep_phases]

    avg_ecc   = round(float(np.mean(ecc_secs)),   2)
    avg_pause = round(float(np.mean(pause_secs)), 2)
    avg_con   = round(float(np.mean(con_secs)),   2)

    ratio = round(avg_ecc / avg_con, 2) if avg_con > 0 else None

    # Tempo label: round to nearest 0.5s for a clean label
    def _round_half(v: float) -> str:
        rounded = round(v * 2) / 2
        return str(int(rounded)) if rounded == int(rounded) else f"{rounded:.1f}"

    tempo_label = f"{_round_half(avg_ecc)}:{_round_half(avg_pause)}:{_round_half(avg_con)}"

    return {
        "per_rep_phases":     per_rep_phases,
        "avg_ecc_sec":        avg_ecc,
        "avg_pause_sec":      avg_pause,
        "avg_con_sec":        avg_con,
        "avg_ecc_con_ratio":  ratio,
        "tempo_label":        tempo_label,
    }


def _empty_tempo_result() -> dict:
    """Return a safe, all-None tempo result when data is insufficient."""
    return {
        "per_rep_phases":    [],
        "avg_ecc_sec":       None,
        "avg_pause_sec":     None,
        "avg_con_sec":       None,
        "avg_ecc_con_ratio": None,
        "tempo_label":       "—",
    }


def _letter_grade(score_pct: float) -> str:
    """Map depth/lockout score percentage to a letter grade."""
    if score_pct >= 90:
        return "A"
    if score_pct >= 75:
        return "B"
    if score_pct >= 60:
        return "C"
    if score_pct >= 45:
        return "D"
    return "F"


def _form_label(score_pct: float) -> str:
    """Map score percentage to a plain-language form label."""
    if score_pct >= 90:
        return "Excellent"
    if score_pct >= 75:
        return "Good"
    if score_pct >= 60:
        return "Fair"
    if score_pct >= 45:
        return "Needs Work"
    return "Review with Your Trainer"


def compute_session_stats(
    angles_per_frame: list,
    confidences_per_frame: list,
    rep_count: int,
    duration_sec: float,
    exercise_type: str,
    keypoints_history: list | None = None,
    fps: float = 30.0,
) -> dict:
    """
    Derive per-session biomechanical summary statistics for the dashboard.

    Per-rep angles are ephemeral — derived in memory only, never written to DB.
    All return values default to None when there are fewer than 2 reps or
    the angle data is too sparse to be meaningful.

    Args:
        angles_per_frame:       Per-frame list of corrected_angle floats/None
        confidences_per_frame:  Per-frame list of confidence floats [0–1]
        rep_count:              Detected rep count (from count_reps)
        duration_sec:           Video duration in seconds
        exercise_type:          'squat' | 'deadlift' | 'hip_thrust'
        keypoints_history:      Optional list of (17, 2) keypoint arrays for symmetry analysis.
                                When provided, symmetry metrics are computed and included.
        fps:                    Frames per second of the input video (used for tempo phase
                                timing). Defaults to 30.0 when not provided.

    Returns:
        dict with keys:
            depth_score_pct, avg_primary_angle, best_rep_angle, worst_rep_angle,
            angle_std_dev, tempo_sec_per_rep, avg_confidence,
            per_rep_angles, letter_grade, form_label,
            per_rep_phases, avg_ecc_sec, avg_pause_sec, avg_con_sec,
            avg_ecc_con_ratio, tempo_label, symmetry
    """
    per_rep = _extract_per_rep_angles(angles_per_frame, exercise_type)

    # Need at least 1 rep for any meaningful stats; grade requires meaningful pct
    has_data = len(per_rep) >= 1

    # Target angle thresholds (same as count logic)
    is_squat = exercise_type == "squat"
    if is_squat:
        target = SQUAT_DEPTH_THRESHOLD          # angle must be ≤ target
        reps_on_target = sum(1 for a in per_rep if a <= target)
    else:
        target = HIP_THRUST_LOCKOUT_THRESHOLD   # angle must be ≥ target
        reps_on_target = sum(1 for a in per_rep if a >= target)

    if has_data:
        score_pct = round((reps_on_target / len(per_rep)) * 100, 1)
        avg_angle  = round(float(np.mean(per_rep)), 1)
        best_angle = round(float(min(per_rep) if is_squat else max(per_rep)), 1)
        worst_angle = round(float(max(per_rep) if is_squat else min(per_rep)), 1)
        std_dev     = round(float(np.std(per_rep)), 1) if len(per_rep) > 1 else 0.0
        grade       = _letter_grade(score_pct)
        label       = _form_label(score_pct)
    else:
        score_pct   = None
        avg_angle   = None
        best_angle  = None
        worst_angle = None
        std_dev     = None
        grade       = None
        label       = None

    # Tempo (simple): sec per rep — None if fewer than 2 reps (single-rep tempo is meaningless)
    if rep_count and rep_count >= 2 and duration_sec:
        tempo = round(duration_sec / rep_count, 1)
    else:
        tempo = None

    # Confidence: mean across all frames with valid readings
    valid_confs = [c for c in confidences_per_frame if c is not None and not np.isnan(c)]
    avg_conf = round(float(np.mean(valid_confs)), 2) if valid_confs else None

    # ── Eccentric / Concentric Tempo Phases ───────────────────────────────────
    tempo_phases = _compute_tempo_phases(angles_per_frame, fps, exercise_type)

    # ── Symmetry & Imbalance Detection ───────────────────────────────────────
    symmetry = compute_symmetry_metrics(keypoints_history, exercise_type) if keypoints_history else None

    return {
        # ── Existing keys (unchanged) ──────────────────────────────────────
        "depth_score_pct":   score_pct,
        "avg_primary_angle": avg_angle,
        "best_rep_angle":    best_angle,
        "worst_rep_angle":   worst_angle,
        "angle_std_dev":     std_dev,
        "tempo_sec_per_rep": tempo,
        "avg_confidence":    avg_conf,
        "per_rep_angles":    [round(a, 1) for a in per_rep],
        "letter_grade":      grade,
        "form_label":        label,
        # ── New Tier-1 keys ────────────────────────────────────────────────
        "per_rep_phases":    tempo_phases["per_rep_phases"],
        "avg_ecc_sec":       tempo_phases["avg_ecc_sec"],
        "avg_pause_sec":     tempo_phases["avg_pause_sec"],
        "avg_con_sec":       tempo_phases["avg_con_sec"],
        "avg_ecc_con_ratio": tempo_phases["avg_ecc_con_ratio"],
        "tempo_label":       tempo_phases["tempo_label"],
        "symmetry":          symmetry,
    }

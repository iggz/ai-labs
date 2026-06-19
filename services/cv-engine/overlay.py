"""
overlay.py — Premium Visual Overlay Renderers
==============================================
HHB-branded neon skeleton (FormAI) and velocity trail (SlingShot) renderers.
All colors match the HHB rose/lilac brand palette.
"""

import cv2
import numpy as np


# ── HHB Color Palette (BGR for OpenCV) ────────────────────────────────────────
BONE_COLOR = (255, 140, 180)        # Soft lilac
JOINT_COLOR_HIGH = (255, 200, 130)  # Warm rose-gold
JOINT_COLOR_LOW = (180, 80, 80)     # Muted low-confidence
GLOW_COLOR = (255, 160, 200)        # Neon lilac glow
ARC_COLOR_GOOD = (200, 255, 140)    # Mint green — good range of motion
ARC_COLOR_WARN = (80, 180, 255)     # Amber — restricted ROM

# Asymmetric L/R bone colors (shown when symmetry deviation > threshold)
BONE_LEFT  = (210, 210, 50)   # Teal  (BGR)
BONE_RIGHT = (100, 80, 240)   # Rose  (BGR)
GLOW_LEFT  = (220, 220, 80)   # Teal glow
GLOW_RIGHT = (130, 100, 255)  # Rose glow
SYMMETRY_THRESHOLD_DEG = 15.0  # Min L/R knee angle diff to trigger split coloring

# ROM gauge color zones (BGR)
GAUGE_RED    = (60, 60, 220)    # Bright red
GAUGE_YELLOW = (30, 200, 240)   # Amber-yellow
GAUGE_GREEN  = (120, 220, 80)   # Neon mint

# COCO skeleton connections, split by side for asymmetric coloring
SKELETON_PAIRS_LEFT = [
    (5, 7), (7, 9),       # Left arm
    (5, 11),              # Left torso
    (11, 13), (13, 15),   # Left leg
]
SKELETON_PAIRS_RIGHT = [
    (6, 8), (8, 10),      # Right arm
    (6, 12),              # Right torso
    (12, 14), (14, 16),   # Right leg
]
SKELETON_PAIRS_CENTER = [
    (5, 6),               # Shoulders
    (11, 12),             # Hips
]
# All pairs together (for non-asymmetric rendering)
SKELETON_PAIRS = SKELETON_PAIRS_LEFT + SKELETON_PAIRS_RIGHT + SKELETON_PAIRS_CENTER


def fast_glow_blur(glow_layer: np.ndarray, downsample_factor: int = 4) -> np.ndarray:
    """
    Pyramid-accelerated glow blur. Downsamples, blurs small, upsamples.
    (5,5) kernel at 1/4 scale ≈ (20,20) kernel at full scale.
    ~10× faster than direct GaussianBlur at 1080p.
    """
    h, w = glow_layer.shape[:2]
    small_w = max(1, w // downsample_factor)
    small_h = max(1, h // downsample_factor)
    small = cv2.resize(glow_layer, (small_w, small_h), interpolation=cv2.INTER_AREA)
    small_blurred = cv2.GaussianBlur(small, (5, 5), 2.5)
    return cv2.resize(small_blurred, (w, h), interpolation=cv2.INTER_LINEAR)


def create_neon_skeleton_frame(
    frame: np.ndarray,
    keypoints: np.ndarray,
    confidences: np.ndarray,
    angle: float,
    angle_confidence: float,
    exercise_type: str = "squat",
    symmetry_deviation: float = 0.0,
    rep_count: int = 0,
    overlay_mode: str = "full",
) -> np.ndarray:
    """
    Render a premium glowing skeleton overlay onto a video frame.
    Includes a range-of-motion arc at the primary joint.

    Args:
        frame:               BGR video frame
        keypoints:           (17, 2) smoothed keypoint positions
        confidences:         (17,) detection confidences
        angle:               Primary joint angle in degrees (or NaN)
        angle_confidence:    Composite confidence score [0.0–1.0]
        exercise_type:       'squat' | 'deadlift' | 'hip_thrust'
        symmetry_deviation:  |L_knee_angle - R_knee_angle| in degrees.
                             When > SYMMETRY_THRESHOLD_DEG, left bones render
                             teal and right bones render rose instead of the
                             default lilac palette.
        rep_count:           Current rep count to display in top-left badge.
        overlay_mode:        'full' | 'minimal'.
                             In 'minimal' mode the neon skeleton, ROM arcs,
                             and angle badges are bypassed. Only the
                             low-confidence warning banner is kept (the rep
                             counter is drawn separately in the HUD pass).

    Returns:
        Annotated frame (same shape as input)
    """
    # ── Feature 8: Minimal mode — skip all decorative skeleton elements ────────
    if overlay_mode == "minimal":
        # Only retain the low-confidence warning banner
        result = frame.copy()
        if angle_confidence < 0.6:
            warning_text = "Low confidence - check camera position"
            cv2.putText(
                result, warning_text, (10, frame.shape[0] - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 255), 1, cv2.LINE_AA,
            )
        return result

    overlay = frame.copy()
    glow_layer = np.zeros_like(frame)
    use_split_colors = symmetry_deviation > SYMMETRY_THRESHOLD_DEG

    # ── Draw glowing bone connections ─────────────────────────────────────────────
    def _draw_pairs(pairs, bone_col, glow_col):
        for i, j in pairs:
            if (
                confidences[i] > 0.3
                and confidences[j] > 0.3
                and not np.isnan(keypoints[i]).any()
                and not np.isnan(keypoints[j]).any()
            ):
                pt1 = tuple(keypoints[i].astype(int))
                pt2 = tuple(keypoints[j].astype(int))
                cv2.line(glow_layer, pt1, pt2, glow_col, 8)
                cv2.line(overlay, pt1, pt2, bone_col, 3, cv2.LINE_AA)

    if use_split_colors:
        _draw_pairs(SKELETON_PAIRS_LEFT,   BONE_LEFT,  GLOW_LEFT)
        _draw_pairs(SKELETON_PAIRS_RIGHT,  BONE_RIGHT, GLOW_RIGHT)
        _draw_pairs(SKELETON_PAIRS_CENTER, BONE_COLOR, GLOW_COLOR)
    else:
        _draw_pairs(SKELETON_PAIRS, BONE_COLOR, GLOW_COLOR)

    # ── Draw joint dots with confidence coloring ──────────────────────────────
    for i in range(len(keypoints)):
        if confidences[i] > 0.3 and not np.isnan(keypoints[i]).any():
            pt = tuple(keypoints[i].astype(int))
            color = JOINT_COLOR_HIGH if confidences[i] > 0.7 else JOINT_COLOR_LOW
            cv2.circle(glow_layer, pt, 12, GLOW_COLOR, -1)
            cv2.circle(overlay, pt, 6, color, -1, cv2.LINE_AA)
            cv2.circle(overlay, pt, 2, (255, 255, 255), -1, cv2.LINE_AA)

    # ── Range-of-motion arc at primary joint ──────────────────────────────────
    if exercise_type == "squat":
        vertex_idx, arm1_idx, arm2_idx = 13, 11, 15  # knee, hip, ankle
    else:
        vertex_idx, arm1_idx, arm2_idx = 11, 5, 13   # hip, shoulder, knee

    if (
        not np.isnan(keypoints[vertex_idx]).any()
        and not np.isnan(keypoints[arm1_idx]).any()
        and not np.isnan(keypoints[arm2_idx]).any()
        and not np.isnan(angle)
    ):
        vertex_pt = tuple(keypoints[vertex_idx].astype(int))
        arc_color = ARC_COLOR_GOOD if (
            (exercise_type == "squat" and angle < 95)
            or (exercise_type != "squat" and angle > 160)
        ) else ARC_COLOR_WARN

        v1 = keypoints[arm1_idx] - keypoints[vertex_idx]
        v2 = keypoints[arm2_idx] - keypoints[vertex_idx]
        start_a = float(np.degrees(np.arctan2(-v1[1], v1[0])))
        end_a   = float(np.degrees(np.arctan2(-v2[1], v2[0])))

        arc_overlay = overlay.copy()
        cv2.ellipse(
            arc_overlay, vertex_pt, (45, 45),
            0, start_a, end_a, arc_color, 2, cv2.LINE_AA
        )
        cv2.addWeighted(arc_overlay, 0.7, overlay, 0.3, 0, overlay)

    # ── Angle badge text ──────────────────────────────────────────────────────
    if angle_confidence >= 0.6 and not np.isnan(angle):
        badge_text = f"{int(angle)}"
        badge_pt = (
            int(keypoints[vertex_idx][0]) + 20 if not np.isnan(keypoints[vertex_idx]).any() else 60,
            int(keypoints[vertex_idx][1]) - 10 if not np.isnan(keypoints[vertex_idx]).any() else 60,
        )
        (tw, th), _ = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
        box_width = tw + 16
        cv2.rectangle(
            overlay,
            (badge_pt[0] - 8, badge_pt[1] - th - 8),
            (badge_pt[0] + box_width + 8, badge_pt[1] + 8),
            (30, 20, 30),
            -1,
        )
        cv2.putText(
            overlay, badge_text, badge_pt,
            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA,
        )
        # Draw the degree circle manually since Hershey fonts do not support unicode
        circle_x = badge_pt[0] + tw + 4
        circle_y = badge_pt[1] - th + 4
        cv2.circle(overlay, (circle_x, circle_y), 3, (255, 255, 255), 1, cv2.LINE_AA)

    # ── Low-confidence warning banner ─────────────────────────────────────────
    if angle_confidence < 0.6:
        warning_text = "Low confidence - check camera position"
        cv2.putText(
            overlay, warning_text, (10, frame.shape[0] - 30),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 255), 1, cv2.LINE_AA,
        )

    # ── Composite glow ─────────────────────────────────────────────────────
    glow_blurred = fast_glow_blur(glow_layer, downsample_factor=4)
    result = cv2.addWeighted(overlay, 1.0, glow_blurred, 0.4, 0)
    return result


# ── ROM Gauge (Semi-circular Speedometer) ───────────────────────────────────

def _gauge_pct(current_angle: float, exercise_type: str) -> float:
    """
    Map the current joint angle to a 0.0–1.0 gauge percentage.

    For squats the *target* is 90° (lower = better):
      standing 180° → 0%, parallel 90° → 100%, below parallel → clamped at 100%.
    For deadlift / hip thrust the *target* is 170° (higher = better):
      bent 90° → 0%, lockout 170° → 100%.
    """
    if exercise_type == "squat":
        # Map [180 → 90] onto [0% → 100%].  Below 90° stays at 100%.
        return float(np.clip((180.0 - current_angle) / 90.0, 0.0, 1.0))
    # deadlift / hip_thrust: Map [90 → 170] onto [0% → 100%]
    return float(np.clip((current_angle - 90.0) / 80.0, 0.0, 1.0))


def draw_rom_gauge(
    frame: np.ndarray,
    current_angle: float,
    exercise_type: str = "squat",
    overlay_mode: str = "full",
) -> np.ndarray:
    """
    Draw a semi-circular speedometer-style ROM gauge in the top-right corner.

    The arc sweeps across the **top** semicircle (like a car speedometer):
    left end = 0 %, right end = 100 % of the exercise target.

    Color zones (as fraction of progress toward the target angle):
      • Red    (0 – 50 %)  — far from target
      • Yellow (50 – 85 %) — approaching target
      • Green  (85 %+)     — target met / exceeded

    A needle points to the current angle position on the arc, and center text
    shows the live angle reading below the semicircle.

    Args:
        frame:         BGR video frame
        current_angle: Measured joint angle in degrees
        exercise_type: 'squat' | 'deadlift' | 'hip_thrust'
        overlay_mode:  'full' | 'minimal'. Bypassed when 'minimal'.

    Returns:
        Frame with gauge composited (unchanged if overlay_mode == 'minimal')
    """
    if overlay_mode == "minimal":
        return frame

    pct = _gauge_pct(current_angle, exercise_type)

    h, w = frame.shape[:2]
    gauge_size = 110
    margin = 12
    cx = w - margin - gauge_size // 2   # center-x in top-right
    cy = margin + gauge_size // 2 + 4   # center-y (nudged down for text below)
    radius = gauge_size // 2 - 8

    # ── Top semicircle ─────────────────────────────────────────────────────
    # OpenCV ellipse angles: 0° = 3 o'clock, positive = clockwise.
    # To draw the TOP half (9 o'clock → 12 o'clock → 3 o'clock) we sweep
    # from 180° to 360° but apply a 180° rotation to the ellipse, which
    # flips the arc vertically.  Equivalently, sweep from 180 to 360 with
    # a rotation angle of 180 — the math works out to drawing 0→180
    # but flipped.  The simplest correct approach: use negative angles.
    #   start_angle = -180  (9 o'clock)
    #   end_angle   =    0  (3 o'clock)
    # This sweeps counter-clockwise through the TOP.  But OpenCV treats
    # negative start as wrapping, so just use (180, 360) with rotation=180.
    ROTATION = 180     # flip the ellipse vertically
    ARC_START = 0      # right end (maps to 9 o'clock after rotation)
    ARC_END = 180      # left end  (maps to 3 o'clock after rotation)

    overlay = frame.copy()

    # Dark background pill (covers top arc + text below)
    pad = 10
    cv2.rectangle(
        overlay,
        (cx - radius - pad, cy - radius - pad),
        (cx + radius + pad, cy + pad + 20),
        (15, 10, 20),
        -1,
    )
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
    overlay = frame.copy()

    # ── Three colored arc zones ────────────────────────────────────────────
    # Zone boundaries as percentage of the arc sweep (0→180° after rotation):
    #   Red    0 – 50 %  → arc degrees 0 – 90
    #   Yellow 50 – 85 % → arc degrees 90 – 153
    #   Green  85 – 100% → arc degrees 153 – 180
    z1 = ARC_START + int(0.50 * 180)   # 50 % boundary
    z2 = ARC_START + int(0.85 * 180)   # 85 % boundary

    arc_thickness = 7
    cv2.ellipse(overlay, (cx, cy), (radius, radius), ROTATION, ARC_START, z1,      GAUGE_RED,    arc_thickness, cv2.LINE_AA)
    cv2.ellipse(overlay, (cx, cy), (radius, radius), ROTATION, z1,        z2,      GAUGE_YELLOW, arc_thickness, cv2.LINE_AA)
    cv2.ellipse(overlay, (cx, cy), (radius, radius), ROTATION, z2,        ARC_END, GAUGE_GREEN,  arc_thickness, cv2.LINE_AA)

    # ── Needle ─────────────────────────────────────────────────────────────
    # pct 0% → left end (9 o'clock = π radians), pct 100% → right end (0 rad)
    # Sweep from π → 0 as pct goes 0 → 1
    needle_rad = np.pi * (1.0 - pct)     # π → 0 as pct → 0→1
    needle_len = radius - 4
    needle_x = int(cx + needle_len * np.cos(needle_rad))
    needle_y = int(cy - needle_len * np.sin(needle_rad))  # minus because y-axis is flipped
    cv2.line(overlay, (cx, cy), (needle_x, needle_y), (255, 255, 255), 2, cv2.LINE_AA)
    cv2.circle(overlay, (cx, cy), 4, (220, 220, 220), -1, cv2.LINE_AA)

    # ── Zone color for needle tip ──────────────────────────────────────────
    if pct >= 0.85:
        zone_col = GAUGE_GREEN
    elif pct >= 0.50:
        zone_col = GAUGE_YELLOW
    else:
        zone_col = GAUGE_RED
    cv2.circle(overlay, (needle_x, needle_y), 3, zone_col, -1, cv2.LINE_AA)

    # ── Angle text (below the semicircle) ─────────────────────────────────
    angle_text = f"{int(round(current_angle))}"
    (tw, th), _ = cv2.getTextSize(angle_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    text_y = cy + 6 + th
    cv2.putText(
        overlay, angle_text,
        (cx - tw // 2, text_y),
        cv2.FONT_HERSHEY_SIMPLEX, 0.5, zone_col, 1, cv2.LINE_AA,
    )
    # Degree symbol (small circle to the right of the text)
    cv2.circle(overlay, (cx + tw // 2 + 4, text_y - th + 2), 2, zone_col, 1, cv2.LINE_AA)

    # Apply overlay
    result = cv2.addWeighted(overlay, 0.9, frame, 0.1, 0)
    return result


# ── Rep Counter Badge ─────────────────────────────────────────────────────────

def draw_rep_counter(
    frame: np.ndarray,
    rep_count: int,
    rep_grade: str | None = None,
    overlay_mode: str = "full",
) -> np.ndarray:
    """
    Draw a rep counter badge in the top-left corner.
    Always rendered regardless of overlay_mode (per plan spec).

    Displays:
      • 'REP N' pill badge  (e.g. 'REP 3')
      • Star rating row below (based on rep_grade: A=5★ B=4★ C=3★ D=2★ F=1★)

    Args:
        frame:      BGR video frame
        rep_count:  Number of complete reps detected
        rep_grade:  Letter grade ('A'/'B'/'C'/'D'/'F') or None
        overlay_mode: Accepted for API consistency but badge always renders.

    Returns:
        Frame with badge composited
    """
    margin = 12
    font = cv2.FONT_HERSHEY_SIMPLEX

    badge_text = f"REP {rep_count}"
    (tw, th), _ = cv2.getTextSize(badge_text, font, 0.6, 2)

    pad_x, pad_y = 10, 7
    box_x1 = margin
    box_y1 = margin
    box_x2 = margin + tw + pad_x * 2
    box_y2 = margin + th + pad_y * 2

    overlay = frame.copy()
    # Dark glassmorphism pill
    cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), (15, 10, 20), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
    overlay = frame.copy()

    # Subtle rose border
    cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), (180, 80, 200), 1, cv2.LINE_AA)

    # REP text
    text_x = box_x1 + pad_x
    text_y = box_y1 + pad_y + th
    cv2.putText(overlay, badge_text, (text_x, text_y), font, 0.6, (240, 200, 255), 2, cv2.LINE_AA)

    # Star rating row (if grade is provided)
    if rep_grade:
        grade_stars = {"A": 5, "B": 4, "C": 3, "D": 2, "F": 1}.get(rep_grade, 0)
        star_y = box_y2 + 14
        star_x = box_x1
        for s in range(5):
            color = (80, 200, 140) if s < grade_stars else (60, 60, 60)  # mint vs dark
            # Approximate star as a small filled circle (OpenCV has no star primitive)
            cv2.circle(overlay, (star_x + s * 13 + 6, star_y), 4, color, -1, cv2.LINE_AA)

    result = cv2.addWeighted(overlay, 0.9, frame, 0.1, 0)
    return result


# ── Velocity Trail (SlingShot) ────────────────────────────────────────────────

def velocity_to_color(speed: float, max_speed: float) -> tuple:
    """
    Maps barbell speed to HHB-branded color gradient (BGR):
      Slow  → Teal → Green
      Med   → Gold → Amber
      Fast  → Magenta → Electric Pink
    """
    t = float(np.clip(speed / max(max_speed, 1e-6), 0.0, 1.0))

    if t < 0.33:
        p = t / 0.33
        r = int(0 + 80 * p)
        g = int(210 + 45 * p)
        b = int(190 - 70 * p)
    elif t < 0.66:
        p = (t - 0.33) / 0.33
        r = 255
        g = int(200 - 60 * p)
        b = int(60 - 20 * p)
    else:
        p = (t - 0.66) / 0.34
        r = 255
        g = int(50 + 30 * p)
        b = int(180 + 75 * p)

    return (b, g, r)  # BGR


def draw_velocity_trail(
    frame: np.ndarray,
    trail_points: list,
    speeds: list,
    max_speed: float,
    trail_length: int = 45,
) -> np.ndarray:
    """
    Draw a fading velocity-colored neon trail behind the tracked object.

    Args:
        frame:        BGR video frame to draw on
        trail_points: List of (x, y) tuples — track history
        speeds:       Per-frame speeds corresponding to trail_points
        max_speed:    Maximum speed for normalizing color
        trail_length: Number of past frames to render

    Returns:
        Annotated frame
    """
    glow_layer = np.zeros_like(frame)
    overlay = frame.copy()

    recent = trail_points[-trail_length:]
    recent_speeds = speeds[-trail_length:]

    # Guard: pad speeds to match trail_points length if they diverge
    # (can happen during the first ~trail_length frames)
    if len(recent_speeds) < len(recent):
        recent_speeds = [0.0] * (len(recent) - len(recent_speeds)) + list(recent_speeds)
    elif len(recent_speeds) > len(recent):
        recent_speeds = recent_speeds[-len(recent):]

    for i in range(1, len(recent)):
        alpha = (i / len(recent)) ** 0.7
        thickness = max(2, int(6 * alpha))
        glow_thickness = max(4, int(14 * alpha))

        color = velocity_to_color(recent_speeds[i], max_speed)
        pt1 = tuple(map(int, recent[i - 1]))
        pt2 = tuple(map(int, recent[i]))

        cv2.line(glow_layer, pt1, pt2, color, glow_thickness)
        cv2.line(overlay, pt1, pt2, color, thickness, cv2.LINE_AA)

    glow_blurred = fast_glow_blur(glow_layer, downsample_factor=4)
    return cv2.addWeighted(overlay, 1.0, glow_blurred, 0.5, 0)


def apply_watermark(
    frame: np.ndarray,
    watermark: np.ndarray,
    padding: int = 16,
) -> np.ndarray:
    """
    Alpha-blend a pre-loaded BGRA watermark onto the bottom-right corner.

    Args:
        frame:     BGR video frame
        watermark: BGRA watermark image (4 channels)
        padding:   Pixel margin from corner

    Returns:
        Frame with watermark composited
    """
    if watermark is None or watermark.shape[2] < 4:
        return frame

    result = frame.copy()
    wm_h, wm_w = watermark.shape[:2]
    fh, fw = frame.shape[:2]

    start_y = fh - wm_h - padding
    start_x = fw - wm_w - padding

    # Clamp to frame bounds
    if start_y < 0 or start_x < 0:
        return result

    alpha = watermark[:, :, 3:4].astype(float) / 255.0
    for c in range(3):
        result[start_y:start_y + wm_h, start_x:start_x + wm_w, c] = (
            result[start_y:start_y + wm_h, start_x:start_x + wm_w, c] * (1.0 - alpha[:, :, 0])
            + watermark[:, :, c] * alpha[:, :, 0]
        ).astype(np.uint8)

    return result


def draw_speed_hud(
    frame: np.ndarray,
    peak_speed_kmh: float,
    avg_speed_kmh: float,
    total_distance_cm: float,
    phase_label: str = "",
) -> np.ndarray:
    """
    Draw a glassmorphism-style speed HUD banner at the bottom of the frame.
    Shows peak velocity, average bar speed, and total distance.
    """
    h, w = frame.shape[:2]
    banner_h = 52
    overlay = frame.copy()

    # Semi-transparent dark banner
    cv2.rectangle(overlay, (0, h - banner_h), (w, h), (15, 10, 20), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    font = cv2.FONT_HERSHEY_SIMPLEX
    y = h - banner_h + 32

    cv2.putText(frame, f"Peak: {peak_speed_kmh:.1f} km/h", (12, y), font, 0.5, (200, 255, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, f"Avg: {avg_speed_kmh:.1f} km/h", (int(w * 0.33), y), font, 0.5, (255, 230, 130), 1, cv2.LINE_AA)
    cv2.putText(frame, f"Dist: {total_distance_cm:.0f} cm", (int(w * 0.62), y), font, 0.5, (180, 200, 255), 1, cv2.LINE_AA)

    if phase_label:
        cv2.putText(frame, phase_label, (w - 120, y), font, 0.5, (255, 150, 200), 1, cv2.LINE_AA)

    return frame

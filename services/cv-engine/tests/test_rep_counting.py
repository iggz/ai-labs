"""Rep counting is swing-based, so it must not depend on a pose model's absolute angle readings."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from angle_utils import _compute_tempo_phases, _extract_per_rep_angles, count_reps

FPS = 60.0


def wave(top, bottom, reps, start_at="top", sec_per_rep=2.0, rest_sec=0.5):
    """Angle series of `reps` smooth reps between top/bottom, with a still hold at each end."""
    t = np.linspace(0, 2 * np.pi * reps, int(reps * sec_per_rep * FPS))
    mid, amp = (top + bottom) / 2, (top - bottom) / 2
    x = mid + amp * np.cos(t) if start_at == "top" else mid - amp * np.cos(t)
    hold = np.full(int(rest_sec * FPS), x[0])
    return list(np.concatenate([hold, x, hold]))


def test_squat_count_ignores_model_offset():
    # the bug that bit us: a model reading every angle ~12° differently changed the count
    base = wave(175, 82, 5)                       # bottoms at 82° …
    assert count_reps(base, "squat", FPS) == 5
    assert count_reps([a + 12 for a in base], "squat", FPS) == 5   # … or 94°: old 90° gate counted 0


def test_hip_thrust_small_rom_counts_every_rep():
    # yolo11x on a 3/4 view: lockout reads ~152°, never reaching the old 160° gate (old count: 0)
    assert count_reps(wave(152, 112, 9, start_at="bottom"), "hip_thrust", FPS) == 9


def test_walking_the_bar_out_is_not_a_squat():
    assert count_reps(wave(175, 140, 3), "squat", FPS) == 0


def test_shallow_squats_count_and_report_their_depth():
    reps = _extract_per_rep_angles(wave(175, 110, 4), "squat", FPS)
    assert len(reps) == 4 and all(105 < a < 115 for a in reps)   # old logic: 0 reps (never ≤ 90°)


def test_rdl_from_standing_counts_each_hinge_and_reports_lockout():
    reps = _extract_per_rep_angles(wave(178, 90, 6), "deadlift", FPS)
    assert len(reps) == 6 and all(a > 175 for a in reps)


def test_glitch_spikes_and_missing_frames_do_not_add_reps():
    x = wave(175, 70, 4)
    for i in range(40, len(x), 97):
        x[i] = 20.0          # single-frame keypoint glitch
    x[300:310] = [None] * 10  # occlusion gap
    assert count_reps(x, "squat", FPS) == 4


def test_tempo_eccentric_is_the_lowering_half():
    slow_down = list(np.linspace(175, 70, 180)) + list(np.linspace(70, 175, 60))   # 3 s down, 1 s up
    squat = _compute_tempo_phases(slow_down * 3, FPS, "squat")
    assert squat["avg_ecc_sec"] > squat["avg_con_sec"]
    slow_lower = list(np.linspace(110, 155, 60)) + list(np.linspace(155, 110, 180))  # 1 s up, 3 s down
    thrust = _compute_tempo_phases(slow_lower * 3 + [110.0] * 30, FPS, "hip_thrust")
    assert thrust["avg_ecc_sec"] > thrust["avg_con_sec"]

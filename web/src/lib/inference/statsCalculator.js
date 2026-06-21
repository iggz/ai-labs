/**
 * Stats calculator for on-device inference.
 * Port of the stats computation from the server's form_ai.py.
 *
 * Computes core stats from rep counter data.
 * Server-only fields (symmetry, tempo breakdown, per_rep_phases)
 * are nulled out since they require bilateral tracking or optical flow.
 */

/**
 * Map depth score percentage to a letter grade.
 * @param {number} pct - 0–100
 * @returns {string}
 */
function scoreToGrade(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C+';
  if (pct >= 40) return 'C';
  return 'D';
}

/**
 * Map depth score to a human-readable form label.
 * @param {number} pct - 0–100
 * @param {string} exerciseType
 * @returns {string}
 */
function scoreToFormLabel(pct, exerciseType) {
  if (pct >= 85) return 'Excellent form';
  if (pct >= 70) return 'Good form';
  if (pct >= 50) return 'Needs work';
  return exerciseType === 'squat' ? 'Shallow squat' : 'Limited range';
}

/**
 * Compute per-rep stats from the RepCounter and angle history.
 *
 * @param {import('./repCounter.js').RepCounter} repCounter
 * @param {number[]} allAngles        - Every angle sample during the session
 * @param {number[]} allConfidences   - Confidence per sample
 * @param {number}   durationSec      - Video duration in seconds
 * @param {string}   exerciseType     - 'squat' | 'deadlift' | 'hip_thrust'
 * @returns {Object} Stats object shaped to match server response
 */
export function computeStats(repCounter, allAngles, allConfidences, durationSec, exerciseType) {
  const repCount = repCounter.repCount;
  const perRepAngles = repCounter.getPerRepAngles();

  if (repCount === 0 || allAngles.length === 0) {
    return {
      depth_score_pct: null,
      letter_grade: null,
      form_label: 'No reps detected',
      avg_primary_angle: null,
      best_rep_angle: null,
      worst_rep_angle: null,
      angle_std_dev: null,
      per_rep_angles: null,
      avg_confidence: null,
      reps_per_minute: null,
      // Server-only fields — not available on-device
      symmetry_score: null,
      symmetry_label: null,
      tempo_avg_sec: null,
      tempo_sec_per_rep: null,
      per_rep_phases: null,
    };
  }

  // Depth score: based on the avg extremum angle per rep
  // For squats: lower angle = deeper = better
  // For deadlift/hip_thrust: higher angle = fuller extension = better
  const avgExtremum = perRepAngles.reduce((a, b) => a + b, 0) / perRepAngles.length;
  const minExtremum = Math.min(...perRepAngles);
  const maxExtremum = Math.max(...perRepAngles);

  let depthPct;
  if (exerciseType === 'squat') {
    // Perfect squat = 90° or below → score 100%; 130°+ → score 0%
    depthPct = Math.max(0, Math.min(100, ((130 - avgExtremum) / 40) * 100));
  } else {
    // Perfect deadlift/hip_thrust = 160°+ → score 100%; 130° → score 0%
    depthPct = Math.max(0, Math.min(100, ((avgExtremum - 130) / 30) * 100));
  }
  depthPct = Math.round(depthPct);

  const avgConf = allConfidences.length > 0
    ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
    : null;

  const repsPerMin = durationSec > 0
    ? Math.round((repCount / durationSec) * 60 * 10) / 10
    : null;

  // Angle std deviation (for consistency card)
  let angleStdDev = null;
  if (perRepAngles.length > 1) {
    const mean = avgExtremum;
    const variance = perRepAngles.reduce((sum, a) => sum + (a - mean) ** 2, 0) / perRepAngles.length;
    angleStdDev = Math.round(Math.sqrt(variance) * 10) / 10;
  } else if (perRepAngles.length === 1) {
    angleStdDev = 0;
  }

  // Best/worst rep angle (matching server field names)
  const bestRepAngle = exerciseType === 'squat' ? minExtremum : maxExtremum;
  const worstRepAngle = exerciseType === 'squat' ? maxExtremum : minExtremum;

  return {
    depth_score_pct: depthPct,
    letter_grade: scoreToGrade(depthPct),
    form_label: scoreToFormLabel(depthPct, exerciseType),
    avg_primary_angle: Math.round(avgExtremum * 10) / 10,
    best_rep_angle: Math.round(bestRepAngle * 10) / 10,
    worst_rep_angle: Math.round(worstRepAngle * 10) / 10,
    angle_std_dev: angleStdDev,
    per_rep_angles: perRepAngles.map(a => Math.round(a * 10) / 10),
    avg_confidence: avgConf !== null ? Math.round(avgConf * 1000) / 1000 : null,
    reps_per_minute: repsPerMin,
    // Server-only fields — null on-device
    symmetry_score: null,
    symmetry_label: null,
    tempo_avg_sec: null,
    tempo_sec_per_rep: null,
    per_rep_phases: null,
  };
}

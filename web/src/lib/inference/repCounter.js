/**
 * Streaming rep counter — same algorithm as the server (_segment_reps in
 * services/cv-engine/angle_utils.py), fed one angle per frame.
 *
 * A rep is a down-and-back swing of the primary angle, not a crossing of a fixed
 * angle, so a model that reads every angle a few degrees high or low still counts
 * the same reps (the old 90° / 160° gates turned 9 hip thrusts into 1).
 */

// ponytail: calibration knobs — keep in sync with MIN_REP_SWING_DEG in angle_utils.py
const MIN_SWING_DEG = { squat: 45, deadlift: 30, hip_thrust: 25 };
// Squats start standing, hip thrusts at the bottom; deadlifts use whichever turn comes first
const REST = { squat: 'hi', hip_thrust: 'lo' };
const SPIKE_FILTER_SEC = 0.15;  // median window that removes few-frame keypoint glitches
const MAX_REPS = 50;            // Safety cap

export class RepCounter {
  /**
   * @param {string} exerciseType
   * @param {number} [fps=15] - rate update() is called at (sizes the glitch filter)
   */
  constructor(exerciseType, fps = 15) {
    if (!(exerciseType in MIN_SWING_DEG)) throw new Error(`Unknown exercise: ${exerciseType}`);
    this.exerciseType = exerciseType;
    this.swing  = MIN_SWING_DEG[exerciseType];
    this.window = Math.max(1, Math.round(SPIKE_FILTER_SEC * fps)) | 1;
    this.reset();
  }

  /**
   * Update with a new angle reading.
   * @param {number} angle - Current joint angle in degrees
   * @returns {{ repCount: number, inRep: boolean }}
   */
  update(angle) {
    if (angle == null || Number.isNaN(angle)) return { repCount: this.repCount, inRep: this.inRep };

    this.recent.push(angle);
    if (this.recent.length > this.window) this.recent.shift();
    const v = [...this.recent].sort((a, b) => a - b)[this.recent.length >> 1];  // median

    // Zigzag: a high/low becomes a turning point once the angle moves a full swing away from it
    this.hi = Math.max(this.hi, v);
    this.lo = Math.min(this.lo, v);
    if (this.trend !== -1 && this.hi - v >= this.swing) {
      this._turn('hi', this.hi);
      this.trend = -1;
      this.lo = v;
    } else if (this.trend !== 1 && v - this.lo >= this.swing) {
      this._turn('lo', this.lo);
      this.trend = 1;
      this.hi = v;
    }

    // In a rep = moving away from the rest position
    this.inRep = this.rest !== null && this.trend === (this.rest === 'hi' ? -1 : 1);
    return { repCount: this.repCount, inRep: this.inRep };
  }

  _turn(kind, angle) {
    this.turns.push({ kind, angle });
    this.rest ??= kind;
    // A turn away from rest, with a rest turn before it, completes a rep
    if (kind !== this.rest && this.turns.length >= 2 && this.repCount < MAX_REPS) this.repCount++;
  }

  /** One angle per rep: deepest knee angle for squats, highest (lockout) hip angle otherwise. */
  getPerRepAngles() {
    const pick = this.exerciseType === 'squat' ? Math.min : Math.max;
    const trailing = this.trend === 1 ? this.hi : this.lo;  // where the video ended
    const out = [];
    this.turns.forEach((t, j) => {
      if (j === 0 || t.kind === this.rest) return;
      const next = j + 1 < this.turns.length ? this.turns[j + 1].angle : trailing;
      out.push(pick(this.turns[j - 1].angle, t.angle, next));
    });
    return out.slice(0, MAX_REPS);
  }

  reset() {
    this.recent   = [];         // last `window` raw angles, for the median filter
    this.turns    = [];         // confirmed turning points: { kind: 'hi' | 'lo', angle }
    this.trend    = 0;          // +1 rising, -1 falling, 0 not yet known
    this.hi       = -Infinity;  // running max / min since the last turn
    this.lo       = Infinity;
    this.rest     = REST[this.exerciseType] ?? null;
    this.repCount = 0;
    this.inRep    = false;
  }
}

/**
 * Hysteresis thresholds per exercise.
 *
 * Squat:      enter rep when angle ≤ 90°, exit when angle > 105°
 * Deadlift:   enter rep when angle ≥ 160°, exit when angle < 145°
 * Hip Thrust: enter rep when angle ≥ 160°, exit when angle < 145°
 */
const THRESHOLDS = {
  squat:      { enter: 90,  exit: 105, direction: 'below' },  // angle drops below enter → rep
  deadlift:   { enter: 160, exit: 145, direction: 'above' },  // angle rises above enter → rep
  hip_thrust: { enter: 160, exit: 145, direction: 'above' },
};

const MAX_REPS = 50;  // Safety cap

export class RepCounter {
  /** @param {string} exerciseType */
  constructor(exerciseType) {
    const config = THRESHOLDS[exerciseType];
    if (!config) throw new Error(`Unknown exercise: ${exerciseType}`);

    this.enterThreshold  = config.enter;
    this.exitThreshold   = config.exit;
    this.direction       = config.direction;  // 'below' or 'above'

    this.inRep           = false;
    this.repCount        = 0;
    this.perRepAngles    = [];
    this.currentExtremum = this.direction === 'below' ? Infinity : -Infinity;
  }

  /**
   * Update with a new angle reading.
   * @param {number} angle - Current joint angle in degrees
   * @returns {{ repCount: number, inRep: boolean }}
   */
  update(angle) {
    if (this.repCount >= MAX_REPS) return { repCount: this.repCount, inRep: this.inRep };

    if (this.direction === 'below') {
      // Squat: enter when ≤ 90°, exit when > 105°
      if (!this.inRep) {
        if (angle <= this.enterThreshold) {
          this.inRep = true;
          this.currentExtremum = angle;  // Track minimum angle in rep
        }
      } else {
        this.currentExtremum = Math.min(this.currentExtremum, angle);
        if (angle > this.exitThreshold) {
          this.repCount++;
          this.perRepAngles.push(this.currentExtremum);
          this.inRep = false;
          this.currentExtremum = Infinity;
        }
      }
    } else {
      // Deadlift / Hip Thrust: enter when ≥ 160°, exit when < 145°
      if (!this.inRep) {
        if (angle >= this.enterThreshold) {
          this.inRep = true;
          this.currentExtremum = angle;  // Track maximum angle in rep
        }
      } else {
        this.currentExtremum = Math.max(this.currentExtremum, angle);
        if (angle < this.exitThreshold) {
          this.repCount++;
          this.perRepAngles.push(this.currentExtremum);
          this.inRep = false;
          this.currentExtremum = -Infinity;
        }
      }
    }

    return { repCount: this.repCount, inRep: this.inRep };
  }

  getPerRepAngles() { return [...this.perRepAngles]; }

  reset() {
    this.inRep = false;
    this.repCount = 0;
    this.perRepAngles = [];
    this.currentExtremum = this.direction === 'below' ? Infinity : -Infinity;
  }
}

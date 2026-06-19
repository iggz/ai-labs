/**
 * COCO keypoint joint triplets per exercise.
 * { vertex, arm1, arm2 } — angle measured at vertex.
 *
 * COCO keypoint indices (17 keypoints):
 * 0: nose, 1: left_eye, 2: right_eye, 3: left_ear, 4: right_ear
 * 5: left_shoulder, 6: right_shoulder, 7: left_elbow, 8: right_elbow
 * 9: left_wrist, 10: right_wrist, 11: left_hip, 12: right_hip
 * 13: left_knee, 14: right_knee, 15: left_ankle, 16: right_ankle
 */
const EXERCISE_JOINTS = {
  squat:      { vertex: 13, arm1: 11, arm2: 15 },  // knee ← hip, ankle
  deadlift:   { vertex: 11, arm1: 5,  arm2: 13 },  // hip ← shoulder, knee
  hip_thrust: { vertex: 11, arm1: 5,  arm2: 13 },  // hip ← shoulder, knee
};

/**
 * 3-point angle at vertex B, in degrees [0, 180].
 * @param {[number,number]} a - Point A
 * @param {[number,number]} b - Vertex B
 * @param {[number,number]} c - Point C
 * @returns {number}
 */
export function calculateAngle(a, b, c) {
  const ba = [a[0] - b[0], a[1] - b[1]];
  const bc = [c[0] - b[0], c[1] - b[1]];
  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  const magBA = Math.hypot(ba[0], ba[1]);
  const magBC = Math.hypot(bc[0], bc[1]);
  if (magBA < 1e-6 || magBC < 1e-6) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

/**
 * Get the exercise-specific angle from keypoints.
 * @param {Float32Array} keypoints  - length 34
 * @param {Float32Array} confidences - length 17
 * @param {string} exerciseType - 'squat' | 'deadlift' | 'hip_thrust'
 * @returns {{ angle: number, confidence: number } | null}
 */
export function getExerciseAngle(keypoints, confidences, exerciseType) {
  const joints = EXERCISE_JOINTS[exerciseType];
  if (!joints) return null;

  const { vertex, arm1, arm2 } = joints;

  // All 3 keypoints must be visible
  if (confidences[vertex] < 0.3 ||
      confidences[arm1]   < 0.3 ||
      confidences[arm2]   < 0.3) return null;

  const a = [keypoints[arm1 * 2], keypoints[arm1 * 2 + 1]];
  const b = [keypoints[vertex * 2], keypoints[vertex * 2 + 1]];
  const c = [keypoints[arm2 * 2], keypoints[arm2 * 2 + 1]];

  const angle = calculateAngle(a, b, c);
  const confidence = (confidences[vertex] + confidences[arm1] + confidences[arm2]) / 3;

  return { angle, confidence };
}

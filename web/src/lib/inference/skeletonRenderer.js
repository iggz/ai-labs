/**
 * Skeleton renderer — Canvas 2D port of overlay.py.
 * Draws COCO pose skeleton with glow pass + solid pass,
 * ROM gauge (top-right semicircular speedometer),
 * rep badge (top-left), and confidence-gated joints.
 */

// ── COCO skeleton connections (pairs of keypoint indices) ──
const SKELETON = [
  [15, 13], [13, 11], [16, 14], [14, 12], [11, 12],  // lower body
  [5, 11],  [6, 12],                                   // torso sides
  [5, 6],                                              // shoulders
  [5, 7],   [6, 8],                                   // upper arms
  [7, 9],   [8, 10],                                  // forearms
  [1, 2],   [0, 1],   [0, 2],   [1, 3],   [2, 4],    // face
  [3, 5],   [4, 6],                                   // ears-shoulders
];

// Keypoint colors by body region (COCO order)
const KP_COLORS = [
  '#FF5F6D', // 0  nose
  '#FF5F6D', // 1  left_eye
  '#FF5F6D', // 2  right_eye
  '#FF5F6D', // 3  left_ear
  '#FF5F6D', // 4  right_ear
  '#FFC200', // 5  left_shoulder
  '#FFC200', // 6  right_shoulder
  '#FFC200', // 7  left_elbow
  '#FFC200', // 8  right_elbow
  '#FFC200', // 9  left_wrist
  '#FFC200', // 10 right_wrist
  '#00F5A0', // 11 left_hip
  '#00F5A0', // 12 right_hip
  '#00F5A0', // 13 left_knee
  '#00F5A0', // 14 right_knee
  '#00F5A0', // 15 left_ankle
  '#00F5A0', // 16 right_ankle
];

// Bone colors by limb group
const BONE_COLORS = {
  face:   '#FF9999',
  torso:  '#FFC200',
  arms:   '#FFB347',
  legs:   '#00F5A0',
};

/**
 * Classify a bone connection into a color group.
 * @param {number} i - keypoint index A
 * @param {number} j - keypoint index B
 */
function boneColor(i, j) {
  const both = new Set([i, j]);
  if ([0,1,2,3,4].some(k => both.has(k))) return BONE_COLORS.face;
  if ([5,6,7,8,9,10].some(k => both.has(k))) return BONE_COLORS.arms;
  if ([5,6,11,12].every(k => !both.has(k)) === false) return BONE_COLORS.torso;
  return BONE_COLORS.legs;
}

/**
 * Draw the ROM gauge (semicircular speedometer) in the top-right corner.
 */
function drawGauge(ctx, angle, exerciseType, w) {
  if (angle === null || angle === undefined) return;

  const cx = w - 70;
  const cy = 70;
  const r  = 50;

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Determine angle range per exercise
  let minAngle, maxAngle;
  if (exerciseType === 'squat') {
    minAngle = 60;   maxAngle = 170;
  } else {
    minAngle = 120;  maxAngle = 180;
  }

  const normalized = Math.max(0, Math.min(1, (angle - minAngle) / (maxAngle - minAngle)));
  const startRad = Math.PI;
  const endRad   = Math.PI + normalized * Math.PI;

  // Pick color: green=full ROM, amber=mid, red=limited
  let color;
  if (normalized > 0.7) color = '#00F5A0';
  else if (normalized > 0.4) color = '#FFC200';
  else color = '#FF5F6D';

  ctx.beginPath();
  ctx.arc(cx, cy, r, startRad, endRad);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Angle value label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(angle)}°`, cx, cy + 12);

  // ROM label
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('ROM', cx, cy + 26);
}

/**
 * Draw the rep count badge in the top-left corner.
 */
function drawRepBadge(ctx, repCount, inRep) {
  const x = 20, y = 20, w = 72, h = 40;
  const r = 12;

  // Pill background
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  ctx.fillStyle = inRep ? 'rgba(0, 245, 160, 0.25)' : 'rgba(0, 0, 0, 0.55)';
  ctx.fill();
  ctx.strokeStyle = inRep ? '#00F5A0' : 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Rep count text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${repCount}`, x + w / 2, y + h / 2 - 2);

  // "reps" subtext
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('reps', x + w / 2, y + h / 2 + 10);
}

/**
 * Draw skeleton: two passes (glow then solid) for visual quality.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} keypoints    - length 34
 * @param {Float32Array} confidences  - length 17
 * @param {number|null} angle
 * @param {number} repCount
 * @param {string} exerciseType
 * @param {string} overlayMode        - 'skeleton' | 'minimal'
 * @param {number} width
 * @param {number} height
 * @param {boolean} [inRep=false]
 */
export function drawFrame(ctx, keypoints, confidences, angle, repCount,
                          exerciseType, overlayMode, width, height, inRep = false) {
  const CONF_MIN = 0.3;

  // ── Glow pass (bones) ──
  // Use shadowBlur instead of ctx.filter='blur()' — filter triggers a full
  // software render pass on iOS Safari which takes 200ms+. shadowBlur is
  // GPU-accelerated on all platforms.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.shadowBlur  = 10;
  for (const [i, j] of SKELETON) {
    if (confidences[i] < CONF_MIN || confidences[j] < CONF_MIN) continue;
    const x1 = keypoints[i * 2], y1 = keypoints[i * 2 + 1];
    const x2 = keypoints[j * 2], y2 = keypoints[j * 2 + 1];
    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) continue;
    const color = boneColor(i, j);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle  = color;
    ctx.shadowColor  = color;
    ctx.lineWidth    = 6;
    ctx.lineCap      = 'round';
    ctx.stroke();
  }
  ctx.restore();

  // ── Solid pass (bones) ──
  for (const [i, j] of SKELETON) {
    if (confidences[i] < CONF_MIN || confidences[j] < CONF_MIN) continue;
    const x1 = keypoints[i * 2], y1 = keypoints[i * 2 + 1];
    const x2 = keypoints[j * 2], y2 = keypoints[j * 2 + 1];
    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) continue;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = boneColor(i, j);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // ── Keypoints ──
  for (let k = 0; k < 17; k++) {
    if (confidences[k] < CONF_MIN) continue;
    const x = keypoints[k * 2], y = keypoints[k * 2 + 1];
    if (isNaN(x) || isNaN(y)) continue;

    // Glow ring
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = KP_COLORS[k] + '44';
    ctx.fill();

    // Solid dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = KP_COLORS[k];
    ctx.fill();
  }

  if (overlayMode === 'minimal') return;

  // ── ROM gauge ──
  drawGauge(ctx, angle, exerciseType, width);

  // ── Rep badge ──
  drawRepBadge(ctx, repCount, inRep);
}

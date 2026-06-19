import * as ort from 'onnxruntime-web';

// ── Constants ──
const MODEL_INPUT_SIZE = 416;   // 640→416: ~58% fewer FLOPs, same anchor-free YOLO output
const CONF_THRESHOLD   = 0.25;
const NMS_IOU          = 0.45;
// In dev: Vite middleware serves model locally from services/cv-engine/ (no CORS issues)
// In prod: Cloudflare Worker proxies from GitHub Releases + adds CORP header
const MODEL_URL = import.meta.env.PROD
  ? '/ai-labs/models/yolov8s-pose.onnx'
  : '/models/yolov8s-pose.onnx';

// ── Typed array pool ──
// Reused across frames to avoid GC pressure (3 channels × 416 × 416)
const _chwBuf = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);

// ── Singleton session ──
let _session = null;
let _device  = null;  // 'webgpu' | 'wasm'

/**
 * Load the ONNX model. Lazy singleton — safe to call multiple times.
 * Tries WebGPU first, falls back to WASM.
 * @returns {Promise<{ session: ort.InferenceSession, device: string }>}
 */
export async function loadModel() {
  if (_session) return { session: _session, device: _device };

  // WASM files served from jsDelivr CDN — avoids Cloudflare's 25 MB asset limit
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
  // Limit threads: mobile browsers restrict SharedArrayBuffer thread counts
  ort.env.wasm.numThreads = typeof SharedArrayBuffer !== 'undefined'
    ? Math.min(4, navigator.hardwareConcurrency || 2)
    : 1;

  const providers = [];

  // WebGPU: available in Safari 17+ and Chrome. Test before adding.
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) providers.push('webgpu');
    } catch { /* WebGPU not available */ }
  }
  providers.push('wasm');  // always available as fallback

  _session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: providers,
  });
  _device = providers[0] === 'webgpu' ? 'webgpu' : 'wasm';

  return { session: _session, device: _device };
}

/**
 * Letterbox-resize an image source to MODEL_INPUT_SIZE × MODEL_INPUT_SIZE.
 *
 * Uses createImageBitmap for GPU-accelerated resize when available, which:
 *   - Avoids reading back a full-resolution frame (e.g. 1080p = 8.3 MB RGBA)
 *   - Only reads back 416×416 (0.69 MB) — 12× less GPU→CPU transfer on mobile
 *
 * @param {HTMLVideoElement|ImageBitmap|ImageData} imageSource
 * @param {number} [size=MODEL_INPUT_SIZE]
 * @returns {Promise<{ data: Float32Array, scale: number, pad: [number, number] }>}
 */
export async function letterbox(imageSource, size = MODEL_INPUT_SIZE) {
  // Determine source dimensions
  let srcW, srcH;
  if (imageSource instanceof ImageData) {
    srcW = imageSource.width;
    srcH = imageSource.height;
  } else {
    srcW = imageSource.videoWidth  ?? imageSource.displayWidth  ?? imageSource.width;
    srcH = imageSource.videoHeight ?? imageSource.displayHeight ?? imageSource.height;
  }

  const scale = Math.min(size / srcW, size / srcH);
  const newW  = Math.round(srcW * scale);
  const newH  = Math.round(srcH * scale);
  const dw    = Math.round((size - newW) / 2);
  const dh    = Math.round((size - newH) / 2);

  // Create output canvas (size × size, gray fill)
  let outCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    outCanvas = new OffscreenCanvas(size, size);
  } else {
    outCanvas = document.createElement('canvas');
    outCanvas.width = outCanvas.height = size;
  }
  const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, size, size);

  if (imageSource instanceof ImageData) {
    // Rare legacy path: put ImageData on a temp canvas then draw scaled
    let tmp;
    if (typeof OffscreenCanvas !== 'undefined') {
      tmp = new OffscreenCanvas(srcW, srcH);
    } else {
      tmp = document.createElement('canvas');
      tmp.width = srcW;
      tmp.height = srcH;
    }
    tmp.getContext('2d').putImageData(imageSource, 0, 0);
    ctx.drawImage(tmp, dw, dh, newW, newH);
  } else if (typeof createImageBitmap !== 'undefined') {
    // Fast path: GPU-accelerated resize via createImageBitmap compositor
    // This avoids reading back the full-resolution frame to CPU
    let bmp;
    try {
      bmp = await createImageBitmap(imageSource, {
        resizeWidth:   newW,
        resizeHeight:  newH,
        resizeQuality: 'pixelated',  // fastest; adequate for pose detection
      });
      ctx.drawImage(bmp, dw, dh);
    } finally {
      bmp?.close();
    }
  } else {
    // Fallback: drawImage with explicit target size (browser scales on GPU)
    ctx.drawImage(imageSource, dw, dh, newW, newH);
  }

  // Read pixels and convert RGBA → CHW Float32 normalised [0, 1]
  const { data: px } = ctx.getImageData(0, 0, size, size);
  const ss = size * size;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    _chwBuf[j]          = px[i]     / 255;  // R
    _chwBuf[j + ss]     = px[i + 1] / 255;  // G
    _chwBuf[j + 2 * ss] = px[i + 2] / 255;  // B
  }

  return { data: _chwBuf, scale, pad: [dw, dh] };
}

/**
 * NMS — JavaScript port of cv2.dnn.NMSBoxes.
 * @param {number[][]} boxes - [[x1,y1,x2,y2], ...]
 * @param {number[]} scores
 * @param {number} iouThreshold
 * @returns {number[]} Kept indices
 */
export function nms(boxes, scores, iouThreshold) {
  const order = scores.map((s, i) => [s, i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);

  const keep = [];
  const suppressed = new Set();

  for (const i of order) {
    if (suppressed.has(i)) continue;
    keep.push(i);
    for (const j of order) {
      if (suppressed.has(j) || j === i) continue;
      if (_computeIoU(boxes[i], boxes[j]) > iouThreshold) suppressed.add(j);
    }
  }
  return keep;
}

function _computeIoU(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-6);
}

/**
 * Postprocess YOLO output tensor → keypoints for best detection.
 * Works with any input size — uses output.dims[2] dynamically.
 *
 * @param {ort.Tensor} output
 * @param {number} scale - Letterbox scale factor
 * @param {[number, number]} pad - Letterbox padding [dw, dh]
 * @returns {{ keypoints: Float32Array, confidences: Float32Array, bbox: number[], score: number } | null}
 */
export function postprocess(output, scale, pad) {
  const raw  = output.data;      // Float32Array
  const cols = output.dims[2];   // e.g. 3549 for 416×416, 8400 for 640×640
  const rows = output.dims[1];   // 56

  const boxes   = [];
  const scores  = [];
  const allData = [];

  for (let c = 0; c < cols; c++) {
    const conf = raw[4 * cols + c];  // objectness score at row 4
    if (conf < CONF_THRESHOLD) continue;

    const cx = raw[0 * cols + c];
    const cy = raw[1 * cols + c];
    const bw = raw[2 * cols + c];
    const bh = raw[3 * cols + c];

    boxes.push([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]);
    scores.push(conf);
    allData.push(c);
  }

  if (boxes.length === 0) return null;

  const kept = nms(boxes, scores, NMS_IOU);
  if (kept.length === 0) return null;

  const bestIdx = kept[0];
  const bestCol = allData[bestIdx];

  // Extract 17 COCO keypoints: rows 5..55, stride 3 (x, y, visibility)
  const keypoints   = new Float32Array(34);
  const confidences = new Float32Array(17);

  for (let k = 0; k < 17; k++) {
    const kx = raw[(5 + k * 3)     * cols + bestCol];
    const ky = raw[(5 + k * 3 + 1) * cols + bestCol];
    const kc = raw[(5 + k * 3 + 2) * cols + bestCol];

    // Map back to original image space
    keypoints[k * 2]     = (kx - pad[0]) / scale;
    keypoints[k * 2 + 1] = (ky - pad[1]) / scale;
    confidences[k]       = kc;
  }

  return {
    keypoints,
    confidences,
    bbox:  boxes[bestIdx].map((v, i) => (v - pad[i % 2 === 0 ? 0 : 1]) / scale),
    score: scores[bestIdx],
  };
}

/**
 * Full inference pipeline for one frame.
 * Accepts any image source (HTMLVideoElement, ImageBitmap, ImageData).
 *
 * @param {HTMLVideoElement|ImageBitmap|ImageData} imageSource
 * @returns {Promise<{ keypoints: Float32Array(34), confidences: Float32Array(17), bbox: number[], score: number } | null>}
 */
export async function inferFrame(imageSource) {
  const { session } = await loadModel();
  const { data, scale, pad } = await letterbox(imageSource);

  const tensor = new ort.Tensor('float32', data,
    [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const feeds   = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  const output  = results[session.outputNames[0]];

  return postprocess(output, scale, pad);
}

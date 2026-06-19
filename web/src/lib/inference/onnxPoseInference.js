import * as ort from 'onnxruntime-web';

// ── Constants ──
const MODEL_INPUT_SIZE = 640;
const CONF_THRESHOLD   = 0.25;
const NMS_IOU          = 0.45;
const MODEL_URL        = '/models/yolov8s-pose.onnx';

// ── Typed array pool (reusable buffers to reduce GC pressure) ──
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

  // Configure WASM file paths — use jsDelivr CDN to avoid Cloudflare's 25 MB asset limit
  // (ort-wasm-simd-threaded.jsep.wasm is 26 MB, exceeds CF Workers max)
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
  // Disable multi-threading on Safari (SharedArrayBuffer restrictions)
  ort.env.wasm.numThreads = typeof SharedArrayBuffer !== 'undefined' ? 4 : 1;

  const providers = [];

  // WebGPU feature detection
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
  _device = providers[0] === 'webgpu' && _session.handler?._ep === 'webgpu'
    ? 'webgpu' : 'wasm';

  return { session: _session, device: _device };
}

/**
 * Letterbox resize: preserves aspect ratio, pads with gray (114,114,114).
 * Returns CHW Float32Array normalized to [0,1] (reuses pooled buffer).
 *
 * @param {ImageData} imageData - Source frame
 * @param {number} size - Target square size (default 640)
 * @returns {{ data: Float32Array, scale: number, pad: [number, number] }}
 */
export function letterbox(imageData, size = MODEL_INPUT_SIZE) {
  const { width: srcW, height: srcH, data: rgba } = imageData;
  const scale = Math.min(size / srcW, size / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const dw = Math.round((size - newW) / 2);
  const dh = Math.round((size - newH) / 2);

  // Use OffscreenCanvas if available (avoids main-thread jank on Safari)
  let resizeCanvas, resizeCtx;
  if (typeof OffscreenCanvas !== 'undefined') {
    resizeCanvas = new OffscreenCanvas(size, size);
    resizeCtx = resizeCanvas.getContext('2d');
  } else {
    resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = size;
    resizeCanvas.height = size;
    resizeCtx = resizeCanvas.getContext('2d');
  }

  // Fill gray (114/255 ≈ 0.447)
  resizeCtx.fillStyle = 'rgb(114, 114, 114)';
  resizeCtx.fillRect(0, 0, size, size);

  // Draw scaled source into letterbox position
  let srcCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    srcCanvas = new OffscreenCanvas(srcW, srcH);
  } else {
    srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
  }
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(imageData, 0, 0);

  resizeCtx.drawImage(srcCanvas, dw, dh, newW, newH);
  const resized = resizeCtx.getImageData(0, 0, size, size);

  // Convert RGBA → CHW Float32, normalized [0, 1] (reuse pooled buffer)
  const pixels = resized.data;
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    _chwBuf[j]                     = pixels[i]     / 255;  // R
    _chwBuf[j + size * size]       = pixels[i + 1] / 255;  // G
    _chwBuf[j + 2 * size * size]   = pixels[i + 2] / 255;  // B
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
      const iou = _computeIoU(boxes[i], boxes[j]);
      if (iou > iouThreshold) suppressed.add(j);
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
 * Postprocess YOLO output (1, 56, 8400) → keypoints.
 * @param {ort.Tensor} output
 * @param {number} scale - Letterbox scale factor
 * @param {[number, number]} pad - Letterbox padding [dw, dh]
 * @returns {{ keypoints: Float32Array, confidences: Float32Array, bbox: number[], score: number } | null}
 */
export function postprocess(output, scale, pad) {
  // output shape: [1, 56, 8400] → transpose to [8400, 56]
  const raw = output.data;     // Float32Array
  const cols = output.dims[2]; // 8400
  const rows = output.dims[1]; // 56

  const boxes = [];
  const scores = [];
  const allData = [];

  for (let c = 0; c < cols; c++) {
    const conf = raw[4 * cols + c];  // objectness at row 4
    if (conf < CONF_THRESHOLD) continue;

    // Box: cx, cy, w, h → x1, y1, x2, y2
    const cx = raw[0 * cols + c];
    const cy = raw[1 * cols + c];
    const w  = raw[2 * cols + c];
    const h  = raw[3 * cols + c];

    boxes.push([cx - w/2, cy - h/2, cx + w/2, cy + h/2]);
    scores.push(conf);
    allData.push(c);
  }

  if (boxes.length === 0) return null;

  const kept = nms(boxes, scores, NMS_IOU);
  if (kept.length === 0) return null;

  // Take best detection
  const bestIdx = kept[0];
  const bestCol = allData[bestIdx];

  // Extract 17 keypoints: rows 5..55, stride 3 (x, y, conf)
  const keypoints   = new Float32Array(34);
  const confidences = new Float32Array(17);

  for (let k = 0; k < 17; k++) {
    const kx   = raw[(5 + k * 3    ) * cols + bestCol];
    const ky   = raw[(5 + k * 3 + 1) * cols + bestCol];
    const kc   = raw[(5 + k * 3 + 2) * cols + bestCol];

    // Map back to original image space
    keypoints[k * 2    ] = (kx - pad[0]) / scale;
    keypoints[k * 2 + 1] = (ky - pad[1]) / scale;
    confidences[k] = kc;
  }

  return {
    keypoints,
    confidences,
    bbox: boxes[bestIdx].map((v, i) => (v - pad[i % 2 === 0 ? 0 : 1]) / scale),
    score: scores[bestIdx],
  };
}

/**
 * Full inference pipeline for one frame.
 * @param {ImageData} imageData
 * @returns {Promise<{ keypoints: Float32Array(34), confidences: Float32Array(17), bbox: number[], score: number } | null>}
 */
export async function inferFrame(imageData) {
  const { session } = await loadModel();
  const { data, scale, pad } = letterbox(imageData);

  const tensor = new ort.Tensor('float32', data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const feeds = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  const output = results[session.outputNames[0]];

  return postprocess(output, scale, pad);
}

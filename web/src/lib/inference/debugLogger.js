/**
 * DebugLogger — Comprehensive telemetry for on-device inference debugging.
 *
 * Activated via `?debug=1` URL param. Captures device fingerprint, phase
 * timings, per-frame telemetry, errors, and pipeline state. Sends the
 * complete log to the server on completion for iterative optimization.
 *
 * Usage:
 *   const logger = new DebugLogger();
 *   logger.phase('model_load');
 *   // ... work ...
 *   logger.phaseEnd('model_load');
 *   logger.frame(0, { infer_ms: 234, detected: true, angle: 142 });
 *   logger.error('inference', err, { frame: 0 });
 *   const report = logger.getReport();
 */

// ── Feature flag ──
export const DEBUG_ON_DEVICE = true;

/** Generic alias — used by UnifiedDebugLogger and other consumers */
export const DEBUG_ENABLED = DEBUG_ON_DEVICE;

/**
 * Capture a comprehensive device fingerprint.
 * @returns {Promise<Object>}
 */
async function captureDeviceInfo() {
  const info = {
    userAgent:            navigator.userAgent,
    platform:             navigator.platform,
    language:             navigator.language,
    hardwareConcurrency:  navigator.hardwareConcurrency ?? 'unknown',
    deviceMemory:         navigator.deviceMemory ?? 'unknown',  // Chrome only
    maxTouchPoints:       navigator.maxTouchPoints ?? 0,
    screenSize:           `${screen.width}×${screen.height}`,
    windowSize:           `${window.innerWidth}×${window.innerHeight}`,
    devicePixelRatio:     window.devicePixelRatio ?? 1,
    colorDepth:           screen.colorDepth,
    orientation:          screen.orientation?.type ?? 'unknown',
    // Parsed fields
    isIOS:                /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isAndroid:            /Android/.test(navigator.userAgent),
    iosVersion:           null,
    browserEngine:        'unknown',
    // Network
    connectionType:       null,
    connectionDownlink:   null,
    connectionRtt:        null,
    // Storage
    storageEstimate:      null,
    // WebGPU
    gpu:                  null,
    // WASM
    wasmSupported:        typeof WebAssembly !== 'undefined',
    sharedArrayBuffer:    typeof SharedArrayBuffer !== 'undefined',
    // APIs
    rvfcSupported:        typeof HTMLVideoElement !== 'undefined' &&
                          typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function',
    videoEncoderSupported: typeof VideoEncoder !== 'undefined',
    offscreenCanvasSupported: typeof OffscreenCanvas !== 'undefined',
    createImageBitmapSupported: typeof createImageBitmap !== 'undefined',
  };

  // Parse iOS version
  const iosMatch = navigator.userAgent.match(/OS (\d+)[_.](\d+)/);
  if (iosMatch) info.iosVersion = `${iosMatch[1]}.${iosMatch[2]}`;

  // Browser engine
  if (/AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
    info.browserEngine = 'WebKit (Safari)';
  } else if (/Chrome/.test(navigator.userAgent)) {
    info.browserEngine = info.isIOS ? 'WebKit (Chrome on iOS)' : 'Blink (Chrome)';
  } else if (/Firefox/.test(navigator.userAgent)) {
    info.browserEngine = info.isIOS ? 'WebKit (Firefox on iOS)' : 'Gecko (Firefox)';
  }

  // Network info
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    info.connectionType    = conn.effectiveType ?? conn.type ?? null;
    info.connectionDownlink = conn.downlink ?? null;
    info.connectionRtt     = conn.rtt ?? null;
  }

  // Storage estimate
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      info.storageEstimate = {
        quota: Math.round((est.quota || 0) / (1024 * 1024)),      // MB
        usage: Math.round((est.usage || 0) / (1024 * 1024)),      // MB
      };
    } catch { /* ignore */ }
  }

  // WebGPU adapter info
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        info.gpu = {
          vendor:       adapter.info?.vendor ?? 'unknown',
          architecture: adapter.info?.architecture ?? 'unknown',
          device:       adapter.info?.device ?? 'unknown',
          description:  adapter.info?.description ?? 'unknown',
          isFallback:   adapter.isFallbackAdapter ?? false,
        };
        // Get limits
        try {
          info.gpu.maxBufferSize          = adapter.limits?.maxBufferSize;
          info.gpu.maxComputeWorkgroupSize = adapter.limits?.maxComputeWorkgroupSizeX;
        } catch { /* ignore */ }
      } else {
        info.gpu = { status: 'requestAdapter returned null' };
      }
    } catch (e) {
      info.gpu = { status: 'requestAdapter threw', error: e.message };
    }
  } else {
    info.gpu = { status: 'navigator.gpu not present' };
  }

  return info;
}

export class DebugLogger {
  constructor() {
    this.sessionId    = crypto.randomUUID();
    this.sessionStart = performance.now();
    this.wallStart    = Date.now();

    this.deviceInfo   = null;   // filled by init()
    this.phases       = {};     // { phaseName: { start, end, duration, notes } }
    this.frames       = [];     // per-frame telemetry
    this.errors       = [];     // error log
    this.events       = [];     // timestamped event log
    this.pipeline     = {};     // pipeline state snapshots

    this.enabled      = DEBUG_ON_DEVICE;
  }

  /** Call once at the start — captures device fingerprint */
  async init() {
    if (!this.enabled) return;
    this.deviceInfo = await captureDeviceInfo();
    this.event('logger', 'DebugLogger initialized');
  }

  // ── Phase timing ──────────────────────────────────────────────────────────

  /** Mark the start of a named phase */
  phase(name, notes) {
    if (!this.enabled) return;
    this.phases[name] = {
      start:    performance.now() - this.sessionStart,
      end:      null,
      duration: null,
      notes:    notes ?? null,
    };
  }

  /** Mark the end of a named phase, returns duration in ms */
  phaseEnd(name, notes) {
    if (!this.enabled) return 0;
    const p = this.phases[name];
    if (!p) return 0;
    p.end      = performance.now() - this.sessionStart;
    p.duration = Math.round(p.end - p.start);
    if (notes) p.notes = notes;
    return p.duration;
  }

  // ── Per-frame telemetry ───────────────────────────────────────────────────

  /**
   * Log a single frame's telemetry.
   * For >100 frames, caller should sample (every 5th frame).
   */
  frame(index, data) {
    if (!this.enabled) return;
    this.frames.push({
      t:     Math.round(performance.now() - this.sessionStart),
      frame: index,
      ...data,
    });
  }

  // ── Error logging ─────────────────────────────────────────────────────────

  error(category, err, context) {
    if (!this.enabled) return;
    this.errors.push({
      t:        Math.round(performance.now() - this.sessionStart),
      category,
      name:     err?.name ?? 'Error',
      message:  err?.message ?? String(err),
      stack:    err?.stack?.split('\n').slice(0, 5).join('\n') ?? null,
      context:  context ?? null,
    });
  }

  // ── Event logging ─────────────────────────────────────────────────────────

  event(category, message, data) {
    if (!this.enabled) return;
    this.events.push({
      t:    Math.round(performance.now() - this.sessionStart),
      cat:  category,
      msg:  message,
      data: data ?? null,
    });
  }

  // ── Pipeline state ────────────────────────────────────────────────────────

  setPipeline(key, value) {
    if (!this.enabled) return;
    this.pipeline[key] = value;
  }

  // ── Report generation ─────────────────────────────────────────────────────

  getReport() {
    const totalDuration = Math.round(performance.now() - this.sessionStart);

    return {
      session_id:      this.sessionId,
      timestamp:       new Date(this.wallStart).toISOString(),
      method:          'on-device',
      version:         (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BUILD_HASH) || 'dev',
      total_duration_ms: totalDuration,
      device:          this.deviceInfo,
      phases:          this.phases,
      pipeline:        this.pipeline,
      frames:          this.frames,
      errors:          this.errors,
      events:          this.events,
    };
  }

  // ── Server upload ─────────────────────────────────────────────────────────

  /**
   * POST the full debug report to the server.
   * Fire-and-forget — never blocks UI or throws.
   */
  async send() {
    if (!this.enabled) return;
    const report = this.getReport();
    try {
      const res = await fetch('/ai-labs/api/debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      if (res.ok) {
        console.log(`[DebugLogger] Log sent to server (session: ${this.sessionId})`);
      } else {
        console.warn(`[DebugLogger] Server responded ${res.status}`);
      }
    } catch (e) {
      console.warn('[DebugLogger] Failed to send log:', e.message);
    }
  }

  /**
   * Generate a downloadable JSON blob URL.
   * @returns {string} Object URL for the debug log JSON file
   */
  toDownloadUrl() {
    const report = this.getReport();
    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: 'application/json' }
    );
    return URL.createObjectURL(blob);
  }
}

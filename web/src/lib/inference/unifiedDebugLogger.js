/**
 * UnifiedDebugLogger — Cross-method telemetry for DNN, YOLO, and On-Device inference.
 *
 * Activated via `?debug=1` URL param. Wraps server-side and on-device pipelines
 * with a single schema for timing, accuracy, device fingerprint, and error tracking.
 * Sends the complete log to the Cloudflare Worker KV store on completion.
 *
 * Zero overhead when debug is off — constructor short-circuits, all methods are no-ops.
 *
 * Usage:
 *   const logger = new UnifiedDebugLogger('yolo', 'squat', 'side');
 *   await logger.init(file);
 *   logger.markUploadStart();
 *   // ... submit to server ...
 *   logger.markUploadComplete(uploadSizeBytes);
 *   logger.markResultReceived(result);
 *   logger.mergeServerTimings(result.debug_timings);
 *   logger.setAccuracy(result.metadata);
 *   await logger.send();
 */

import { DEBUG_ON_DEVICE } from './debugLogger.js';

// ── Feature flag (generic alias) ────────────────────────────────────────────
export const DEBUG_ENABLED = DEBUG_ON_DEVICE;

// ── Error taxonomy ──────────────────────────────────────────────────────────
export const ErrorCodes = Object.freeze({
  MODEL_LOAD_FAILED:    'ERR_MODEL_LOAD_FAILED',
  INFERENCE_TIMEOUT:    'ERR_INFERENCE_TIMEOUT',
  WEBGPU_SHADER_HANG:   'ERR_WEBGPU_SHADER_HANG',
  WASM_OOM:             'ERR_WASM_OOM',
  ENCODING_FAILED:      'ERR_ENCODING_FAILED',
  NETWORK_UPLOAD:       'ERR_NETWORK_UPLOAD',
  NETWORK_DOWNLOAD:     'ERR_NETWORK_DOWNLOAD',
  SERVER_QUEUE_FULL:    'ERR_SERVER_QUEUE_FULL',
  SERVER_TIMEOUT:       'ERR_SERVER_TIMEOUT',
  VIDEO_INVALID:        'ERR_VIDEO_INVALID',
  UNKNOWN:              'ERR_UNKNOWN',
});

/**
 * Compute SHA-256 hash of the first 1 MB of a File.
 * Returns hex string, or 'unavailable' if SubtleCrypto is missing.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function hashVideoFile(file) {
  try {
    const chunkSize = 1024 * 1024; // 1 MB
    const slice = file.slice(0, chunkSize);
    const buffer = await slice.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unavailable';
  }
}

/**
 * Capture memory usage snapshot (Chrome only).
 * @returns {{ heapSizeLimit: number|null, heapUsed: number|null, heapTotal: number|null }}
 */
function captureMemory() {
  const mem = performance.memory; // Chrome-only API
  if (!mem) return { heapSizeLimit: null, heapUsed: null, heapTotal: null };
  return {
    heapSizeLimit: mem.jsHeapSizeLimit,
    heapUsed: mem.usedJSHeapSize,
    heapTotal: mem.totalJSHeapSize,
  };
}

/**
 * Capture battery level (where available).
 * @returns {Promise<number|null>}
 */
async function captureBattery() {
  try {
    if (!navigator.getBattery) return null;
    const battery = await navigator.getBattery();
    return battery.level;
  } catch {
    return null;
  }
}

/**
 * Capture device fingerprint (reuses logic from DebugLogger).
 * @returns {Promise<Object>}
 */
async function captureDeviceInfo() {
  const info = {
    userAgent:            navigator.userAgent,
    platform:             navigator.platform,
    hardwareConcurrency:  navigator.hardwareConcurrency ?? null,
    deviceMemory:         navigator.deviceMemory ?? null,
    screenSize:           `${screen.width}×${screen.height}`,
    devicePixelRatio:     window.devicePixelRatio ?? 1,
    isIOS:                /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isAndroid:            /Android/.test(navigator.userAgent),
    connectionType:       null,
    connectionDownlink:   null,
    connectionRtt:        null,
    gpu:                  null,
    wasmSupported:        typeof WebAssembly !== 'undefined',
    sharedArrayBuffer:    typeof SharedArrayBuffer !== 'undefined',
  };

  // Network info
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    info.connectionType    = conn.effectiveType ?? conn.type ?? null;
    info.connectionDownlink = conn.downlink ?? null;
    info.connectionRtt     = conn.rtt ?? null;
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
        };
      }
    } catch { /* ignore */ }
  }

  return info;
}

// ─────────────────────────────────────────────────────────────────────────────

export class UnifiedDebugLogger {
  /**
   * @param {'dnn'|'yolo'|'on-device'} method
   * @param {string} exerciseType — 'squat', 'deadlift', 'hip_thrust', 'auto'
   * @param {string} cameraAngle — 'side', 'front', '45'
   */
  constructor(method, exerciseType, cameraAngle) {
    this.enabled = DEBUG_ENABLED;
    if (!this.enabled) return;

    this.sessionId     = crypto.randomUUID();
    this.sessionStart  = performance.now();
    this.wallStart     = Date.now();
    this.method        = method;       // 'dnn' | 'yolo' | 'on-device'
    this.exerciseType  = exerciseType;
    this.cameraAngle   = cameraAngle;
    this.version       = import.meta.env.VITE_BUILD_HASH || 'dev';
    this.batchId       = null;         // Set externally for Test All runs

    // Video metadata
    this.video = {
      hash: null, fileName: null, fileSizeBytes: null,
      durationSec: null, resolution: null, codec: null,
      frameRate: null, orientation: null,
    };

    // Device
    this.device        = null;  // filled by init()

    // Timing markers (ms relative to sessionStart)
    this._marks = {};
    this._clientTimings = {
      fileSelectToSubmitMs: null,
      totalRoundTripMs:     null,
      resultParseMs:        null,
      videoRenderMs:        null,
      // Server-method network timings
      uploadStartMs:        null,
      uploadCompleteMs:     null,
      uploadDurationMs:     null,
      uploadSizeBytes:      null,
      serverProcessingMs:   null,
      downloadStartMs:      null,
      downloadCompleteMs:   null,
      downloadDurationMs:   null,
      downloadSizeBytes:    null,
      effectiveUploadBandwidthMbps:   null,
      effectiveDownloadBandwidthMbps: null,
      // On-device timings (merged from DebugLogger)
      phases: null,
      frames: null,
    };

    // Server-side timings (populated from API response)
    this.serverTimings = null;

    // Accuracy (populated after results)
    this.accuracy = {
      reps: null, perRepAngles: null, depthScorePct: null,
      letterGrade: null, formLabel: null, avgPrimaryAngle: null,
      bestRepAngle: null, worstRepAngle: null, angleStdDev: null,
      avgConfidence: null, symmetryScore: null, tempoLabel: null,
    };

    // Memory snapshots
    this._memoryBefore = captureMemory();
    this._memoryAfter  = null;
    this._batteryBefore = null;
    this._batteryAfter  = null;

    // Performance profile
    this._performanceProfile = null;

    // Error & event logs
    this.errors = [];
    this.events = [];
    this.tags   = [];

    // Run metadata (assigned by server on send)
    this.runNumber = null;
    this.runName   = null;
  }

  // ── Initialization ──────────────────────────────────────────────────────

  /**
   * Call once at the start — captures device fingerprint, video hash, battery.
   * @param {File} file — the video file being submitted
   */
  async init(file) {
    if (!this.enabled) return;

    const [deviceInfo, videoHash, batteryLevel] = await Promise.all([
      captureDeviceInfo(),
      hashVideoFile(file),
      captureBattery(),
    ]);

    this.device = deviceInfo;
    this.video.hash = videoHash;
    this.video.fileName = file.name;
    this.video.fileSizeBytes = file.size;
    this._batteryBefore = batteryLevel;

    // Try to extract video metadata via a temporary video element
    try {
      const url = URL.createObjectURL(file);
      const meta = await new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
          resolve({
            durationSec: Math.round(v.duration * 10) / 10,
            resolution: `${v.videoWidth}×${v.videoHeight}`,
            orientation: v.videoWidth > v.videoHeight ? 'landscape' : 'portrait',
          });
          URL.revokeObjectURL(url);
        };
        v.onerror = () => { reject(); URL.revokeObjectURL(url); };
        v.src = url;
      });
      Object.assign(this.video, meta);
    } catch { /* ignore — metadata not critical */ }

    this.event('logger', 'UnifiedDebugLogger initialized');
  }

  // ── Timing markers ──────────────────────────────────────────────────────

  _elapsed() {
    return Math.round(performance.now() - this.sessionStart);
  }

  markFileSelected() {
    if (!this.enabled) return;
    this._marks.fileSelected = this._elapsed();
  }

  markSubmitStart() {
    if (!this.enabled) return;
    this._marks.submitStart = this._elapsed();
    this._clientTimings.fileSelectToSubmitMs =
      (this._marks.submitStart - (this._marks.fileSelected ?? this._marks.submitStart));
  }

  markUploadStart() {
    if (!this.enabled) return;
    this._marks.uploadStart = this._elapsed();
    this._clientTimings.uploadStartMs = this._marks.uploadStart;
  }

  markUploadComplete() {
    if (!this.enabled) return;
    this._marks.uploadComplete = this._elapsed();
    this._clientTimings.uploadCompleteMs = this._marks.uploadComplete;
    this._clientTimings.uploadDurationMs = this._marks.uploadComplete - (this._marks.uploadStart ?? 0);
    this._clientTimings.uploadSizeBytes = this.video.fileSizeBytes;

    if (this._clientTimings.uploadDurationMs > 0 && this.video.fileSizeBytes) {
      this._clientTimings.effectiveUploadBandwidthMbps = Math.round(
        (this.video.fileSizeBytes * 8) / (this._clientTimings.uploadDurationMs * 1000) * 10
      ) / 10;
    }
  }

  markServerProcessingStart() {
    if (!this.enabled) return;
    this._marks.serverProcessingStart = this._elapsed();
  }

  markDownloadStart() {
    if (!this.enabled) return;
    this._marks.downloadStart = this._elapsed();
    this._clientTimings.downloadStartMs = this._marks.downloadStart;
    this._clientTimings.serverProcessingMs =
      (this._marks.downloadStart - (this._marks.uploadComplete ?? this._marks.downloadStart));
  }

  markDownloadComplete(sizeBytes) {
    if (!this.enabled) return;
    this._marks.downloadComplete = this._elapsed();
    this._clientTimings.downloadCompleteMs = this._marks.downloadComplete;
    this._clientTimings.downloadDurationMs =
      this._marks.downloadComplete - (this._marks.downloadStart ?? this._marks.downloadComplete);
    this._clientTimings.downloadSizeBytes = sizeBytes ?? null;

    if (this._clientTimings.downloadDurationMs > 0 && sizeBytes) {
      this._clientTimings.effectiveDownloadBandwidthMbps = Math.round(
        (sizeBytes * 8) / (this._clientTimings.downloadDurationMs * 1000) * 10
      ) / 10;
    }
  }

  /**
   * Call when the final result has been received and parsed.
   * @param {Object} result — the full API result object
   */
  markResultReceived(result) {
    if (!this.enabled) return;
    this._marks.resultReceived = this._elapsed();

    const t0 = performance.now();
    // Trigger any result parsing work here if needed
    this._clientTimings.resultParseMs = Math.round(performance.now() - t0);

    this._clientTimings.totalRoundTripMs =
      this._marks.resultReceived - (this._marks.submitStart ?? 0);

    // Capture post-processing memory
    this._memoryAfter = captureMemory();
  }

  markVideoRenderStart() {
    if (!this.enabled) return;
    this._marks.videoRenderStart = this._elapsed();
  }

  markVideoRenderComplete() {
    if (!this.enabled) return;
    this._clientTimings.videoRenderMs =
      this._elapsed() - (this._marks.videoRenderStart ?? 0);
  }

  // ── Server timings merge ──────────────────────────────────────────────

  /**
   * Merge server-side debug_timings from the API response.
   * @param {Object|null} debugTimings — from result.debug_timings
   */
  mergeServerTimings(debugTimings) {
    if (!this.enabled || !debugTimings) return;
    this.serverTimings = debugTimings;
  }

  // ── On-device report merge ────────────────────────────────────────────

  /**
   * Merge an existing DebugLogger report into the unified schema.
   * @param {Object|null} report — from debugLogger.getReport()
   */
  mergeOnDeviceReport(report) {
    if (!this.enabled || !report) return;
    this._clientTimings.phases = report.phases ?? null;
    this._clientTimings.frames = report.frames ?? null;
    this._clientTimings.totalRoundTripMs = report.total_duration_ms ?? null;

    // Merge device info if more complete than what we have
    if (report.device && !this.device) {
      this.device = report.device;
    }

    // Merge errors and events
    if (report.errors?.length) {
      this.errors.push(...report.errors);
    }
    if (report.events?.length) {
      this.events.push(...report.events);
    }

    // Detect thermal throttling from on-device frame telemetry
    if (report.frames?.length > 20) {
      this._detectThermalThrottling(report.frames);
    }
  }

  // ── Accuracy ──────────────────────────────────────────────────────────

  /**
   * Extract accuracy metrics from the result metadata.
   * @param {Object} metadata — result.metadata from server or on-device
   */
  setAccuracy(metadata) {
    if (!this.enabled || !metadata) return;
    const stats = metadata.stats ?? {};
    this.accuracy = {
      reps:             metadata.rep_count ?? stats.rep_count ?? null,
      perRepAngles:     stats.per_rep_angles ?? null,
      depthScorePct:    stats.depth_score_pct ?? null,
      letterGrade:      stats.letter_grade ?? null,
      formLabel:        stats.form_label ?? null,
      avgPrimaryAngle:  stats.avg_primary_angle ?? null,
      bestRepAngle:     stats.best_rep_angle ?? null,
      worstRepAngle:    stats.worst_rep_angle ?? null,
      angleStdDev:      stats.angle_std_dev ?? null,
      avgConfidence:    stats.avg_confidence ?? null,
      symmetryScore:    stats.symmetry?.symmetry_score ?? null,
      tempoLabel:       stats.tempo_label ?? null,
    };
  }

  // ── Error & event logging ─────────────────────────────────────────────

  /**
   * Log a structured error.
   * @param {string} code — from ErrorCodes enum
   * @param {Error|string} err
   * @param {Object} [context]
   */
  error(code, err, context) {
    if (!this.enabled) return;
    this.errors.push({
      t:        this._elapsed(),
      code:     code,
      name:     err?.name ?? 'Error',
      message:  err?.message ?? String(err),
      stack:    err?.stack?.split('\n').slice(0, 5).join('\n') ?? null,
      context:  context ?? null,
    });
  }

  /**
   * Log a timestamped event.
   * @param {string} category
   * @param {string} message
   * @param {Object} [data]
   */
  event(category, message, data) {
    if (!this.enabled) return;
    this.events.push({
      t:    this._elapsed(),
      cat:  category,
      msg:  message,
      data: data ?? null,
    });
  }

  // ── Thermal throttling detection ──────────────────────────────────────

  /**
   * Detect if later frames took significantly longer than earlier ones
   * (indicates CPU thermal throttling on mobile).
   * @param {Array} frames — per-frame telemetry from DebugLogger
   */
  _detectThermalThrottling(frames) {
    const inferTimes = frames
      .filter(f => f.infer_ms != null)
      .map(f => f.infer_ms);

    if (inferTimes.length < 20) return;

    const firstQuartile = inferTimes.slice(0, Math.floor(inferTimes.length * 0.25));
    const lastQuartile  = inferTimes.slice(Math.floor(inferTimes.length * 0.75));

    const avgFirst = firstQuartile.reduce((a, b) => a + b, 0) / firstQuartile.length;
    const avgLast  = lastQuartile.reduce((a, b) => a + b, 0) / lastQuartile.length;

    const throttled = avgLast > avgFirst * 1.5;
    const trend = avgLast > avgFirst * 1.2 ? 'degrading'
                : avgLast < avgFirst * 0.9 ? 'improving'
                : 'stable';

    this._performanceProfile = {
      thermal_throttled: throttled,
      inference_trend:   trend,
      early_avg_ms:      Math.round(avgFirst * 10) / 10,
      late_avg_ms:       Math.round(avgLast * 10) / 10,
      slowdown_ratio:    Math.round((avgLast / avgFirst) * 100) / 100,
      memory_pressure:   this._getMemoryPressure(),
    };
  }

  _getMemoryPressure() {
    const after = this._memoryAfter ?? captureMemory();
    if (!after.heapSizeLimit || !after.heapUsed) return 'unknown';
    const usage = after.heapUsed / after.heapSizeLimit;
    if (usage > 0.9) return 'critical';
    if (usage > 0.7) return 'warning';
    return 'normal';
  }

  // ── Report generation ─────────────────────────────────────────────────

  /**
   * Build the unified telemetry schema object.
   * @returns {Object}
   */
  toUnifiedSchema() {
    const autoName = [
      `run`,
      this.runNumber ? String(this.runNumber).padStart(4, '0') : '????',
      this.method === 'on-device' ? 'ondevice' : this.method,
      this.exerciseType,
    ].join('-');

    return {
      _schema_version: 2,
      run_number:      this.runNumber,
      run_name:        this.runName ?? autoName,
      batch_id:        this.batchId,
      session_id:      this.sessionId,
      timestamp:       new Date(this.wallStart).toISOString(),
      method:          this.method,
      version:         this.version,
      tags:            this.tags,

      video:           this.video,
      exercise_type:   this.exerciseType,
      camera_angle:    this.cameraAngle,
      device:          this.device,

      client_timings: {
        file_select_to_submit_ms:          this._clientTimings.fileSelectToSubmitMs,
        total_round_trip_ms:               this._clientTimings.totalRoundTripMs,
        result_parse_ms:                   this._clientTimings.resultParseMs,
        video_render_ms:                   this._clientTimings.videoRenderMs,
        upload_start_ms:                   this._clientTimings.uploadStartMs,
        upload_complete_ms:                this._clientTimings.uploadCompleteMs,
        upload_duration_ms:                this._clientTimings.uploadDurationMs,
        upload_size_bytes:                 this._clientTimings.uploadSizeBytes,
        server_processing_ms:              this._clientTimings.serverProcessingMs,
        download_start_ms:                 this._clientTimings.downloadStartMs,
        download_complete_ms:              this._clientTimings.downloadCompleteMs,
        download_duration_ms:              this._clientTimings.downloadDurationMs,
        download_size_bytes:               this._clientTimings.downloadSizeBytes,
        effective_upload_bandwidth_mbps:    this._clientTimings.effectiveUploadBandwidthMbps,
        effective_download_bandwidth_mbps:  this._clientTimings.effectiveDownloadBandwidthMbps,
        phases:                            this._clientTimings.phases,
        frames:                            this._clientTimings.frames,
      },

      server_timings:    this.serverTimings,
      accuracy:          this.accuracy,
      errors:            this.errors,
      events:            this.events,

      performance_profile: this._performanceProfile,

      memory: {
        before: this._memoryBefore,
        after:  this._memoryAfter ?? captureMemory(),
      },
      battery: {
        before: this._batteryBefore,
        after:  this._batteryAfter,
      },
    };
  }

  // ── Server upload ─────────────────────────────────────────────────────

  /**
   * POST the unified log to the Cloudflare Worker KV store.
   * Allocates a run number from the server's atomic counter.
   * Fire-and-forget — never blocks UI or throws.
   */
  async send() {
    if (!this.enabled) return;

    // Capture final battery
    this._batteryAfter = await captureBattery();
    this._memoryAfter  = captureMemory();

    const report = this.toUnifiedSchema();

    try {
      const res = await fetch('/ai-labs/api/debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });

      if (res.ok) {
        const data = await res.json();
        this.runNumber = data.run_number ?? null;
        this.runName   = data.run_name ?? this.runName;
        console.log(
          `[UnifiedDebugLogger] Log sent — run #${this.runNumber} (${this.method}, session: ${this.sessionId.slice(0, 8)})`
        );
      } else {
        console.warn(`[UnifiedDebugLogger] Server responded ${res.status}`);
      }
    } catch (e) {
      console.warn('[UnifiedDebugLogger] Failed to send log:', e.message);
    }
  }

  // ── Download & export ─────────────────────────────────────────────────

  /**
   * Generate a downloadable JSON blob URL.
   * @returns {string} Object URL for the debug log JSON file
   */
  toDownloadUrl() {
    const report = this.toUnifiedSchema();
    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: 'application/json' }
    );
    return URL.createObjectURL(blob);
  }

  /**
   * Generate a flat CSV row for spreadsheet export.
   * @returns {string} CSV-formatted string with header + data row
   */
  toCsvRow() {
    const r = this.toUnifiedSchema();
    const headers = [
      'run_number', 'method', 'version', 'exercise_type', 'timestamp',
      'total_round_trip_ms', 'upload_duration_ms', 'server_processing_ms',
      'download_duration_ms', 'upload_bandwidth_mbps', 'download_bandwidth_mbps',
      'reps', 'depth_score_pct', 'letter_grade', 'avg_confidence',
      'avg_primary_angle', 'angle_std_dev', 'device_platform', 'connection_type',
      'video_hash', 'video_size_bytes', 'video_duration_sec',
      'server_total_ms', 'inference_total_ms', 'inference_per_frame_ms',
      'frame_count', 'thermal_throttled', 'memory_pressure',
    ];

    const values = [
      r.run_number, r.method, r.version, r.exercise_type, r.timestamp,
      r.client_timings.total_round_trip_ms, r.client_timings.upload_duration_ms,
      r.client_timings.server_processing_ms, r.client_timings.download_duration_ms,
      r.client_timings.effective_upload_bandwidth_mbps,
      r.client_timings.effective_download_bandwidth_mbps,
      r.accuracy.reps, r.accuracy.depthScorePct, r.accuracy.letterGrade,
      r.accuracy.avgConfidence, r.accuracy.avgPrimaryAngle, r.accuracy.angleStdDev,
      r.device?.platform, r.device?.connectionType,
      r.video.hash, r.video.fileSizeBytes, r.video.durationSec,
      r.server_timings?.total_server_ms, r.server_timings?.inference_total_ms,
      r.server_timings?.inference_per_frame_ms, r.server_timings?.frame_count,
      r.performance_profile?.thermal_throttled,
      r.performance_profile?.memory_pressure,
    ];

    return headers.join(',') + '\n' + values.map(v => v ?? '').join(',');
  }
}

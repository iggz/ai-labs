/**
 * TestAllOrchestrator — Sequential 3-method benchmarking for ?debug=1 mode.
 *
 * Runs the same video through DirectML → Metal → On Device sequentially,
 * collecting unified telemetry for each. Creates a batch entry in KV
 * to group the 3 runs together for side-by-side comparison.
 *
 * Usage:
 *   import { runTestAll } from './testAllOrchestrator.js';
 *   const { batchId, results } = await runTestAll(file, {
 *     exerciseType: 'squat',
 *     cameraAngle: 'side',
 *     overlayMode: 'full',
 *     onProgress: ({ phase, method, index, total, ...rest }) => { ... },
 *   });
 *   // Navigate to /debug/compare?batch={batchId}
 */

import { UnifiedDebugLogger, hashVideoFile } from './unifiedDebugLogger.js';
import { submitAnalysis } from '../../lib/cvApi.js';

/** Allocate a batch ID from the atomic counter */
async function allocateBatchId() {
  try {
    const res = await fetch('/ai-labs/api/debug-counter/batches', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      return data.value;
    }
  } catch { /* fallback */ }
  return Date.now(); // fallback batch ID
}

/** Save batch metadata to KV */
async function saveBatchMetadata(batchNumber, data) {
  try {
    await fetch('/ai-labs/api/debug-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_number: batchNumber,
        ...data,
      }),
    });
  } catch (e) {
    console.warn('[TestAll] Failed to save batch metadata:', e.message);
  }
}

/**
 * Run the same video through DirectML, Metal, and On Device sequentially.
 *
 * @param {File} file — video file
 * @param {Object} options
 * @param {string} options.exerciseType — 'squat', 'deadlift', 'hip_thrust'
 * @param {string} options.cameraAngle — 'side', 'front', '45deg', 'auto'
 * @param {string} options.overlayMode — 'full', 'minimal', 'off'
 * @param {(progress: Object) => void} options.onProgress — progress callback
 * @returns {Promise<{ batchId: number, results: Object }>}
 */
export async function runTestAll(file, { exerciseType, cameraAngle, overlayMode, onProgress }) {
  const batchNumber = await allocateBatchId();
  const batchId = `batch:${String(batchNumber).padStart(4, '0')}`;
  const videoHash = await hashVideoFile(file);
  const results = {};
  const runNumbers = [];

  const methods = [
    { key: 'dml',       label: '⚡⚡ DirectML', protocol: 'dml',       isOnDevice: false },
    { key: 'yolo',      label: 'Metal',          protocol: 'yolo',      isOnDevice: false },
    { key: 'on-device', label: 'On Device',      protocol: 'on-device', isOnDevice: true  },
  ];

  onProgress?.({ phase: 'starting', batchId, total: methods.length });

  // Save initial batch metadata
  await saveBatchMetadata(batchNumber, {
    name: `testall-${exerciseType}-${new Date().toISOString().slice(0, 10)}`,
    video_hash: videoHash,
    exercise_type: exerciseType,
    status: 'in_progress',
    runs: [],
  });

  for (let i = 0; i < methods.length; i++) {
    const { key, label, protocol, isOnDevice } = methods[i];

    onProgress?.({
      phase: 'running',
      method: key,
      methodLabel: label,
      index: i,
      total: methods.length,
      message: `Running ${label}…`,
    });

    const logger = new UnifiedDebugLogger(key, exerciseType, cameraAngle);
    logger.batchId = batchId;
    logger.tags = ['test-all'];
    await logger.init(file);
    // Override hash with pre-computed one (same file)
    logger.video.hash = videoHash;
    logger.markFileSelected();
    logger.markSubmitStart();

    try {
      let res;

      if (isOnDevice) {
        const { processVideoOnDevice } = await import('./onDeviceInference.js');
        res = await processVideoOnDevice(file, {
          exerciseType,
          overlayMode,
          cameraAngle,
          preferredFormat: 'webm',
          onProgress: (p) => onProgress?.({
            ...p,
            phase: 'running',
            method: key,
            methodLabel: label,
            index: i,
            total: methods.length,
          }),
        });
        logger.mergeOnDeviceReport(res._debugLogger?.getReport());
      } else {
        res = await submitAnalysis(
          file,
          'form-ai',
          {
            exercise_type: exerciseType,
            overlay_mode: overlayMode,
            protocol,
            camera_angle: cameraAngle,
            consent_token: crypto.randomUUID(),
          },
          (p) => onProgress?.({
            ...p,
            phase: 'running',
            method: key,
            methodLabel: label,
            index: i,
            total: methods.length,
          }),
          logger,
        );
      }

      logger.setAccuracy(res.metadata);
      await logger.send();

      results[key] = {
        _status: 'completed',
        metadata: res.metadata,
        signed_url: res.signed_url,
        debug_timings: res.debug_timings ?? null,
        _unifiedDebugLogger: logger,
      };
      runNumbers.push(logger.runNumber);

      onProgress?.({
        phase: 'method_complete',
        method: key,
        methodLabel: label,
        index: i,
        total: methods.length,
        message: `${label} complete`,
      });

    } catch (err) {
      logger.error('ERR_UNKNOWN', err);
      await logger.send();

      results[key] = {
        _status: 'failed',
        _error: err.message,
        _unifiedDebugLogger: logger,
      };
      runNumbers.push(logger.runNumber);

      onProgress?.({
        phase: 'method_failed',
        method: key,
        methodLabel: label,
        index: i,
        total: methods.length,
        message: `${label} failed: ${err.message}`,
      });
    }
  }

  // Update batch with completed run numbers
  await saveBatchMetadata(batchNumber, {
    name: `testall-${exerciseType}-${new Date().toISOString().slice(0, 10)}`,
    video_hash: videoHash,
    exercise_type: exerciseType,
    runs: runNumbers.filter(Boolean),
    completed_at: new Date().toISOString(),
    status: 'completed',
  });

  onProgress?.({
    phase: 'complete',
    batchId,
    batchNumber,
    total: methods.length,
    results,
    message: 'All methods complete',
  });

  return { batchId, batchNumber, results };
}

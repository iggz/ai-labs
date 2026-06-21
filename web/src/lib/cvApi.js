/**
 * cvApi.js — CV Engine API Client
 * ================================
 * Handles video/photo submission, job polling, and retention management.
 * Communicates with the FastAPI CV engine via Cloudflare Tunnels.
 *
 * Multi-device routing (production):
 *   yolo    → https://api-mac.ilovetoridemybicycle.com  (Mac, CoreML/ANE)
 *   dml     → https://api.ilovetoridemybicycle.com      (PC, AMD DirectML)
 *   opencv  → https://api.ilovetoridemybicycle.com      (PC, default)
 *
 * Developer override: set localStorage key 'AILABS_CV_API_URL' to redirect
 * all protocols to a local or staging host (takes priority over everything).
 *
 * Debug telemetry (when ?debug=1):
 *   Wraps fetch calls with timing markers from UnifiedDebugLogger.
 *   Passes `debug=1` to the server so it returns debug_timings.
 */

// ── Production routing table ──────────────────────────────────────────────────
const PROTOCOL_HOSTS = {
  yolo:   'https://api-mac.ilovetoridemybicycle.com',  // Mac — CoreML / ANE
  dml:    'https://api.ilovetoridemybicycle.com',      // PC  — AMD DirectML
  opencv: 'https://api.ilovetoridemybicycle.com',      // PC  — OpenCV DNN (default)
};

/**
 * Returns the API base URL for generic use (health checks, retention, etc.).
 * Respects the localStorage developer override.
 */
export function getApiBase() {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('AILABS_CV_API_URL');
    if (custom) return custom.trim().replace(/\/$/, '');
  }
  return import.meta.env.VITE_CV_API_URL || 'http://localhost:8080';
}

/**
 * Returns the API base URL for a specific inference protocol.
 * Priority: localStorage override > VITE_CV_API_URL env > protocol routing table.
 *
 * @param {string} protocol — 'yolo' | 'dml' | 'opencv' | 'on-device'
 */
export function getApiBaseForProtocol(protocol) {
  // 1. Developer override always wins (covers all protocols)
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('AILABS_CV_API_URL');
    if (custom) return custom.trim().replace(/\/$/, '');
  }
  // 2. Build-time env var override
  const envUrl = import.meta.env.VITE_CV_API_URL;
  if (envUrl) return envUrl;
  // 3. Protocol-based production routing
  return PROTOCOL_HOSTS[protocol] ?? PROTOCOL_HOSTS.opencv;
}

/**
 * Submit a video/photo for CV analysis and poll until complete.
 * Resolves when the job is done, rejects on error or timeout.
 *
 * @param {File} file - Video or image file
 * @param {'form-ai'|'slingshot'|'smartfit'} analysisType
 * @param {Object} extraFields - Additional form fields (exercise_type, email, etc.)
 * @param {Function} onProgress - Optional callback({ phase, position, estimatedWait })
 * @param {import('./inference/unifiedDebugLogger.js').UnifiedDebugLogger} [debugLogger] - Optional debug logger
 * @returns {Promise<Object>} - Completed job result
 */
export async function submitAnalysis(file, analysisType, extraFields = {}, onProgress = null, debugLogger = null) {
  const formData = new FormData();
  formData.append('file', file);

  for (const [key, value] of Object.entries(extraFields)) {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  }

  // When debug logger is active, tell the server to return debug_timings
  if (debugLogger?.enabled) {
    formData.append('debug', 'true');
  }

  // Resolve the correct backend host for this protocol.
  // Pinned for both submit AND all subsequent poll requests so they always
  // hit the same machine (PC or Mac).
  const protocol = extraFields.protocol ?? 'opencv';
  const apiBase  = getApiBaseForProtocol(protocol);

  // 1. Submit job
  debugLogger?.markUploadStart();

  const submitRes = await fetch(`${apiBase}/api/v1/analyze/${analysisType}`, {
    method: 'POST',
    headers: {
      // Tell the backend which frontend build submitted this job.
      // VITE_BUILD_HASH is the git short hash baked in at build time (vite.config.js).
      'X-Build-Hash': import.meta.env.VITE_BUILD_HASH ?? 'unknown',
    },
    body: formData,
  });

  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || `Upload failed (${submitRes.status})`);
  }

  const { job_id, position, estimated_wait_seconds } = await submitRes.json();

  debugLogger?.markUploadComplete();
  debugLogger?.event('network', `Job submitted: ${job_id}`, { position, host: apiBase });

  onProgress?.({ phase: 'queued', position, estimatedWait: estimated_wait_seconds });

  // 2. Poll for completion (3-second intervals, same host as submit)
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let hasStartedProcessing = false;

    const pollInterval = setInterval(async () => {
      if (cancelled) return;
      try {
        const statusRes = await fetch(`${apiBase}/api/v1/jobs/${job_id}`);
        if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
        const status = await statusRes.json();

        if (status.status === 'processing') {
          if (!hasStartedProcessing) {
            hasStartedProcessing = true;
            debugLogger?.markServerProcessingStart();
            debugLogger?.event('network', 'Server processing started');
          }
          onProgress?.({ phase: 'processing' });
        } else if (status.status === 'completed') {
          cancelled = true;
          clearInterval(pollInterval);
          clearTimeout(timeoutId);

          // Track download timing for the result (video URL will be fetched separately)
          debugLogger?.markDownloadStart();

          const resData = status.result;
          if (resData && resData.signed_url && resData.signed_url.startsWith('/static/')) {
            resData.signed_url = `${apiBase}${resData.signed_url}`;
          }

          // Capture download size from server timings if available
          const downloadSize = resData?.debug_timings?.output_video_size_bytes ?? null;
          debugLogger?.markDownloadComplete(downloadSize);
          debugLogger?.markResultReceived(resData);

          // Merge server-side debug timings into the unified logger
          if (resData?.debug_timings) {
            debugLogger?.mergeServerTimings(resData.debug_timings);
            debugLogger?.event('network', 'Server debug_timings received', {
              total_server_ms: resData.debug_timings.total_server_ms,
              frame_count: resData.debug_timings.frame_count,
            });
          }

          resolve(resData);
        } else if (status.status === 'failed') {
          cancelled = true;
          clearInterval(pollInterval);
          clearTimeout(timeoutId);
          debugLogger?.error('ERR_SERVER_TIMEOUT', new Error(status.error || 'Processing failed'));
          reject(new Error(status.error || 'Processing failed'));
        }
      } catch (err) {
        cancelled = true;
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
        debugLogger?.error('ERR_NETWORK_DOWNLOAD', err);
        reject(err);
      }
    }, 3000);

    // Timeout after 6 minutes
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        cancelled = true;
        clearInterval(pollInterval);
        debugLogger?.error('ERR_SERVER_TIMEOUT', new Error('Processing timed out'));
        reject(new Error('Processing timed out. Please try a shorter video.'));
      }
    }, 360000);
  });
}

/**
 * Toggle the retention preference for a specific analysis.
 */
export async function setRetention(analysisId, retainForever) {
  const res = await fetch(
    `${getApiBase()}/api/v1/analyses/${analysisId}/retention?retain_forever=${retainForever}`,
    { method: 'PATCH' }
  );
  if (!res.ok) throw new Error('Failed to update retention');
  return res.json();
}

/**
 * Immediately delete an analysis and its associated video.
 */
export async function deleteAnalysis(analysisId) {
  const res = await fetch(`${getApiBase()}/api/v1/analyses/${analysisId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete analysis');
  return res.json();
}

/**
 * Fetch the health status of the CV engine.
 */
export async function getCVHealth() {
  const res = await fetch(`${getApiBase()}/api/v1/health`);
  if (!res.ok) throw new Error('CV engine unreachable');
  return res.json();
}

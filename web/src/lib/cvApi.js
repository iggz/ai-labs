/**
 * cvApi.js — CV Engine API Client
 * ================================
 * Handles video/photo submission, job polling, and retention management.
 * Communicates with the local FastAPI CV engine via the Vercel proxy.
 */

export function getApiBase() {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('HHB_CV_API_URL');
    if (custom) return custom.trim().replace(/\/$/, '');
  }
  return import.meta.env.VITE_CV_API_URL || 'http://localhost:8080';
}

/**
 * Submit a video/photo for CV analysis and poll until complete.
 * Resolves when the job is done, rejects on error or timeout.
 *
 * @param {File} file - Video or image file
 * @param {'form-ai'|'slingshot'|'smartfit'} analysisType
 * @param {Object} extraFields - Additional form fields (exercise_type, email, etc.)
 * @param {Function} onProgress - Optional callback({ phase, position, estimatedWait })
 * @returns {Promise<Object>} - Completed job result
 */
export async function submitAnalysis(file, analysisType, extraFields = {}, onProgress = null) {
  const formData = new FormData();
  formData.append('file', file);

  for (const [key, value] of Object.entries(extraFields)) {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  }

  // 1. Submit job
  const submitRes = await fetch(`${getApiBase()}/api/v1/analyze/${analysisType}`, {
    method: 'POST',
    body: formData,
  });

  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || `Upload failed (${submitRes.status})`);
  }

  const { job_id, position, estimated_wait_seconds } = await submitRes.json();

  onProgress?.({ phase: 'queued', position, estimatedWait: estimated_wait_seconds });

  // 2. Poll for completion (3-second intervals)
  return new Promise((resolve, reject) => {
    let cancelled = false;

    const pollInterval = setInterval(async () => {
      if (cancelled) return;
      try {
        const statusRes = await fetch(`${getApiBase()}/api/v1/jobs/${job_id}`);
        if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
        const status = await statusRes.json();

        if (status.status === 'processing') {
          onProgress?.({ phase: 'processing' });
        } else if (status.status === 'completed') {
          cancelled = true;
          clearInterval(pollInterval);
          clearTimeout(timeoutId);
          const resData = status.result;
          if (resData && resData.signed_url && resData.signed_url.startsWith('/static/')) {
            resData.signed_url = `${getApiBase()}${resData.signed_url}`;
          }
          resolve(resData);
        } else if (status.status === 'failed') {
          cancelled = true;
          clearInterval(pollInterval);
          clearTimeout(timeoutId);
          reject(new Error(status.error || 'Processing failed'));
        }
      } catch (err) {
        cancelled = true;
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
        reject(err);
      }
    }, 3000);

    // Timeout after 6 minutes
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        cancelled = true;
        clearInterval(pollInterval);
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

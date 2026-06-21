/**
 * AI Labs Worker — path rewriter for /ai-labs sub-path deployment
 *
 * ilovetoridemybicycle.com/ai-labs/* is routed to this Worker.
 * The Cloudflare Assets binding expects paths relative to web/dist/ root,
 * so /ai-labs/assets/foo.js → /assets/foo.js in the assets store.
 *
 * We also inject COOP/COEP headers required for SharedArrayBuffer
 * (needed for ONNX Runtime WASM multi-threading).
 *
 * Special route: /ai-labs/models/yolov8s-pose.onnx
 * → proxies from GitHub Releases, adding CORP header so COEP doesn't block it.
 *
 * Debug Telemetry API (v2):
 * → POST /api/debug-log            — Store a debug log with auto-assigned run number
 * → GET  /api/debug-logs            — List/filter recent debug logs
 * → GET  /api/debug-log/:key        — Retrieve a single debug log
 * → POST /api/debug-log/:key/meta   — Update name/tags/description for a log
 * → DELETE /api/debug-log/:key      — Delete a single debug log
 * → POST /api/debug-counter/:name   — Atomic increment counter
 * → GET  /api/debug-batches         — List Test All batches
 * → GET  /api/debug-batch/:id       — Get a batch with all run data
 * → POST /api/debug-batch           — Create/update a batch
 */

const GITHUB_MODEL_URL =
  'https://github.com/iggz/ai-labs/releases/download/v0.2.0-models/yolov8s-pose.onnx';

const COEP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** JSON response helper */
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...COEP_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Atomic increment for a KV counter. Returns the new value.
 * Uses a simple read-modify-write (KV doesn't support atomic ops natively,
 * but at our volume — a few writes/day — collisions are extremely unlikely).
 */
async function atomicIncrement(kv, counterName) {
  const key = `counter:${counterName}`;
  const current = await kv.get(key);
  const next = (parseInt(current, 10) || 0) + 1;
  await kv.put(key, String(next));
  return next;
}

/**
 * Generate auto-name from log metadata.
 */
function generateRunName(runNumber, body) {
  const num = String(runNumber).padStart(4, '0');
  const method = body.method === 'on-device' ? 'ondevice' : (body.method || 'unknown');
  const exercise = body.exercise_type || 'unknown';
  return `run-${num}-${method}-${exercise}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Strip /ai-labs prefix before looking up the asset
    const PREFIX = '/ai-labs';
    let path = url.pathname;
    if (path.startsWith(PREFIX)) {
      path = path.slice(PREFIX.length) || '/';
    }

    // ── CORS preflight for all /api/ routes ──
    if (request.method === 'OPTIONS' && path.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...COEP_HEADERS } });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Debug Log API Routes (v2) ──
    // ══════════════════════════════════════════════════════════════════════

    // POST /api/debug-log — store a debug log entry with auto-assigned run number
    if (path === '/api/debug-log' && request.method === 'POST') {
      try {
        const body = await request.json();
        const timestamp = new Date().toISOString();
        const sessionId = (body.session_id || 'unknown').slice(0, 8);

        // Allocate a sequential run number
        const runNumber = await atomicIncrement(env.DEBUG_LOGS, 'runs');
        const method = body.method === 'on-device' ? 'ondevice' : (body.method || 'unknown');

        // v2 key format: run:{NNNN}:{method}:{timestamp}:{session}
        const key = `run:${String(runNumber).padStart(4, '0')}:${method}:${timestamp}:${sessionId}`;
        const runName = generateRunName(runNumber, body);

        // Enrich the log with run metadata
        body.run_number = runNumber;
        if (!body.run_name || body.run_name.includes('????')) {
          body.run_name = runName;
        }

        await env.DEBUG_LOGS.put(key, JSON.stringify(body), {
          expirationTtl: 2592000, // 30 days (up from 7 days)
          metadata: {
            run_number: runNumber,
            method: body.method || 'unknown',
            exercise_type: body.exercise_type || 'unknown',
            video_hash: body.video?.hash?.slice(0, 16) || null,
            batch_id: body.batch_id || null,
            version: body.version || null,
            tags: (body.tags || []).join(','),
          },
        });

        // Also store run metadata separately for quick lookups
        await env.DEBUG_LOGS.put(`run-meta:${String(runNumber).padStart(4, '0')}`, JSON.stringify({
          run_number: runNumber,
          run_name: runName,
          method: body.method,
          exercise_type: body.exercise_type,
          video_hash: body.video?.hash || null,
          batch_id: body.batch_id || null,
          version: body.version,
          tags: body.tags || [],
          timestamp,
          description: null,
        }), {
          expirationTtl: 2592000,
        });

        return jsonResponse({ ok: true, key, run_number: runNumber, run_name: runName });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // GET /api/debug-logs — list recent debug logs with filtering
    if (path === '/api/debug-logs' && request.method === 'GET') {
      const params = url.searchParams;
      const filterMethod = params.get('method');
      const filterVideoHash = params.get('video_hash');
      const filterTag = params.get('tag');
      const filterBatch = params.get('batch');
      const filterVersion = params.get('version');
      const filterSince = params.get('since');
      const limit = Math.min(parseInt(params.get('limit'), 10) || 50, 200);

      // List both v2 (run:*) and v1 (log:*) keys for backwards compatibility
      const [v2List, v1List] = await Promise.all([
        env.DEBUG_LOGS.list({ prefix: 'run:', limit: 200 }),
        env.DEBUG_LOGS.list({ prefix: 'log:', limit: 50 }),
      ]);

      let entries = [];

      // Process v2 entries (with metadata filtering)
      for (const k of v2List.keys) {
        const meta = k.metadata || {};

        // Apply filters using KV metadata (no need to fetch full log)
        if (filterMethod && meta.method !== filterMethod) continue;
        if (filterVideoHash && !meta.video_hash?.startsWith(filterVideoHash)) continue;
        if (filterTag && !(meta.tags || '').split(',').includes(filterTag)) continue;
        if (filterBatch && meta.batch_id !== filterBatch && meta.batch_id !== `batch:${filterBatch}`) continue;
        if (filterVersion && meta.version !== filterVersion) continue;

        // Parse timestamp from key: run:NNNN:method:TIMESTAMP:session
        const parts = k.name.split(':');
        const timestamp = parts.slice(3, -1).join(':');

        if (filterSince && timestamp < filterSince) continue;

        entries.push({
          key: k.name,
          run_number: meta.run_number ?? null,
          method: meta.method ?? null,
          exercise_type: meta.exercise_type ?? null,
          video_hash: meta.video_hash ?? null,
          batch_id: meta.batch_id ?? null,
          version: meta.version ?? null,
          tags: meta.tags ? meta.tags.split(',').filter(Boolean) : [],
          timestamp,
        });
      }

      // Process v1 entries (legacy, no metadata — include as-is)
      if (!filterMethod && !filterVideoHash && !filterTag && !filterBatch && !filterVersion) {
        for (const k of v1List.keys) {
          const parts = k.name.split(':');
          const timestamp = parts.slice(1, -1).join(':');
          entries.push({
            key: k.name,
            run_number: null,
            method: null,
            exercise_type: null,
            video_hash: null,
            batch_id: null,
            version: null,
            tags: [],
            timestamp,
            _legacy: true,
          });
        }
      }

      // Sort by run_number descending (newest first), then by timestamp
      entries.sort((a, b) => (b.run_number ?? 0) - (a.run_number ?? 0));

      // Apply limit
      entries = entries.slice(0, limit);

      return jsonResponse(entries);
    }

    // GET /api/debug-log/:key — retrieve a single debug log
    if (path.startsWith('/api/debug-log/') && !path.includes('/meta') && request.method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/debug-log/'.length));
      const value = await env.DEBUG_LOGS.get(id);

      if (value === null) {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      return jsonResponse(JSON.parse(value));
    }

    // POST /api/debug-log/:key/meta — update name/tags/description for a log
    if (path.match(/^\/api\/debug-log\/.+\/meta$/) && request.method === 'POST') {
      try {
        const keyPath = path.slice('/api/debug-log/'.length, -'/meta'.length);
        const key = decodeURIComponent(keyPath);
        const updates = await request.json();

        // Fetch existing log
        const existing = await env.DEBUG_LOGS.get(key);
        if (!existing) return jsonResponse({ error: 'Not found' }, 404);

        const log = JSON.parse(existing);

        // Apply metadata updates
        if (updates.run_name !== undefined) log.run_name = updates.run_name;
        if (updates.tags !== undefined) log.tags = updates.tags;
        if (updates.description !== undefined) log.description = updates.description;

        // Re-store with updated metadata
        await env.DEBUG_LOGS.put(key, JSON.stringify(log), {
          expirationTtl: 2592000,
          metadata: {
            run_number: log.run_number,
            method: log.method || 'unknown',
            exercise_type: log.exercise_type || 'unknown',
            video_hash: log.video?.hash?.slice(0, 16) || null,
            batch_id: log.batch_id || null,
            version: log.version || null,
            tags: (log.tags || []).join(','),
          },
        });

        // Also update run-meta if it exists
        if (log.run_number) {
          const metaKey = `run-meta:${String(log.run_number).padStart(4, '0')}`;
          const metaRaw = await env.DEBUG_LOGS.get(metaKey);
          if (metaRaw) {
            const meta = JSON.parse(metaRaw);
            if (updates.run_name !== undefined) meta.run_name = updates.run_name;
            if (updates.tags !== undefined) meta.tags = updates.tags;
            if (updates.description !== undefined) meta.description = updates.description;
            await env.DEBUG_LOGS.put(metaKey, JSON.stringify(meta), { expirationTtl: 2592000 });
          }
        }

        return jsonResponse({ ok: true, run_name: log.run_name, tags: log.tags });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // DELETE /api/debug-log/:key — delete a single debug log
    if (path.startsWith('/api/debug-log/') && !path.includes('/meta') && request.method === 'DELETE') {
      const key = decodeURIComponent(path.slice('/api/debug-log/'.length));
      await env.DEBUG_LOGS.delete(key);
      return jsonResponse({ ok: true, deleted: key });
    }

    // POST /api/debug-counter/:name — atomic increment counter
    if (path.startsWith('/api/debug-counter/') && request.method === 'POST') {
      const name = path.slice('/api/debug-counter/'.length);
      if (!['runs', 'batches'].includes(name)) {
        return jsonResponse({ error: 'Invalid counter name' }, 400);
      }
      const value = await atomicIncrement(env.DEBUG_LOGS, name);
      return jsonResponse({ counter: name, value });
    }

    // GET /api/debug-batches — list Test All batches
    if (path === '/api/debug-batches' && request.method === 'GET') {
      const list = await env.DEBUG_LOGS.list({ prefix: 'batch:', limit: 50 });

      // Parallel KV reads (avoid sequential latency)
      const batchValues = await Promise.all(
        list.keys.map(k => env.DEBUG_LOGS.get(k.name))
      );
      const batches = list.keys
        .map((k, i) => batchValues[i] ? { key: k.name, ...JSON.parse(batchValues[i]) } : null)
        .filter(Boolean);

      // Sort newest first
      batches.sort((a, b) => (b.batch_number ?? 0) - (a.batch_number ?? 0));
      return jsonResponse(batches);
    }

    // GET /api/debug-batch/:id — get a batch with all run data
    if (path.startsWith('/api/debug-batch/') && request.method === 'GET') {
      const batchKey = `batch:${path.slice('/api/debug-batch/'.length).padStart(4, '0')}`;
      const batchRaw = await env.DEBUG_LOGS.get(batchKey);
      if (!batchRaw) return jsonResponse({ error: 'Batch not found' }, 404);

      const batch = JSON.parse(batchRaw);

      // Fetch all runs in this batch (parallel)
      let runs = [];
      if (batch.runs?.length) {
        const runResults = await Promise.all(
          batch.runs.map(async (runNum) => {
            const runList = await env.DEBUG_LOGS.list({
              prefix: `run:${String(runNum).padStart(4, '0')}:`,
              limit: 1,
            });
            if (runList.keys.length > 0) {
              const runData = await env.DEBUG_LOGS.get(runList.keys[0].name);
              return runData ? JSON.parse(runData) : null;
            }
            return null;
          })
        );
        runs = runResults.filter(Boolean);
      }

      return jsonResponse({ ...batch, run_data: runs });
    }

    // POST /api/debug-batch — create or update a batch
    if (path === '/api/debug-batch' && request.method === 'POST') {
      try {
        const body = await request.json();

        let batchNumber = body.batch_number;
        if (!batchNumber) {
          batchNumber = await atomicIncrement(env.DEBUG_LOGS, 'batches');
        }

        const batchKey = `batch:${String(batchNumber).padStart(4, '0')}`;

        const batchData = {
          batch_number: batchNumber,
          name: body.name || `batch-${String(batchNumber).padStart(4, '0')}`,
          runs: body.runs || [],
          video_hash: body.video_hash || null,
          exercise_type: body.exercise_type || null,
          created_at: body.created_at || new Date().toISOString(),
          completed_at: body.completed_at || null,
          status: body.status || 'in_progress',
        };

        await env.DEBUG_LOGS.put(batchKey, JSON.stringify(batchData), {
          expirationTtl: 2592000,
        });

        return jsonResponse({ ok: true, batch_number: batchNumber, key: batchKey });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Special case: proxy the ONNX model so it becomes same-origin ──
    // ══════════════════════════════════════════════════════════════════════
    // GitHub Releases doesn't send Cross-Origin-Resource-Policy or CORS headers,
    // which COEP: require-corp blocks. Proxying through the worker makes it
    // same-origin and adds the required COEP headers.
    if (path === '/models/yolov8s-pose.onnx') {
      const upstream = await fetch(GITHUB_MODEL_URL, {
        // Pass through Range headers for resumable downloads / streaming
        headers: request.headers.has('range')
          ? { range: request.headers.get('range') }
          : {},
        cf: {
          // Cache at Cloudflare edge for 7 days — avoids re-fetching 45 MB
          cacheEverything: true,
          cacheTtl: 604800,
        },
      });

      const headers = new Headers(upstream.headers);
      // Make it same-origin-safe under COEP: require-corp
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      // Add COEP/COOP to the model response too
      for (const [k, v] of Object.entries(COEP_HEADERS)) headers.set(k, v);
      // Allow browser caching of the model
      headers.set('Cache-Control', 'public, max-age=604800, immutable');

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    // ── Normal asset lookup: rewrite path, fetch from ASSETS ──
    const rewrittenUrl = new URL(url);
    rewrittenUrl.pathname = path;
    const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
    const response = await env.ASSETS.fetch(rewrittenRequest);

    // Inject COOP/COEP headers on every response
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(COEP_HEADERS)) newHeaders.set(k, v);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

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
 */

const GITHUB_MODEL_URL =
  'https://github.com/iggz/ai-labs/releases/download/v0.2.0-models/yolov8s-pose.onnx';

const COEP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Strip /ai-labs prefix before looking up the asset
    const PREFIX = '/ai-labs';
    let path = url.pathname;
    if (path.startsWith(PREFIX)) {
      path = path.slice(PREFIX.length) || '/';
    }

    // ── Special case: proxy the ONNX model so it becomes same-origin ──
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

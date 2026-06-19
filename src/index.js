/**
 * AI Labs Worker — path rewriter for /ai-labs sub-path deployment
 *
 * ilovetoridemybicycle.com/ai-labs/* is routed to this Worker.
 * The Cloudflare Assets binding expects paths relative to web/dist/ root,
 * so /ai-labs/assets/foo.js → /assets/foo.js in the assets store.
 *
 * We also inject COOP/COEP headers required for SharedArrayBuffer
 * (needed for ONNX Runtime WASM multi-threading).
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Strip /ai-labs prefix before looking up the asset
    const PREFIX = '/ai-labs';
    let path = url.pathname;
    if (path.startsWith(PREFIX)) {
      path = path.slice(PREFIX.length) || '/';
    }

    // Rewrite the URL to strip the prefix
    const rewrittenUrl = new URL(url);
    rewrittenUrl.pathname = path;

    const rewrittenRequest = new Request(rewrittenUrl.toString(), request);

    // Fetch from the static assets binding
    const response = await env.ASSETS.fetch(rewrittenRequest);

    // Clone response and add COOP/COEP headers for SharedArrayBuffer support
    // (required by ONNX Runtime WASM multi-threading)
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
    newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

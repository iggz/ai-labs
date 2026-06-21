import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ONNX Runtime WASM files are served from jsDelivr CDN (each file ~12-26 MB,
// exceeds Cloudflare Workers' 25 MB asset limit — CDN is the correct approach).
// ort.env.wasm.wasmPaths is set in onnxPoseInference.js to point to jsDelivr.
//
// Production base: '/ai-labs/' (ilovetoridemybicycle.com/ai-labs)
// Dev base: '/'  (localhost:517x) — simpler local development

const MODEL_DEV_PATH = path.resolve('../services/cv-engine/yolov8s-pose.onnx');

// Git hash for version tracking in debug telemetry
const GIT_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
})();

export default defineConfig(({ command }) => {
  const isProd = command === 'build';
  return {
    base: isProd ? '/ai-labs/' : '/',
    define: {
      'import.meta.env.VITE_BUILD_HASH': JSON.stringify(GIT_HASH),
    },
    plugins: [
      react(),
      // Dev-only: serve the ONNX model at /models/yolov8s-pose.onnx without
      // putting it in public/ (which would copy it into dist/)
      !isProd && {
        name: 'serve-dev-overrides',
        configureServer(server) {
          // Serve the ONNX model without putting it in public/
          server.middlewares.use('/models/yolov8s-pose.onnx', (req, res) => {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            fs.createReadStream(MODEL_DEV_PATH).pipe(res);
          });

          // Proxy debug API routes to the production Cloudflare Worker
          // so the debug dashboard/compare pages AND the debug loggers work in dev.
          // Catches both:
          //   /api/debug*          (dashboard uses API_BASE='')
          //   /ai-labs/api/debug*  (debug logger & orchestrator hardcode /ai-labs prefix)
          server.middlewares.use(async (req, res, next) => {
            // Normalize: strip /ai-labs prefix if present, then check for /api/debug
            let apiPath = req.url;
            if (apiPath?.startsWith('/ai-labs/api/debug')) {
              apiPath = apiPath.replace('/ai-labs', '');
            }
            if (!apiPath?.startsWith('/api/debug')) return next();

            const upstreamUrl = `https://ilovetoridemybicycle.com/ai-labs${apiPath}`;
            try {
              // Build upstream request options
              const fetchOpts = { method: req.method, headers: {} };
              if (req.method === 'POST' || req.method === 'PATCH') {
                // Read the request body
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                fetchOpts.body = Buffer.concat(chunks);
                fetchOpts.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
              }

              const upstream = await fetch(upstreamUrl, fetchOpts);
              const body = await upstream.text();

              // Return clean JSON response (strip Worker's COEP/COOP headers)
              res.writeHead(upstream.status, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
              });
              res.end(body);
            } catch (err) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
            }
          });
        },
      },
      // Build-only: exclude large WASM files from the dist output
      // They're served from jsDelivr CDN at runtime, not bundled
      isProd && {
        name: 'exclude-wasm-from-dist',
        generateBundle(_opts, bundle) {
          for (const key of Object.keys(bundle)) {
            if (key.endsWith('.wasm')) {
              delete bundle[key];
            }
          }
        },
      },
    ].filter(Boolean),
    optimizeDeps: {
      // Prevent Vite from pre-bundling onnxruntime-web (it has WASM imports)
      exclude: ['onnxruntime-web'],
    },
    worker: {
      format: 'es',  // Use ES modules for Web Workers
    },
    build: {
      rollupOptions: {
        output: {
          // Ensure no wasm files end up in the output bundle
          assetFileNames(assetInfo) {
            if (assetInfo.name?.endsWith('.wasm')) {
              return 'wasm/[name][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    server: {
      headers: {
        // Required for SharedArrayBuffer (ONNX WASM multi-threaded)
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
  };
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ONNX Runtime WASM files are served from jsDelivr CDN (each file ~12-26 MB,
// exceeds Cloudflare Workers' 25 MB asset limit — CDN is the correct approach).
// ort.env.wasm.wasmPaths is set in onnxPoseInference.js to point to jsDelivr.
//
// Production base: '/ai-labs/' (ilovetoridemybicycle.com/ai-labs)
// Dev base: '/' (localhost:517x) — set via VITE_BASE env or auto-detected

export default defineConfig(({ command }) => {
  const isProd = command === 'build';
  return {
    base: isProd ? '/ai-labs/' : '/',
    plugins: [
      react(),
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

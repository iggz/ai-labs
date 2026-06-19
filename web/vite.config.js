import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ONNX Runtime WASM files are served from jsDelivr CDN (each file ~12-26 MB,
// exceeds Cloudflare Workers' 25 MB asset limit — CDN is the correct approach).
// ort.env.wasm.wasmPaths is set in onnxPoseInference.js to point to jsDelivr.
//
// The app is served at ilovetoridemybicycle.com/ai-labs
// base: '/ai-labs/' makes all asset references relative to that path.

export default defineConfig({
  base: '/ai-labs/',
  plugins: [
    react(),
    // Plugin: exclude large WASM files from the dist output
    // They're served from jsDelivr CDN at runtime, not bundled
    {
      name: 'exclude-wasm-from-dist',
      generateBundle(_opts, bundle) {
        for (const key of Object.keys(bundle)) {
          if (key.endsWith('.wasm')) {
            delete bundle[key];
          }
        }
      },
    },
  ],
  optimizeDeps: {
    // Prevent Vite from pre-bundling onnxruntime-web (it has WASM imports)
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',  // Use ES modules for Web Workers
  },
  // Prevent Vite from treating .wasm as an asset to copy/emit
  // (we serve them from CDN, not from our dist)
  assetsInclude: [],
  build: {
    rollupOptions: {
      output: {
        // Ensure no wasm files end up in the output bundle
        assetFileNames(assetInfo) {
          if (assetInfo.name?.endsWith('.wasm')) {
            // Return a throwaway path — the exclude plugin above removes them
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
});

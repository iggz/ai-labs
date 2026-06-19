import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ONNX Runtime WASM files are served from jsDelivr CDN (each file ~12-26 MB,
// exceeds Cloudflare Workers' 25 MB asset limit — CDN is the correct approach).
// ort.env.wasm.wasmPaths is set in onnxPoseInference.js to point to jsDelivr.

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Prevent Vite from pre-bundling onnxruntime-web (it has WASM imports)
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',  // Use ES modules for Web Workers
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (ONNX WASM multi-threaded)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});

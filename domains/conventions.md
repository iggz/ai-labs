# Project Conventions

## Coding Philosophy
- **Ponytail Mode (Lazy Senior Dev):** Keep the code minimal. Boring over clever. Prioritize standard library and native APIs before third-party packages. Deletion over addition.
- **Privacy First:** Raw biometric coordinates or video bytes must never be persisted to databases. Only aggregates (rep count, duration, base size, etc.) are allowed.
- **Single Responsibility:** Let the backend handle heavy Python CV tasks and the frontend handle WebGPU/interactive visualizations.

## Code Style & Tools
- **Frontend (JavaScript/React):**
  - Use vanilla CSS for styling (located in `index.css`, `cv.css`, `benchmark.css`, `debug-dashboard.css`).
  - Native browser APIs are preferred for SEO/title management (`document.title`) instead of `react-helmet-async`.
  - Multi-page React Router structure.
- **Backend (Python):**
  - FastAPI serving endpoints under `/api/v1/`.
  - Bounded asyncio queue for GPU workloads.
  - Zero disk write during inference (process in-memory or in temp files).
- **Edge (Cloudflare Worker):**
  - wrangler/nodejs compatibility mode.
  - Telemetry stored in KV under `run:` prefixes.

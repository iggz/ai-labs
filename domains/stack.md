# Project Stack & Dependencies

## Frontend (web/)
- **Vite** (Vite dev server)
- **React 19**
- **React Router 7**
- **Lucide React** (icons)
- **ONNX Runtime Web** (on-device pose estimation)
- **MP4 Muxer** (piped browser video muxing)

## Backend (services/cv-engine/)
- **Python 3.11**
- **FastAPI**
- **Uvicorn**
- **OpenCV Python Headless**
- **Supabase Python Client**
- **Numpy**
- **Pydantic**
- **CoreMLTools** (Apple Silicon Neural Engine Support)
- **ImageIO FFmpeg** (portable path resolution)

## Deployment / Cloudflare Worker (root)
- **Wrangler**
- **Cloudflare Assets** (binding to `web/dist`)
- **Cloudflare KV** (debug logs storage)

# HHB AI Labs — Developer Guide

This document contains standard commands for building, running, and testing the HHB AI Labs suite.

---

## 1. Cloudflare Worker Edge Proxy (Root)
- **Dev Server:**
  ```bash
  wrangler dev
  ```
- **Production Deployment:** pushing `main` deploys automatically (Cloudflare git integration, about a minute). `wrangler deploy` is only needed to deploy without a push.
  ```bash
  wrangler deploy
  ```

---

## 2. Frontend React Web App (`web/`)
- **Setup:**
  ```bash
  cd web && npm install
  ```
- **Dev Server:**
  ```bash
  cd web && npm run dev
  ```
- **Production Build:**
  ```bash
  cd web && npm run build
  ```
- **Run Playwright Spec Tests:**
  ```bash
  cd web && npx playwright test
  ```

---

## 3. Python CV Engine Backend (`services/cv-engine/`)
| | Mac (bash) | PC (PowerShell) |
|---|---|---|
| Setup | `./setup.sh` | `powershell -ExecutionPolicy Bypass -File setup_nvidia.ps1` |
| Activate venv | `source .venv/bin/activate` | `.venv\Scripts\Activate.ps1` |
| Dev server | `uvicorn main:app --host 0.0.0.0 --port 8080 --reload` | same |
| Tests | `pytest` | `pytest` |

`setup_win.ps1` is the retired AMD/DirectML setup — don't run it on the PC (it installs `onnxruntime-directml`, which clashes with `onnxruntime-gpu`).

**PC production:** the server and the Cloudflare tunnel (`hhb-cv-engine` → `api.ilovetoridemybicycle.com`) start at sign-in via the Task Scheduler task "ai-labs cv-engine", which runs `start_pc.ps1`; it restarts either process within ~10s if it exits. Stopping the task doesn't stop them, so kill `python`/`cloudflared` as well. Only the PC may run a connector for `hhb-cv-engine` (the Mac runs `hhb-cv-engine-mac` only): two connectors split traffic and break job polling.

---

## 4. Machines & Inference Routing
The frontend picks a backend host per **protocol** (`PROTOCOL_HOSTS` in `web/src/lib/cvApi.js`); the server maps protocol → model in `form_ai._get_pose_model()`.

| Protocol | Host | Machine | Backend actually used |
|---|---|---|---|
| `cuda` (**default**) | `api.ilovetoridemybicycle.com` | PC tower "GamingPC" — RTX 5090 (Blackwell, sm_120) | `yolo11x-pose.engine` via Ultralytics + TensorRT FP16 (`cuda_pose.py`) |
| `yolo` ("Metal") | `api-mac.ilovetoridemybicycle.com` | Mac — M4 Pro | `yolov8s-pose.mlpackage` via CoreML (`coreml_pose.py`) |
| `dml` (legacy) | `api.ilovetoridemybicycle.com` | PC | AMD card is gone; served by the CUDA model when DirectML is missing. Frontend migrates saved `dml` prefs to `cuda`. Drop the alias once no old clients remain. |
| `opencv` | `api.ilovetoridemybicycle.com` | PC | OpenCV DNN on CPU (fallback) |
| `on-device` | — (browser) | user's device | ONNX Runtime Web |

- `api-cuda.ilovetoridemybicycle.com` (the old RTX 2060 laptop plan) is no longer referenced.
- Machine identity comes from the hostname (`_HOSTNAME_TO_ID` in `main.py`), and `INFERENCE_BACKEND` is set to whatever model really loaded. Never hardcode either in `.env`.
- CUDA model fallback order (first file found wins): `yolo11x-pose.engine` → `yolo11m-pose.engine` → `yolov8s-pose.engine` → `yolo11x-pose.onnx` → `yolo11m-pose.onnx` → `yolo11x-pose.pt` → `yolov8s-pose.onnx` → `yolov8s-pose.pt`.
- Video encode picks the best FFmpeg encoder: `h264_nvenc` (PC) → `h264_amf` → `h264_videotoolbox` (Mac) → `libx264` (`encoding_utils.py`).

---

## 5. Working From Both Machines
**Shared through git:** code, this file, `domains/*.md` (overview / conventions / stack), `.claude/settings.json`, and the project agents and skills in `.claude/agents/`. `.claude/agents/` used to be the Mac-only `.agents` symlink to `~/.claude/agents`; edit the repo copy, not the global one.

**Per machine, never committed — recreate on each machine:**
- `services/cv-engine/.venv/`: run that machine's setup script.
- Model files (`*.onnx`, `*.pt`, `*.mlpackage`, `*.engine`, `trt_cache/`). The setup scripts build them. A TensorRT `.engine` is tied to the exact GPU and TensorRT version, so never copy one between machines; delete it and re-run `setup_nvidia.ps1` after a driver or TensorRT upgrade.
- `services/cv-engine/.env` needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIRECRAWL_API_KEY`, `CLOUDFLARE_TUNNEL_URL`, and optionally `SAVE_DEBUG_VIDEOS`. Copy it by hand; don't commit it.
- `.claude/settings.local.json` and Claude Code memory (`~/.claude/projects/...`) are local to each machine. **Anything both machines need to know goes in this file.**
- `vault` is a symlink into the Mac's Obsidian vault and only exists on the Mac.

**What each machine can test:** the Mac can't exercise CUDA, TensorRT or NVENC, because the GPU tests in `tests/test_nvidia_acceleration.py` are mocked. Verify GPU changes on the PC: submit a video with `?debug=1` and check `inference_backend` plus `debug_timings`.

---

## 6. Invariants (don't break)
- **Privacy:** keypoints, angles and body measurements are never written to the database or returned. Only non-biometric metadata (rep_count, duration_sec, exercise_type) is stored.
- Every pose backend's `predict(frame, conf)` returns `{keypoints (17,2), confidences (17,), bbox (x1,y1,x2,y2), score}` and sets `_last_predict_ms`.
- One job at a time through `job_queue.py` (bounded queue, 5-minute timeout).
- Coding style: see `domains/conventions.md` (ponytail: minimal, stdlib first, deletion over addition).

---

## 7. Open Work: RTX 5090 Performance
With TensorRT, inference drops to a few ms per frame, so the CPU becomes the bottleneck. Measure with `?debug=1` on the PC first, then in order of payoff:
1. Decode frames in a background thread (`form_ai._iter_frames`) so reading the video overlaps with inference.
2. Downscale frames before the overlay is drawn (right now full-size frames go to FFmpeg and only get scaled to 1280 at the end).
3. Spend the spare GPU on accuracy: `python export_tensorrt.py --model yolo11x-pose.pt --imgsz 960`. Only the `.engine` path reads imgsz from the model; the ONNX path hardcodes 640.
4. Run jobs concurrently (32 GB VRAM allows it), but only once there are concurrent users.

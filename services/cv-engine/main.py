"""
main.py — HHB CV Engine FastAPI Application
============================================
Provides endpoints for FormAI Coach, SlingShot Socials, and SmartFit Guide.
All processing uses a bounded asyncio job queue to prevent GPU memory conflicts.

Endpoints:
  POST /api/v1/analyze/form-ai      → Submit FormAI analysis job
  POST /api/v1/analyze/slingshot    → Submit SlingShot job
  POST /api/v1/analyze/smartfit     → Submit SmartFit job (returns direct result)
  GET  /api/v1/jobs/{job_id}        → Poll job status
  GET  /api/v1/health               → Health + GPU status check

Privacy:
  - Raw video/photo bytes are never written to disk (except temp files during processing)
  - Biometric data (keypoints, angles, body measurements) is NEVER persisted to DB
  - Only non-biometric metadata is stored: rep_count, duration_sec, exercise_type
"""

import os
import logging
import tempfile
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

# Load local environment variables from .env file
load_dotenv()


from job_queue import CVJobQueue, QueueFullError
from form_ai import process_form_ai
from slingshot import process_slingshot
from smartfit import process_smartfit

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Local Debug Configuration ─────────────────────────────────────────────────
# Set to True to copy all processed videos to a local debug folder.
# This folder is ignored in git and is for developer test capture.
SAVE_LOCAL_DEBUG_VIDEOS = os.environ.get("SAVE_DEBUG_VIDEOS", "false").lower() == "true"

# ── Supabase Client ───────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

supabase: Client | None = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    logger.info("Supabase client initialized")
else:
    logger.warning("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — DB writes disabled")

# ── Job Queue ─────────────────────────────────────────────────────────────────
job_queue = CVJobQueue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Register processors and start worker on startup."""
    job_queue.register_processor("form_ai", process_form_ai)
    job_queue.register_processor("slingshot", _process_slingshot_with_upload)
    job_queue.register_processor("smartfit", process_smartfit)
    await job_queue.start_worker()
    logger.info("CV Engine worker started")
    yield
    await job_queue.stop_worker()
    logger.info("CV Engine worker stopped")


app = FastAPI(
    title="HHB CV Engine",
    version="1.0.0",
    lifespan=lifespan,
)

# Mount local static processed file directory
os.makedirs("static/processed", exist_ok=True)

@app.get("/static/processed/{video_name}")
async def serve_video(video_name: str, range: str = Header(None)):
    video_path = os.path.join("static", "processed", video_name)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video not found")
        
    file_size = os.path.getsize(video_path)
    
    # Parse range header
    start, end = 0, file_size - 1
    if range:
        try:
            # format: "bytes=start-end"
            range_str = range.replace("bytes=", "").split("-")
            start = int(range_str[0])
            if len(range_str) > 1 and range_str[1]:
                end = int(range_str[1])
        except Exception:
            pass
            
    # Clip range
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    
    chunk_size = end - start + 1
    
    if not range:
        # Serve the entire file with 200 OK
        def full_file_generator():
            with open(video_path, "rb") as f:
                while True:
                    chunk = f.read(1024 * 64)
                    if not chunk:
                        break
                    yield chunk
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": "video/mp4",
            "Access-Control-Allow-Origin": "*",
        }
        return StreamingResponse(full_file_generator(), status_code=200, headers=headers)
        
    # We can stream the file generator
    def file_generator():
        with open(video_path, "rb") as f:
            f.seek(start)
            bytes_left = chunk_size
            while bytes_left > 0:
                chunk = f.read(min(bytes_left, 1024 * 64)) # read in 64kb chunks
                if not chunk:
                    break
                bytes_left -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": "video/mp4",
        "Access-Control-Allow-Origin": "*",
    }
    
    return StreamingResponse(file_generator(), status_code=206, headers=headers)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:3000",
        "https://heatherhollybody.com",
        "https://www.heatherhollybody.com",
        "https://ilovetoridemybicycle.com",
        "https://www.ilovetoridemybicycle.com",
        "https://heather-holly-body.vercel.app",
        "https://heatherhollybody.vercel.app",
        "https://ai-labs.ipopenov.workers.dev",
    ],
    allow_origin_regex=r"https://.*\.(vercel\.app|workers\.dev|trycloudflare\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── File Size Limits ──────────────────────────────────────────────────────────
MAX_VIDEO_BYTES = 100 * 1024 * 1024   # 100 MB
MAX_IMAGE_BYTES = 10 * 1024 * 1024    # 10 MB


# ── Supabase Helper Utilities ─────────────────────────────────────────────────

async def _upload_to_supabase_storage(
    file_bytes: bytes,
    object_name: str,
    content_type: str = "video/mp4",
    exercise_type: str = None,
) -> str | None:
    """Upload processed video to cv-processed bucket. Returns signed URL (or local static fallback)."""
    # ── Local Debug Copy Interceptor ──
    # Uses content-addressed filenames (SHA-256 hash) so that re-uploading the
    # same video replaces the existing debug copy instead of accumulating duplicates.
    if SAVE_LOCAL_DEBUG_VIDEOS:
        try:
            # Traverses up from services/cv-engine/ to find project root /debug_videos/
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

            subfolder = exercise_type
            if not subfolder and "/" in object_name:
                subfolder = object_name.split("/")[0]
            if not subfolder:
                subfolder = "other"

            debug_folder = os.path.join(base_dir, "debug_videos", subfolder)
            os.makedirs(debug_folder, exist_ok=True)

            # Derive a stable, content-addressed filename from the video bytes.
            # SHA-256 of the full file → same content always → same filename → overwrite.
            content_hash = hashlib.sha256(file_bytes).hexdigest()[:24]
            ext = os.path.splitext(object_name)[1] or ".mp4"
            debug_filename = f"{content_hash}{ext}"
            debug_path = os.path.join(debug_folder, debug_filename)

            is_replacement = os.path.exists(debug_path)
            with open(debug_path, "wb") as f:
                f.write(file_bytes)
            action = "Replaced existing" if is_replacement else "Saved new"
            logger.info(f"[DEBUG] {action} debug video → {debug_path}")
        except Exception as exc:
            logger.error(f"Failed to save local debug copy of video: {exc}")

    if not supabase:
        try:
            # Fallback to local static file serving
            os.makedirs("static/processed", exist_ok=True)
            safe_name = object_name.replace("/", "_")
            local_path = f"static/processed/{safe_name}"
            with open(local_path, "wb") as f:
                f.write(file_bytes)
            logger.info(f"Supabase not configured — saved processed video locally to {local_path}")
            return f"/static/processed/{safe_name}"
        except Exception as exc:
            logger.error(f"Local static fallback save failed: {exc}")
            return None

    try:
        supabase.storage.from_("cv-processed").upload(
            object_name,
            file_bytes,
            {"content-type": content_type},
        )
        # Create 72-hour signed URL (3 days)
        signed = supabase.storage.from_("cv-processed").create_signed_url(
            object_name, expires_in=259200
        )
        return signed.get("signedURL")
    except Exception as exc:
        logger.error(f"Storage upload failed: {exc}")
        return None


async def _record_analysis(
    analysis_type: str,
    metadata: dict,
    processed_url: str | None,
    consent_token: str,
    user_id: str | None = None,
    email_hash: str | None = None,
) -> str | None:
    """Insert a non-biometric cv_analyses record. Returns record ID."""
    if not supabase:
        return None

    record = {
        "analysis_type": analysis_type,
        "status": "completed",
        "metadata": metadata,
        "processed_url": processed_url,
        "processed_expiry": (
            (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
            if processed_url else None
        ),
        "consent_token": consent_token,
        "retain_forever": True,
        "expires_at": None,
    }
    if user_id:
        record["user_id"] = user_id
    if email_hash:
        record["email_hash"] = email_hash

    try:
        resp = supabase.table("cv_analyses").insert(record).execute()
        return resp.data[0]["id"] if resp.data else None
    except Exception as exc:
        logger.error(f"DB insert failed: {exc}")
        return None


# ── Wrapped SlingShot processor (handles upload after processing) ─────────────

async def _process_slingshot_with_upload(payload: dict) -> dict:
    import asyncio
    loop = asyncio.get_event_loop()
    # process_slingshot is CPU-bound/blocking (OpenCV) — run in thread executor
    result = await loop.run_in_executor(None, process_slingshot, payload)

    video_bytes = result.pop("video_bytes", None)
    if video_bytes:
        try:
            object_name = f"slingshot/{hashlib.sha256(video_bytes[:1024]).hexdigest()[:16]}.mp4"
            signed_url = await _upload_to_supabase_storage(video_bytes, object_name)
            result["signed_url"] = signed_url
        except Exception as exc:
            logger.error(f"SlingShot upload failed: {exc}")
            result["signed_url"] = None

    return result


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/api/v1/analyze/form-ai")
async def analyze_form(
    file: UploadFile = File(...),
    exercise_type: str = Form("squat"),
    consent_token: str = Form(...),
    user_id: str = Form(None),
    overlay_mode: str = Form("full"),
    protocol: str = Form("opencv"),
    debug: bool = Form(False),
):
    """Submit a video for FormAI pose analysis."""
    # Feature 5: 'auto' triggers ExerciseClassifier in form_ai.py
    if exercise_type not in ("squat", "deadlift", "hip_thrust", "auto"):
        raise HTTPException(422, "exercise_type must be squat, deadlift, hip_thrust, or auto")
    if overlay_mode not in ("full", "minimal"):
        raise HTTPException(422, "overlay_mode must be 'full' or 'minimal'")
    if protocol not in ("opencv", "yolo", "dml"):
        raise HTTPException(422, "protocol must be 'opencv', 'yolo', or 'dml'")

    # Read into memory (never written to disk by this endpoint)
    video_bytes = await file.read()
    if len(video_bytes) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "File exceeds 100MB limit")

    try:
        job = await job_queue.submit("form_ai", {
            "video_bytes": video_bytes,
            "filename": file.filename,
            "exercise_type": exercise_type,
            "consent_token": consent_token,
            "user_id": user_id,
            "overlay_mode": overlay_mode,  # Feature 8
            "protocol": protocol,  # Dual protocol toggle
            "debug": debug,  # Debug telemetry toggle
        })
    except QueueFullError as exc:
        raise HTTPException(503, str(exc))

    return {
        "job_id": job.id,
        "status": "queued",
        "position": job.position_in_queue,
        "estimated_wait_seconds": job.position_in_queue * 30,
    }


@app.post("/api/v1/analyze/slingshot")
async def analyze_slingshot(
    file: UploadFile = File(...),
    email: str = Form(...),
    consent_token: str = Form(...),
):
    """Submit a video for SlingShot barbell tracking."""
    video_bytes = await file.read()
    if len(video_bytes) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "File exceeds 100MB limit")

    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()

    try:
        job = await job_queue.submit("slingshot", {
            "video_bytes": video_bytes,
            "filename": file.filename,
            "email_hash": email_hash,
            "consent_token": consent_token,
        })
    except QueueFullError as exc:
        raise HTTPException(503, str(exc))

    return {
        "job_id": job.id,
        "status": "queued",
        "position": job.position_in_queue,
        "estimated_wait_seconds": job.position_in_queue * 30,
    }


@app.post("/api/v1/analyze/smartfit")
async def analyze_smartfit(
    file: UploadFile = File(...),
    garment_types: str = Form("crop_top,leggings,hoodie,shorts"),
    consent_token: str = Form(...),
):
    """
    SmartFit sizing — processes synchronously (images are fast).
    Returns result immediately. NOT stored in database per plan spec.
    """
    image_bytes = await file.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "File exceeds 10MB limit")

    garments = [g.strip() for g in garment_types.split(",") if g.strip()]

    # SmartFit processes in the job queue to serialize GPU access
    try:
        job = await job_queue.submit("smartfit", {
            "image_bytes": image_bytes,
            "garment_types": garments,
        })
    except QueueFullError as exc:
        raise HTTPException(503, str(exc))

    return {
        "job_id": job.id,
        "status": "queued",
        "position": job.position_in_queue,
        "estimated_wait_seconds": job.position_in_queue * 15,
    }


@app.get("/api/v1/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Poll the status of a submitted job."""
    job = job_queue.get_status(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired")

    response: dict = {
        "job_id": job.id,
        "status": job.status,
        "created_at": job.created_at,
    }

    if job.status == "completed":
        result = job.result or {}

        # For FormAI: persist to DB and strip annotated bytes from response
        if job.payload.get("exercise_type"):
            metadata = result.get("metadata", {})
            signed_url = None

            annotated_bytes = result.get("annotated_video_bytes")
            if annotated_bytes:
                object_name = f"form-ai/{job.id}.mp4"
                signed_url = await _upload_to_supabase_storage(
                    annotated_bytes, 
                    object_name, 
                    exercise_type=job.payload.get("exercise_type")
                )

            analysis_id = await _record_analysis(
                "form_ai",
                metadata,
                signed_url,
                job.payload.get("consent_token", ""),
                user_id=job.payload.get("user_id"),
            )
            response["result"] = {
                "analysis_id": analysis_id,
                "signed_url": signed_url,
                "metadata": metadata,
                "processing_log": result.get("processing_log", {}),
            }
            # Include debug_timings if the processor returned them
            debug_timings = result.get("debug_timings")
            if debug_timings:
                response["result"]["debug_timings"] = debug_timings

        # For SlingShot
        elif "stats" in result or "signed_url" in result:
            stats = result.get("stats", {})
            signed_url = result.get("signed_url")

            analysis_id = await _record_analysis(
                "slingshot",
                {"duration_sec": stats.get("total_frames", 0) / 30, "tracking_type": "barbell"},
                signed_url,
                job.payload.get("consent_token", ""),
                email_hash=job.payload.get("email_hash"),
            )
            response["result"] = {
                "analysis_id": analysis_id,
                "signed_url": signed_url,
                "stats": stats,
            }

        # For SmartFit: return directly, NO DB record
        else:
            response["result"] = {k: v for k, v in result.items()
                                   if k != "processing_log"}

    elif job.status == "failed":
        response["error"] = job.error
    elif job.status == "queued":
        response["position"] = job.position_in_queue
        response["estimated_wait_seconds"] = job.position_in_queue * 30

    # Add Server-Timing header for lightweight client-side timing collection
    headers = {"Timing-Allow-Origin": "*"}
    if job.status == "completed" and job.started_at and job.completed_at:
        queue_ms = round((job.started_at - job.created_at) * 1000)
        process_ms = round((job.completed_at - job.started_at) * 1000)
        headers["Server-Timing"] = (
            f"queue;dur={queue_ms};desc=\"Queue Wait\","
            f"process;dur={process_ms};desc=\"Processing\""
        )
    return JSONResponse(content=response, headers=headers)


@app.patch("/api/v1/analyses/{analysis_id}/retention")
async def update_retention(analysis_id: str, retain_forever: bool):
    """Toggle video retention preference (user-controlled per-analysis)."""
    if not supabase:
        raise HTTPException(503, "Database not configured")

    update_data: dict
    if retain_forever:
        update_data = {"retain_forever": True, "expires_at": None}
    else:
        expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        update_data = {"retain_forever": False, "expires_at": expires}

    supabase.table("cv_analyses").update(update_data).eq("id", analysis_id).execute()
    return {"status": "updated", "retain_forever": retain_forever}


@app.delete("/api/v1/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str):
    """Immediately delete an analysis record and its storage object."""
    if not supabase:
        raise HTTPException(503, "Database not configured")

    row = supabase.table("cv_analyses").select("processed_url").eq("id", analysis_id).execute()
    if not row.data:
        raise HTTPException(404, "Analysis not found")

    processed_url = row.data[0].get("processed_url", "")
    if processed_url:
        # Extract object name from URL and delete from storage
        try:
            object_name = processed_url.split("/cv-processed/")[1].split("?")[0]
            supabase.storage.from_("cv-processed").remove([object_name])
        except Exception as exc:
            logger.warning(f"Storage delete failed: {exc}")

    supabase.table("cv_analyses").delete().eq("id", analysis_id).execute()
    return {"status": "deleted"}


@app.get("/")
async def root():
    """Root endpoint — confirms the CV engine is online."""
    return {
        "service": "HHB CV Engine",
        "version": "1.0.0",
        "status": "online",
        "docs": "/docs",
    }


@app.get("/api/v1/health")
async def health_check():
    """Health check — reports inference backend and queue depth."""
    import cv2

    return {
        "status": "healthy",
        "inference_backend": "opencv_dnn",
        "opencv_version": cv2.__version__,
        "opencv_opencl": cv2.ocl.haveOpenCL(),
        "queue_depth": job_queue.get_queue_depth(),
        "active_job": job_queue.active_job.id if job_queue.active_job else None,
        "supabase_connected": supabase is not None,
    }

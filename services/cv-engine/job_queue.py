"""
job_queue.py — Bounded Asyncio Job Queue
=====================================
Single-worker GPU-safe processing queue for the HHB CV Engine.

Design constraints:
  - Only ONE job processes at a time (GPU memory safety)
  - Queue depth capped at MAX_QUEUE_SIZE (prevent memory buildup)
  - Jobs auto-cancelled after TIMEOUT_SECONDS (5 min)
  - Completed jobs purged from memory after 1 hour
"""

import asyncio
import uuid
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Callable, Awaitable


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class QueueFullError(Exception):
    pass


@dataclass
class Job:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    analysis_type: str = ""
    payload: dict = field(default_factory=dict)
    status: JobStatus = JobStatus.QUEUED
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    position_in_queue: int = 0
    # ── Set after first completed poll to prevent duplicate DB inserts ──────
    db_written: bool = False
    cached_poll_result: Optional[dict] = None  # frozen response after first write


class CVJobQueue:
    """
    Bounded single-worker job queue for GPU-exclusive processing.

    Usage:
        queue = CVJobQueue()
        queue.register_processor("form_ai", my_async_fn)
        await queue.start_worker()

        job = await queue.submit("form_ai", {"video_bytes": ...})
        # Poll job.status until COMPLETED or FAILED
    """

    MAX_QUEUE_SIZE = 5
    TIMEOUT_SECONDS = 300  # 5 minutes max per job

    def __init__(self):
        self._queue: asyncio.Queue[Job] = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)
        self._active_job: Optional[Job] = None
        self._jobs: dict[str, Job] = {}
        self._worker_task: Optional[asyncio.Task] = None
        self._processors: dict[str, Callable[..., Awaitable[dict]]] = {}

    def register_processor(self, analysis_type: str, func: Callable):
        """Register an async processing function for an analysis type."""
        self._processors[analysis_type] = func

    async def start_worker(self):
        """Start the background worker task."""
        self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop_worker(self):
        """Gracefully stop the worker on shutdown."""
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

    async def submit(self, analysis_type: str, payload: dict) -> Job:
        """
        Submit a job. Returns immediately with Job (status=QUEUED).
        Raises QueueFullError if queue is at capacity.
        """
        if self._queue.full():
            raise QueueFullError(
                f"Processing queue is full ({self.MAX_QUEUE_SIZE} jobs). "
                "Please try again in a few minutes."
            )

        job = Job(
            analysis_type=analysis_type,
            payload=payload,
            position_in_queue=self._queue.qsize() + 1,
        )
        self._jobs[job.id] = job
        await self._queue.put(job)
        return job

    def get_status(self, job_id: str) -> Optional[Job]:
        """Return current status of a job by ID."""
        return self._jobs.get(job_id)

    def get_queue_depth(self) -> int:
        """Current number of pending jobs."""
        return self._queue.qsize()

    @property
    def active_job(self) -> Optional[Job]:
        return self._active_job

    async def _worker_loop(self):
        """Main loop — processes one job at a time sequentially."""
        while True:
            try:
                job = await self._queue.get()
                self._active_job = job
                job.status = JobStatus.PROCESSING
                job.started_at = time.time()

                processor = self._processors.get(job.analysis_type)
                if not processor:
                    job.status = JobStatus.FAILED
                    job.error = f"Unknown analysis type: {job.analysis_type}"
                    job.completed_at = time.time()
                    self._active_job = None
                    self._queue.task_done()
                    continue

                try:
                    result = await asyncio.wait_for(
                        processor(job.payload),
                        timeout=self.TIMEOUT_SECONDS,
                    )
                    job.status = JobStatus.COMPLETED
                    job.result = result

                except asyncio.TimeoutError:
                    job.status = JobStatus.FAILED
                    job.error = "Processing timed out (exceeded 5 minutes)"

                except Exception as exc:
                    job.status = JobStatus.FAILED
                    job.error = str(exc)

                finally:
                    job.completed_at = time.time()
                    self._active_job = None
                    self._queue.task_done()
                    self._cleanup_old_jobs()

            except asyncio.CancelledError:
                break

    def _cleanup_old_jobs(self):
        """Remove completed/failed jobs older than 1 hour from memory."""
        cutoff = time.time() - 3600
        stale = [
            jid
            for jid, job in self._jobs.items()
            if job.completed_at and job.completed_at < cutoff
        ]
        for jid in stale:
            del self._jobs[jid]

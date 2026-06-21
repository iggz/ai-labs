"""
server_info.py — Server Hardware Information Collector
=====================================================
Collects CPU, memory, GPU, and Python/OpenCV version info.
Results are cached after first call (hardware doesn't change at runtime).
"""

import os
import platform
import logging

logger = logging.getLogger(__name__)

_cached_info = None


def get_server_info(device: str = "unknown") -> dict:
    """Collect server hardware info. Cached after first call."""
    global _cached_info
    if _cached_info is not None:
        # Update device field in case it changed (e.g., model loaded on different backend)
        info = _cached_info.copy()
        info["device"] = device
        return info

    import cv2

    info = {
        "device": device,
        "cpu_model": platform.processor() or platform.machine() or "unknown",
        "python_version": platform.python_version(),
        "opencv_version": cv2.__version__,
        "opencv_opencl": cv2.ocl.haveOpenCL(),
        "cpu_cores": os.cpu_count(),
        "ram_gb": None,
        "gpu_model": None,
        "cuda_version": None,
        "os": f"{platform.system()} {platform.release()}",
    }

    # RAM detection (platform-dependent)
    try:
        if platform.system() == "Darwin":  # macOS
            import subprocess
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, timeout=5,
            )
            info["ram_gb"] = round(int(result.stdout.strip()) / (1024**3), 1)
        elif platform.system() == "Linux":
            info["ram_gb"] = round(
                os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / (1024**3), 1
            )
    except Exception as exc:
        logger.debug(f"RAM detection failed: {exc}")

    # GPU/CUDA detection
    try:
        import torch
        if torch.cuda.is_available():
            info["gpu_model"] = torch.cuda.get_device_name(0)
            info["cuda_version"] = torch.version.cuda
        elif torch.backends.mps.is_available():
            info["device"] = "mps"
            info["gpu_model"] = "Apple Silicon (MPS)"
    except ImportError:
        pass

    _cached_info = info
    return info

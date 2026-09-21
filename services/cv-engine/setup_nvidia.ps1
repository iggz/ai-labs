# HHB CV Engine - Windows NVIDIA GPU Setup (RTX 5090 / Blackwell sm_120)
# Requires: Python 3.10+, NVIDIA Driver 570+, CUDA Toolkit 12.8+

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " HHB CV Engine - NVIDIA RTX 5090 (Blackwell) Setup" -ForegroundColor Cyan
Write-Host " Requires: Python 3.10+, CUDA 12.8+, PyTorch 2.7.0+" -ForegroundColor Cyan
Write-Host " Acceleration: TensorRT / CUDA + NVENC (FFmpeg)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# -- 1. Create Python virtual environment --
if (-not (Test-Path ".venv")) {
    Write-Host ""
    Write-Host "-> Creating Python virtual environment at .venv..." -ForegroundColor Yellow
    python -m venv .venv
    Write-Host "  [OK] Virtual environment created" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[OK] Virtual environment already exists at .venv" -ForegroundColor Green
}

# -- 2. Activate virtual environment --
Write-Host ""
Write-Host "-> Activating virtual environment..." -ForegroundColor Yellow
.venv\Scripts\Activate.ps1

# -- 3. Upgrade pip and install core tools --
Write-Host ""
Write-Host "-> Upgrading pip, setuptools, and wheel..." -ForegroundColor Yellow
python -m pip install --upgrade pip setuptools wheel

# -- 4. Install PyTorch with CUDA 12.8 support (Required for sm_120) --
Write-Host ""
Write-Host "-> Installing PyTorch (CUDA 12.8+ build for RTX 5090)..." -ForegroundColor Yellow
# pip counts an existing CPU-only torch (e.g. 2.12.1+cpu from PyPI, newer than anything on cu128) as
# satisfying 'torch' and skips the CUDA build, so remove any torch that isn't a CUDA build first.
$torchCuda = python -c @"
try:
    import torch
    print(torch.version.cuda or '')
except ImportError:
    pass
"@
if (-not $torchCuda) {
    pip uninstall -y torch torchvision
}
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

# -- 5. Install remaining dependencies from requirements-nvidia.txt --
Write-Host ""
Write-Host "-> Installing dependencies from requirements-nvidia.txt..." -ForegroundColor Yellow
# onnxruntime / -directml / -gpu all ship the same 'onnxruntime' package and overwrite each other.
# A venv left over from setup_win.ps1 (AMD) has -directml, so remove it before installing -gpu.
pip uninstall -y onnxruntime onnxruntime-directml
pip install -r requirements-nvidia.txt

# -- 6. Verify CUDA and Architecture Support --
Write-Host ""
Write-Host "-> Verifying GPU & CUDA compute capability..." -ForegroundColor Yellow
python -c @"
import torch
print('PyTorch Version:', torch.__version__)
if torch.cuda.is_available():
    name = torch.cuda.get_device_name(0)
    cap = torch.cuda.get_device_capability(0)
    print(f'[OK] Found CUDA GPU: {name} (Compute Capability: sm_{cap[0]}{cap[1]})')
else:
    print('[WARNING] CUDA is not available. Please verify NVIDIA driver and CUDA installation.')
"@

# -- 7. Verify FFmpeg NVENC Hardware Encoder --
Write-Host ""
Write-Host "-> Verifying FFmpeg NVENC hardware encoders..." -ForegroundColor Yellow
python -c @"
import encoding_utils
print(f'Detected Encoders: {encoding_utils.AVAILABLE_ENCODERS}')
print(f'Selected Best Encoder: {encoding_utils.get_encoder()}')
if 'h264_nvenc' in encoding_utils.AVAILABLE_ENCODERS:
    print('[OK] NVIDIA NVENC hardware acceleration is active.')
else:
    print('[INFO] NVENC not listed in imageio-ffmpeg. System FFmpeg will be checked.')
"@

# -- 8. Export/Prepare YOLO Pose Models --
Write-Host ""
Write-Host "-> Checking pose models (YOLO11 / YOLOv8)..." -ForegroundColor Yellow
if (-not (Test-Path "yolo11x-pose.engine") -and -not (Test-Path "yolov8s-pose.onnx")) {
    Write-Host "Exporting baseline YOLOv8s-pose to ONNX..." -ForegroundColor Yellow
    python export_onnx.py
}
if (Test-Path "yolov8s-pose.onnx") {
    Write-Host "  [OK] yolov8s-pose.onnx ready" -ForegroundColor Green
}

# TensorRT FP16 engine for the 5090 (Ultralytics downloads yolo11x-pose.pt on first use).
# Engines are tied to GPU + TensorRT version — delete and re-run after driver/TensorRT upgrades.
if (-not (Test-Path "yolo11x-pose.engine")) {
    Write-Host "Exporting yolo11x-pose to TensorRT engine..." -ForegroundColor Yellow
    python export_tensorrt.py --model yolo11x-pose.pt --format engine --half
    # $ErrorActionPreference doesn't stop on a failing native command, and without the engine the
    # server quietly falls back to a slower model, so stop here instead of reporting success.
    if (-not (Test-Path "yolo11x-pose.engine")) {
        Write-Host "  [ERROR] TensorRT export failed - see the error above." -ForegroundColor Red
        exit 1
    }
}

# -- 9. Create tests package --
if (-not (Test-Path "tests")) {
    New-Item -ItemType Directory -Path "tests" | Out-Null
}
if (-not (Test-Path "tests\__init__.py")) {
    New-Item -ItemType File -Path "tests\__init__.py" | Out-Null
}

# -- 10. Create .env template if missing --
if (-not (Test-Path ".env")) {
    $envContent = @'
# HHB CV Engine Environment Variables (GamingPC)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
CLOUDFLARE_TUNNEL_URL=https://your-tunnel.trycloudflare.com
'@
    Set-Content -Path ".env" -Value $envContent
    Write-Host ""
    Write-Host "  [OK] .env template created" -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [OK] NVIDIA RTX 5090 Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host " To start the CV Engine:"
Write-Host "   cd services/cv-engine"
Write-Host "   .venv\Scripts\Activate.ps1"
Write-Host "   uvicorn main:app --host 0.0.0.0 --port 8080 --reload"
Write-Host ""
Write-Host " To run tests:"
Write-Host "   pytest tests/ -v --tb=short"
Write-Host "==========================================================" -ForegroundColor Green

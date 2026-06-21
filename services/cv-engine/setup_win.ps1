# HHB CV Engine - Windows AMD GPU Setup
# Requires: Python 3.10+

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " HHB CV Engine - Windows AMD GPU Setup" -ForegroundColor Cyan
Write-Host " Requires: Python 3.10+" -ForegroundColor Cyan
Write-Host " Acceleration: DirectML (ONNX) + AMF (FFmpeg)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

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

# -- 3. Upgrade pip and install core dependencies --
Write-Host ""
Write-Host "-> Upgrading pip and installing wheel..." -ForegroundColor Yellow
python -m pip install --upgrade pip wheel

Write-Host ""
Write-Host "-> Installing dependencies from requirements.txt..." -ForegroundColor Yellow
pip install -r requirements.txt

# -- 4. Install YOLOv8 & PyTorch once for model export --
Write-Host ""
Write-Host "-> Installing PyTorch and Ultralytics for ONNX export..." -ForegroundColor Yellow
pip install -r requirements-yolo.txt

# -- 5. Install imageio-ffmpeg --
Write-Host ""
Write-Host "-> Installing imageio-ffmpeg..." -ForegroundColor Yellow
pip install imageio-ffmpeg

# -- 6. Export YOLOv8 pose model to ONNX --
Write-Host ""
Write-Host "-> Fetching/Exporting YOLOv8-pose model weights to ONNX..." -ForegroundColor Yellow
if (-not (Test-Path "yolov8s-pose.onnx")) {
    python export_onnx.py
    Write-Host "  [OK] Model exported to yolov8s-pose.onnx" -ForegroundColor Green
} else {
    Write-Host "  [OK] yolov8s-pose.onnx already exists" -ForegroundColor Green
}

# -- 6.5. Ensure DirectML is installed (overriding any auto-installed CPU onnxruntime) --
Write-Host ""
Write-Host "-> Overriding CPU onnxruntime with onnxruntime-directml..." -ForegroundColor Yellow
pip uninstall -y onnxruntime
pip install --force-reinstall onnxruntime-directml

# -- 7. Create tests package --
if (-not (Test-Path "tests")) {
    New-Item -ItemType Directory -Path "tests" | Out-Null
}
if (-not (Test-Path "tests\__init__.py")) {
    New-Item -ItemType File -Path "tests\__init__.py" | Out-Null
}

# -- 8. Create .env template --
if (-not (Test-Path ".env")) {
    $envContent = @'
# HHB CV Engine Environment Variables
# Copy this to .env and fill in your values

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Cloudflare Tunnel URL (set after running `cloudflared tunnel create hhb-cv`)
CLOUDFLARE_TUNNEL_URL=https://your-tunnel.trycloudflare.com
'@
    Set-Content -Path ".env" -Value $envContent
    Write-Host ""
    Write-Host "  [OK] .env template created" -ForegroundColor Green
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " [OK] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host " To start the CV Engine:"
Write-Host "   cd services/cv-engine"
Write-Host "   .venv\Scripts\Activate.ps1"
Write-Host "   uvicorn main:app --host 0.0.0.0 --port 8080 --reload"
Write-Host ""
Write-Host " To run tests:"
Write-Host "   pytest tests/ -v --tb=short"
Write-Host "=============================================" -ForegroundColor Green

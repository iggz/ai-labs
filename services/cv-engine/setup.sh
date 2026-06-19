#!/bin/bash
# services/cv-engine/setup.sh — Native macOS setup for HHB CV Engine
# Requires: Python 3.10+, Homebrew, FFmpeg

set -e

echo "═══════════════════════════════════════════"
echo " HHB CV Engine — macOS Native Setup"
echo " Requires: Python 3.10+, Homebrew, FFmpeg"
echo " Apple Silicon M4 Pro (MPS GPU acceleration)"
echo "═══════════════════════════════════════════"

# ── 1. Install system dependencies ───────────────────────────────────────────
echo ""
echo "→ Checking FFmpeg installation..."
if command -v ffmpeg &> /dev/null; then
  echo "  ✓ FFmpeg already installed: $(ffmpeg -version 2>&1 | head -1)"
else
  echo "  Installing FFmpeg with VideoToolbox support..."
  brew install ffmpeg
fi

# Verify VideoToolbox hardware encoder
if ffmpeg -encoders 2>/dev/null | grep -q "h264_videotoolbox"; then
  echo "  ✓ h264_videotoolbox encoder available"
else
  echo "  ⚠  h264_videotoolbox not found — will fall back to libx264"
fi

# ── 2. Create Python virtual environment ─────────────────────────────────────
echo ""
echo "→ Creating Python virtual environment at .venv..."
/opt/homebrew/bin/python3.11 -m venv .venv
source .venv/bin/activate

# ── 3. Install PyTorch with MPS support (Apple Silicon) ──────────────────────
echo ""
echo "→ Upgrading pip and installing PyTorch with MPS backend..."
pip install --upgrade pip --quiet

# Install PyTorch — official Apple Silicon channel
pip install torch torchvision torchaudio --quiet

# Verify MPS availability
python3 -c "
import torch
assert torch.backends.mps.is_available(), 'MPS not available! Check macOS 12.3+ and Apple Silicon.'
assert torch.backends.mps.is_built(), 'PyTorch not compiled with MPS support!'
print('  ✓ MPS (Metal Performance Shaders) available')
print(f'  ✓ Device: {torch.device(\"mps\")}')
"

# ── 4. Install CV Engine dependencies ────────────────────────────────────────
echo ""
echo "→ Installing CV pipeline dependencies from requirements.txt..."
pip install -r requirements.txt --quiet
echo "  ✓ All dependencies installed"

# ── 5. Create tests package ──────────────────────────────────────────────────
mkdir -p tests
touch tests/__init__.py

# ── 6. Pre-download YOLOv8 model weights ─────────────────────────────────────
echo ""
echo "→ Pre-downloading YOLOv8 model weights (~22 MB each)..."
python3 -c "
from ultralytics import YOLO
YOLO('yolov8s-pose.pt')
YOLO('yolov8s-seg.pt')
print('  ✓ Model weights cached locally')
"

# ── 7. Create .env template ───────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cat > .env << 'ENVEOF'
# HHB CV Engine Environment Variables
# Copy this to .env and fill in your values

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Cloudflare Tunnel URL (set after running `cloudflared tunnel create hhb-cv`)
CLOUDFLARE_TUNNEL_URL=https://your-tunnel.trycloudflare.com
ENVEOF
  echo ""
  echo "  ✓ .env template created — fill in your Supabase credentials"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo " ✅ Setup complete!"
echo ""
echo " To start the CV Engine:"
echo "   cd services/cv-engine"
echo "   source .venv/bin/activate"
echo "   uvicorn main:app --host 0.0.0.0 --port 8080 --reload"
echo ""
echo " To expose via Cloudflare Tunnel:"
echo "   cloudflared tunnel --url http://localhost:8080"
echo ""
echo " To run tests:"
echo "   pytest tests/ -v --tb=short"
echo "═══════════════════════════════════════════"

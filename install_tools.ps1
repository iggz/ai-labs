# C:\dev\ai-labs\install_tools.ps1
# PowerShell script to automate Node.js and Cloudflare Wrangler installation on Windows.

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Node.js & Cloudflare Wrangler Setup" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# -- 1. Install Node.js LTS via winget --
Write-Host "`n-> Installing Node.js LTS via winget..." -ForegroundColor Yellow
try {
    # Check if winget is available
    Get-Command winget -ErrorAction Stop | Out-Null
    
    # Run winget installer
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Write-Host "  [OK] Node.js installer finished successfully!" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to run winget. Please download Node.js manually from: https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# -- 2. Refresh Path Environment Variable --
Write-Host "`n-> Refreshing environment PATH..." -ForegroundColor Yellow
try {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Write-Host "  [OK] Terminal PATH refreshed!" -ForegroundColor Green
} catch {
    Write-Host "  [WARNING] Could not refresh PATH dynamically. You may need to restart PowerShell." -ForegroundColor Yellow
}

# -- 3. Verify Node and npm --
Write-Host "`n-> Verifying installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node -v
    $npmVersion = npm -v
    Write-Host "  [OK] Node.js version: $nodeVersion" -ForegroundColor Green
    Write-Host "  [OK] npm version: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "  [WARNING] node/npm command not found in this session. Please close this terminal, open a new one, and re-run this script." -ForegroundColor Yellow
    exit 1
}

# -- 4. Install Wrangler globally --
Write-Host "`n-> Installing Cloudflare Wrangler globally..." -ForegroundColor Yellow
try {
    npm install -g wrangler
    Write-Host "  [OK] Cloudflare Wrangler installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to install Wrangler via npm." -ForegroundColor Red
    exit 1
}

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "  [OK] Node.js and Wrangler are installed!" -ForegroundColor Green
Write-Host ""
Write-Host " Next steps in your new terminal:"
Write-Host "   1. Run: wrangler login"
Write-Host "   2. Run: wrangler deploy"
Write-Host "=============================================" -ForegroundColor Green

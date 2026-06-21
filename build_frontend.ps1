# C:\dev\ai-labs\build_frontend.ps1
$ErrorActionPreference = "Stop"

Write-Host "-> Refreshing PATH..."
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

Write-Host "-> Navigating to web folder..."
cd C:\dev\ai-labs\web

Write-Host "-> Installing node modules..."
npm install

Write-Host "-> Building frontend..."
npm run build

Write-Host "-> Frontend build complete!" -ForegroundColor Green

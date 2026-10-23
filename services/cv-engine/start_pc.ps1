# Keeps the cv-engine server and the Cloudflare tunnel (api.ilovetoridemybicycle.com) running on the PC,
# restarting either if it exits. Started at sign-in by the "ai-labs cv-engine" scheduled task.
# The tunnel uses ~/.cloudflared/config.yml (tunnel hhb-cv-engine -> localhost:8080).
# uvicorn listens on loopback only: the tunnel is the one public way in, so the API isn't
# also reachable from the LAN without going through Cloudflare.

Set-Location $PSScriptRoot
$cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"

$server = $null
$tunnel = $null
while ($true) {
    if (-not $server -or $server.HasExited) {
        # keep the previous run's log so a crash can still be diagnosed
        if (Test-Path uvicorn_err.log) { Move-Item uvicorn_err.log uvicorn_err.prev.log -Force }
        $server = Start-Process .venv\Scripts\python.exe `
            -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8080" `
            -RedirectStandardOutput uvicorn_out.log -RedirectStandardError uvicorn_err.log `
            -WindowStyle Hidden -PassThru
    }
    if (-not $tunnel -or $tunnel.HasExited) {
        $tunnel = Start-Process $cloudflared `
            -ArgumentList "tunnel", "--logfile", "$env:USERPROFILE\.cloudflared\cloudflared.log", "run" `
            -WindowStyle Hidden -PassThru
    }
    Start-Sleep -Seconds 10
}

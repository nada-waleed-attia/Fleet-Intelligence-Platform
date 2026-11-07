# EDIT BY NADA - share only the isolated, fictional-data preview over HTTPS.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$shareDirectory = Join-Path $projectRoot 'tmp'
$tunnelExecutable = Join-Path $shareDirectory 'cloudflared.exe'
New-Item -ItemType Directory -Path $shareDirectory -Force | Out-Null

# EDIT BY NADA - keep the optional utility inside this workspace; no system install.
if (-not (Test-Path -LiteralPath $tunnelExecutable)) {
    & curl.exe -fL --connect-timeout 20 --max-time 300 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -o $tunnelExecutable
    if ($LASTEXITCODE -ne 0) { throw 'Could not download the official Cloudflare utility.' }
}

function Test-Preview {
    try {
        $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4174/' -Headers @{ Host = 'observer-preview.localhost:4174' } -TimeoutSec 3
        return ($page.StatusCode -eq 200 -and $page.Content.Contains('Observer Fleet') -and $page.Content.Contains('page-frame'))
    } catch { return $false }
}

if (-not (Test-Preview)) {
    $previewProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'preview/serve.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $shareDirectory 'preview-share-server.log') -RedirectStandardError (Join-Path $shareDirectory 'preview-share-server-error.log') -PassThru
    $previewDeadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Preview)) {
        if ($previewProcess.HasExited -or (Get-Date) -gt $previewDeadline) { throw 'The isolated preview could not start. See tmp/preview-share-server-error.log.' }
        Start-Sleep -Milliseconds 250
    }
}

# EDIT BY NADA - unique logs let multiple launches coexist; preserve the server host allowlist.
$runId = [Guid]::NewGuid().ToString('N')
$tunnelLog = Join-Path $shareDirectory "preview-tunnel-$runId.log"
$tunnelOutput = Join-Path $shareDirectory "preview-tunnel-$runId.out.log"
$tunnelProcess = Start-Process -FilePath $tunnelExecutable -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'quic', '--url', 'http://127.0.0.1:4174', '--http-host-header', 'observer-preview.localhost:4174') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelOutput -RedirectStandardError $tunnelLog -PassThru
$tunnelDeadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $tunnelDeadline) {
    if ($tunnelProcess.HasExited) { throw "The public tunnel stopped. See $tunnelLog" }
    $logText = Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue
    if ($logText -match 'Registered tunnel connection' -and $logText -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $shareUrl = $Matches[0] + '/?page=index.html'
        @{ url = $shareUrl; tunnelPid = $tunnelProcess.Id; log = $tunnelLog } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $shareDirectory 'preview-share-session.json') -Encoding UTF8
        Write-Output "Share this URL: $shareUrl"
        Write-Output 'Keep this computer awake and online. This temporary URL works while the tunnel is running.'
        Write-Output "Stop this tunnel: Stop-Process -Id $($tunnelProcess.Id)"
        return
    }
    Start-Sleep -Milliseconds 500
}
throw "The public URL is not ready. See $tunnelLog"

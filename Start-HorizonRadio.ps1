param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Continue"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublicDir = Join-Path $RootDir "public"
$Url = "http://127.0.0.1:$Port"

function Open-DesktopAppWindow($TargetUrl) {
    if ($NoBrowser) { return }
    $edgePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($ep in $edgePaths) {
        if (Test-Path $ep) {
            Start-Process $ep -ArgumentList "--app=$TargetUrl", "--window-size=1420,900"
            return
        }
    }
    Start-Process $TargetUrl
}

# Check if real Python is installed (ignoring Microsoft Store stub)
$PythonExe = $null
foreach ($cmd in @("python", "py")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found -and $found.Source -notmatch "WindowsApps") {
        $PythonExe = $found.Source
        break
    }
}

if ($PythonExe) {
    Write-Host "================================================================" -ForegroundColor Magenta
    Write-Host "  HORIZON PULSE RADIO - Launching Python Server ($PythonExe)" -ForegroundColor Cyan
    Write-Host "  Station URL: $Url" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Magenta
    Open-DesktopAppWindow $Url
    & $PythonExe (Join-Path $RootDir "server.py")
    exit 0
}

Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  HORIZON PULSE RADIO - Native .NET Studio Server" -ForegroundColor Cyan
Write-Host "  (Python not yet installed; running built-in .NET backend)" -ForegroundColor Gray
Write-Host "  Station URL: $Url" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Magenta

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")
$Listener.Prefixes.Add("http://localhost:$Port/")
$Listener.Start()

Open-DesktopAppWindow $Url

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".mp3"  = "audio/mpeg"
    ".wav"  = "audio/wav"
    ".ogg"  = "audio/ogg"
    ".flac" = "audio/flac"
    ".m4a"  = "audio/mp4"
}

function Send-JsonResponse($Response, $Obj, [int]$StatusCode = 200) {
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    $Response.AddHeader("Access-Control-Allow-Origin", "*")
    $json = ($Obj | ConvertTo-Json -Depth 10 -Compress)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

try {
    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        $Req = $Context.Request
        $Res = $Context.Response
        $Path = $Req.Url.AbsolutePath

        try {
            if ($Req.HttpMethod -eq "OPTIONS") {
                $Res.StatusCode = 204
                $Res.AddHeader("Access-Control-Allow-Origin", "*")
                $Res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                $Res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
                $Res.Close()
                continue
            }

            if ($Path -eq "/api/health") {
                Send-JsonResponse $Res @{
                    ok = $true
                    backend = "dotnet-host"
                    python_version = "none (install Python + nvidia-riva-client for local gRPC)"
                    riva_grpc_available = $false
                    mutagen_available = $false
                }
                continue
            }

            if ($Path -eq "/api/spotify/playlist-public") {
                $playlistId = $Req.QueryString["id"]
                if (-not $playlistId) {
                    Send-JsonResponse $Res @{ error = "Missing playlist id" } 400
                    continue
                }
                try {
                    $embedUrl = "https://open.spotify.com/embed/playlist/$playlistId"
                    $resp = Invoke-WebRequest -Uri $embedUrl -UseBasicParsing -Headers @{
                        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                    $html = $resp.Content
                    if ($html -match '<script id="__NEXT_DATA__" type="application/json">(.*?)</script>') {
                        $nextData = $Matches[1] | ConvertFrom-Json
                        $entity = $nextData.props.pageProps.state.data.entity
                        $pName = if ($entity.name) { $entity.name } else { "Spotify Playlist" }
                        $coverUrl = ""
                        if ($entity.coverArt -and $entity.coverArt.sources -and $entity.coverArt.sources.Count -gt 0) {
                            $coverUrl = $entity.coverArt.sources[0].url
                        }
                        $tracks = @()
                        $idx = 0
                        foreach ($item in $entity.trackList) {
                            $uri = [string]$item.uri
                            $tid = if ($uri -match ":") { ($uri -split ":")[-1] } else { "sp-$idx" }
                            $prevUrl = if ($item.audioPreview -and $item.audioPreview.url) { $item.audioPreview.url } else { "" }
                            $tracks += @{
                                id = $tid
                                uri = $uri
                                title = [string]$item.title
                                artist = ([string]$item.subtitle) -replace "\u00a0", " "
                                album = $pName
                                duration_ms = if ($item.duration) { [int]$item.duration } else { 200000 }
                                preview_url = $prevUrl
                                cover_url = $coverUrl
                                source = "spotify"
                            }
                            $idx++
                        }
                        Send-JsonResponse $Res @{
                            id = $playlistId
                            name = $pName
                            cover_url = $coverUrl
                            tracks = $tracks
                        }
                        continue
                    }
                    Send-JsonResponse $Res @{ error = "Could not parse Spotify embed data" } 502
                    continue
                } catch {
                    Send-JsonResponse $Res @{ error = $_.Exception.Message } 502
                    continue
                }
            }

            if ($Path -eq "/api/local/scan" -and $Req.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($Req.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                $targetPath = ([string]$body.path).Trim().Trim('"').Trim("'")
                if (-not (Test-Path $targetPath)) {
                    Send-JsonResponse $Res @{ ok = $false; error = "Path not found: $targetPath" } 400
                    continue
                }
                $audioExts = @(".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".webm")
                $files = @()
                $item = Get-Item $targetPath
                if ($item.PSIsContainer) {
                    $files = Get-ChildItem -Path $targetPath -Recurse -File -ErrorAction SilentlyContinue |
                        Where-Object { $audioExts -contains $_.Extension.ToLower() } |
                        Select-Object -First 400
                } elseif ($audioExts -contains $item.Extension.ToLower()) {
                    $files = @($item)
                }
                $tracks = @()
                foreach ($f in $files) {
                    $stem = $f.BaseName -replace "^\d{1,3}[\s._-]+", ""
                    $artist = "Unknown Artist"
                    $title = $stem
                    if ($stem -match "^(.*?)\s+-\s+(.*)$") {
                        $artist = $Matches[1].Trim()
                        $title = $Matches[2].Trim()
                    }
                    $tracks += @{
                        artist = $artist
                        title = $title
                        album = $f.Directory.Name
                        duration_ms = 210000
                        path = $f.FullName
                        size = $f.Length
                    }
                }
                Send-JsonResponse $Res @{ ok = $true; tracks = $tracks; count = $tracks.Count }
                continue
            }

            if ($Path -eq "/api/local/stream") {
                $fPath = $Req.QueryString["path"]
                if (-not $fPath -or -not (Test-Path $fPath)) {
                    Send-JsonResponse $Res @{ error = "Audio file not found" } 404
                    continue
                }
                $fileInfo = Get-Item $fPath
                $ext = $fileInfo.Extension.ToLower()
                $Res.ContentType = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { "audio/mpeg" }
                $Res.AddHeader("Access-Control-Allow-Origin", "*")
                $bytes = [System.IO.File]::ReadAllBytes($fileInfo.FullName)
                $Res.ContentLength64 = $bytes.Length
                $Res.OutputStream.Write($bytes, 0, $bytes.Length)
                $Res.Close()
                continue
            }

            if ($Path -eq "/api/llm/generate" -and $Req.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($Req.InputStream, [System.Text.Encoding]::UTF8)
                $payload = $reader.ReadToEnd() | ConvertFrom-Json
                $provider = if ($payload.provider) { $payload.provider } else { "nvidia_nim" }
                $apiKey = [string]$payload.apiKey
                $model = [string]$payload.model
                $sysPrompt = [string]$payload.systemPrompt
                $usrPrompt = [string]$payload.userPrompt
                $endpoint = [string]$payload.endpoint

                try {
                    if ($provider -eq "gemini") {
                        $m = if ($model) { $model } else { "gemini-2.5-flash" }
                        $u = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=$apiKey"
                        $reqObj = @{
                            systemInstruction = @{ parts = @(@{ text = $sysPrompt }) }
                            contents = @(@{ role = "user"; parts = @(@{ text = $usrPrompt }) })
                            generationConfig = @{ temperature = 0.85; maxOutputTokens = 240 }
                        } | ConvertTo-Json -Depth 8
                        $r = Invoke-RestMethod -Uri $u -Method Post -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes($reqObj))
                        $txt = $r.candidates[0].content.parts[0].text
                        Send-JsonResponse $Res @{ ok = $true; text = ([string]$txt).Trim() }
                        continue
                    } elseif ($provider -eq "ollama") {
                        $u = if ($endpoint) { $endpoint } else { "http://localhost:11434/api/chat" }
                        $reqObj = @{
                            model = if ($model) { $model } else { "llama3.1" }
                            stream = $false
                            messages = @(
                                @{ role = "system"; content = $sysPrompt },
                                @{ role = "user"; content = $usrPrompt }
                            )
                        } | ConvertTo-Json -Depth 6
                        $r = Invoke-RestMethod -Uri $u -Method Post -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes($reqObj))
                        Send-JsonResponse $Res @{ ok = $true; text = ([string]$r.message.content).Trim() }
                        continue
                    } else {
                        $u = if ($endpoint) { $endpoint } elseif ($provider -eq "nvidia_nim") { "https://integrate.api.nvidia.com/v1/chat/completions" } else { "https://api.openai.com/v1/chat/completions" }
                        $m = if ($model) { $model } elseif ($provider -eq "nvidia_nim") { "meta/llama-3.3-70b-instruct" } else { "gpt-4o-mini" }
                        $headers = @{}
                        if ($apiKey) { $headers["Authorization"] = "Bearer $apiKey" }
                        $reqObj = @{
                            model = $m
                            messages = @(
                                @{ role = "system"; content = $sysPrompt },
                                @{ role = "user"; content = $usrPrompt }
                            )
                            temperature = 0.85
                            max_tokens = 220
                        } | ConvertTo-Json -Depth 6
                        $r = Invoke-RestMethod -Uri $u -Method Post -Headers $headers -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes($reqObj))
                        Send-JsonResponse $Res @{ ok = $true; text = ([string]$r.choices[0].message.content).Trim() }
                        continue
                    }
                } catch {
                    Send-JsonResponse $Res @{ ok = $false; error = $_.Exception.Message } 500
                    continue
                }
            }

            if ($Path -eq "/api/tts/riva" -and $Req.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($Req.InputStream, [System.Text.Encoding]::UTF8)
                $payload = $reader.ReadToEnd() | ConvertFrom-Json
                $endpoint = if ($payload.endpoint) { [string]$payload.endpoint } else { "https://integrate.api.nvidia.com/v1/audio/synthesize" }
                $apiKey = [string]$payload.apiKey
                $text = [string]$payload.text
                $voice = if ($payload.voice) { [string]$payload.voice } else { "English-US.Female-1" }
                $lang = if ($payload.language) { [string]$payload.language } else { "en-US" }
                $model = if ($payload.model) { [string]$payload.model } else { "nvidia/magpie-tts-multilingual" }

                if ($payload.mode -eq "grpc") {
                    Send-JsonResponse $Res @{ error = "Local Riva gRPC requires Python + nvidia-riva-client. Switch Riva Mode to NVIDIA NIM / HTTP REST or install Python." } 400
                    continue
                }

                try {
                    $headers = @{ "Accept" = "audio/wav, application/octet-stream" }
                    if ($apiKey) { $headers["Authorization"] = "Bearer $apiKey" }
                    $reqBody = @{
                        text = $text
                        input = $text
                        voice = $voice
                        voice_name = $voice
                        language = $lang
                        language_code = $lang
                        model = $model
                        sample_rate_hz = 44100
                        response_format = "wav"
                    } | ConvertTo-Json -Depth 5
                    $resp = Invoke-WebRequest -Uri $endpoint -Method Post -Headers $headers -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes($reqBody)) -UseBasicParsing
                    $Res.StatusCode = 200
                    $Res.ContentType = "audio/wav"
                    $Res.AddHeader("Access-Control-Allow-Origin", "*")
                    $Res.ContentLength64 = $resp.RawContentLength
                    $Res.OutputStream.Write($resp.Content, 0, $resp.Content.Length)
                    $Res.Close()
                    continue
                } catch {
                    Send-JsonResponse $Res @{ error = $_.Exception.Message } 502
                    continue
                }
            }

            # Static File Serving
            if ($Path -eq "/" -or $Path -eq "/callback") { $Path = "/index.html" }
            $RelPath = $Path.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
            $FilePath = Join-Path $PublicDir $RelPath
            if (Test-Path $FilePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
                $Res.ContentType = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { "application/octet-stream" }
                $Res.AddHeader("Access-Control-Allow-Origin", "*")
                $bytes = [System.IO.File]::ReadAllBytes($FilePath)
                $Res.ContentLength64 = $bytes.Length
                $Res.OutputStream.Write($bytes, 0, $bytes.Length)
                $Res.Close()
            } else {
                $Res.StatusCode = 404
                $Res.Close()
            }
        } catch {
            try { $Res.StatusCode = 500; $Res.Close() } catch {}
        }
    }
} finally {
    $Listener.Stop()
}

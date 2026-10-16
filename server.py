#!/usr/bin/env python3
"""
Horizon Radio - Local Backend Server
Supports:
- NVIDIA Riva TTS (Local gRPC via nvidia-riva-client OR NVIDIA NIM HTTP REST API)
- NVIDIA NIM / Ollama / OpenAI / Gemini LLM proxy for Amy Simpson's DJ scripts
- Spotify Public Playlist Embed Parser & OAuth callback serving
- Local Playlist & Folder Scanner (.mp3, .flac, .wav, .ogg, .m4a, .m3u, .m3u8) with Range streaming
"""

import os
import sys
import json
import time
import struct
import urllib.request
import urllib.parse
import urllib.error
import mimetypes
import re
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

# Check optional local NVIDIA Riva gRPC client
RIVA_GRPC_AVAILABLE = False
try:
    import riva.client
    RIVA_GRPC_AVAILABLE = True
except ImportError:
    pass

# Check optional mutagen for deep ID3/FLAC tag parsing
MUTAGEN_AVAILABLE = False
try:
    import mutagen
    MUTAGEN_AVAILABLE = True
except ImportError:
    pass

PORT = int(os.environ.get("HORIZON_PORT", 8080))
PUBLIC_DIR = Path(__file__).parent / "public"
AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".webm"}
PLAYLIST_EXTENSIONS = {".m3u", ".m3u8", ".pls"}


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def parse_basic_filename_metadata(file_path: Path):
    """Fallback metadata parser from filename (e.g. '01 - Artist - Title.mp3' or 'Artist - Title.mp3')."""
    stem = file_path.stem
    # Strip leading track numbers like "01 - " or "01. "
    stem = re.sub(r"^\d{1,3}[\s._-]+", "", stem)
    if " - " in stem:
        parts = stem.split(" - ", 1)
        return {
            "artist": parts[0].strip(),
            "title": parts[1].strip(),
            "album": file_path.parent.name,
        }
    return {
        "artist": "Unknown Artist",
        "title": stem.strip(),
        "album": file_path.parent.name,
    }


def extract_track_metadata(file_path: Path):
    """Extract artist, title, album, duration from an audio file."""
    meta = parse_basic_filename_metadata(file_path)
    meta["duration_ms"] = 210000  # default 3:30 if unknown
    meta["path"] = str(file_path.resolve())
    meta["size"] = file_path.stat().st_size if file_path.exists() else 0

    if MUTAGEN_AVAILABLE:
        try:
            audio = mutagen.File(str(file_path), easy=True)
            if audio is not None:
                if audio.info and getattr(audio.info, "length", None):
                    meta["duration_ms"] = int(audio.info.length * 1000)
                if "title" in audio and audio["title"]:
                    meta["title"] = str(audio["title"][0])
                if "artist" in audio and audio["artist"]:
                    meta["artist"] = str(audio["artist"][0])
                if "album" in audio and audio["album"]:
                    meta["album"] = str(audio["album"][0])
                if "genre" in audio and audio["genre"]:
                    meta["genre"] = str(audio["genre"][0])
                if "date" in audio and audio["date"]:
                    meta["year"] = str(audio["date"][0])
        except Exception:
            pass
    return meta


def scan_local_source(target_path_str: str):
    """Scan a local directory or .m3u/.m3u8 file and return track entries."""
    target = Path(target_path_str.strip().strip('"').strip("'")).expanduser()
    if not target.exists():
        raise FileNotFoundError(f"Path not found: {target}")

    tracks = []
    if target.is_file():
        ext = target.suffix.lower()
        if ext in PLAYLIST_EXTENSIONS:
            base_dir = target.parent
            content = target.read_text(encoding="utf-8", errors="ignore")
            for line in content.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if ext == ".pls":
                    if not line.lower().startswith("file"):
                        continue
                    _, line = line.split("=", 1)
                    line = line.strip()
                candidate = Path(line)
                if not candidate.is_absolute():
                    candidate = (base_dir / candidate).resolve()
                if candidate.exists() and candidate.suffix.lower() in AUDIO_EXTENSIONS:
                    tracks.append(extract_track_metadata(candidate))
        elif ext in AUDIO_EXTENSIONS:
            tracks.append(extract_track_metadata(target))
    elif target.is_dir():
        for root, _, files in os.walk(target):
            for fname in sorted(files):
                fpath = Path(root) / fname
                if fpath.suffix.lower() in AUDIO_EXTENSIONS:
                    tracks.append(extract_track_metadata(fpath))
                    if len(tracks) >= 500:
                        break
            if len(tracks) >= 500:
                break

    return tracks


def synthesize_riva_grpc(text: str, server_url: str, voice_name: str, language_code: str, sample_rate: int = 44100):
    """Synthesize speech using local NVIDIA Riva gRPC server via nvidia-riva-client."""
    if not RIVA_GRPC_AVAILABLE:
        raise RuntimeError(
            "Python package 'nvidia-riva-client' is not installed. "
            "Install with: pip install nvidia-riva-client, or switch Riva Mode to NVIDIA NIM / HTTP REST."
        )
    host_port = server_url.replace("http://", "").replace("https://", "").split("/")[0]
    auth = riva.client.Auth(uri=host_port)
    tts_service = riva.client.SpeechSynthesisService(auth)
    resp = tts_service.synthesize(
        text=text,
        voice_name=voice_name or "English-US.Female-1",
        language_code=language_code or "en-US",
        sample_rate_hz=sample_rate,
    )
    pcm_bytes = resp.audio
    # Wrap raw 16-bit mono PCM into WAV container
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
    block_align = num_channels * (bits_per_sample // 8)
    data_size = len(pcm_bytes)
    wav_header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return wav_header + pcm_bytes


def synthesize_riva_http(payload: dict):
    """
    Synthesize speech via NVIDIA NIM Riva TTS HTTP API (Magpie-TTS / FastPitch)
    or an OpenAI-compatible / Local NIM Riva HTTP container.
    """
    text = payload.get("text", "").strip()
    endpoint = payload.get("endpoint", "https://integrate.api.nvidia.com/v1/audio/synthesize").strip()
    api_key = payload.get("apiKey", "").strip()
    voice = payload.get("voice", "English-US.Female-1").strip()
    language = payload.get("language", "en-US").strip()
    model = payload.get("model", "nvidia/magpie-tts-multilingual").strip()

    headers = {
        "Accept": "audio/wav, application/octet-stream, application/json",
        "User-Agent": "HorizonRadio/1.0",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Check if endpoint uses OpenAI-style /v1/audio/speech or NVIDIA NIM /v1/audio/synthesize
    if endpoint.endswith("/audio/speech"):
        body = json.dumps({
            "model": model or "tts-1-hd",
            "input": text,
            "voice": voice or "nova",
            "response_format": "wav",
        }).encode("utf-8")
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.read(), resp.headers.get("Content-Type", "audio/wav")

    # Try NVIDIA NIM Riva TTS multipart/form-data or JSON format
    boundary = f"----HorizonRadioBoundary{int(time.time() * 1000)}"
    fields = {
        "language": language,
        "voice": voice,
        "text": text,
        "sample_rate_hz": "44100",
        "encoding": "LINEAR_PCM",
    }
    lines = []
    for k, v in fields.items():
        lines.append(f"--{boundary}".encode("utf-8"))
        lines.append(f'Content-Disposition: form-data; name="{k}"'.encode("utf-8"))
        lines.append(b"")
        lines.append(str(v).encode("utf-8"))
    lines.append(f"--{boundary}--".encode("utf-8"))
    lines.append(b"")
    multipart_body = b"\r\n".join(lines)

    try:
        mp_headers = dict(headers)
        mp_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        req = urllib.request.Request(endpoint, data=multipart_body, headers=mp_headers, method="POST")
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.read(), resp.headers.get("Content-Type", "audio/wav")
    except urllib.error.HTTPError as e:
        # Fallback to JSON payload for local Riva HTTP bridges / NIM containers that expect JSON
        json_body = json.dumps({
            "text": text,
            "voice": voice,
            "voice_name": voice,
            "language": language,
            "language_code": language,
            "model": model,
            "sample_rate_hz": 44100,
        }).encode("utf-8")
        json_headers = dict(headers)
        json_headers["Content-Type"] = "application/json"
        req2 = urllib.request.Request(endpoint, data=json_body, headers=json_headers, method="POST")
        with urllib.request.urlopen(req2, timeout=25) as resp2:
            return resp2.read(), resp2.headers.get("Content-Type", "audio/wav")


def fetch_spotify_public_playlist(playlist_id: str):
    """
    Fetches public playlist metadata & tracklist from Spotify's public embed page
    so users can immediately load any public Spotify playlist URL even before OAuth!
    """
    embed_url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    req = urllib.request.Request(
        embed_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    # Look for __NEXT_DATA__ JSON inside the embed page
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not match:
        raise ValueError("Could not parse public playlist embed data from Spotify.")

    data = json.loads(match.group(1))
    entity = (
        data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("data", {})
        .get("entity", {})
    )
    if not entity:
        raise ValueError("Playlist entity not found in Spotify embed response.")

    playlist_name = entity.get("name") or entity.get("title") or "Spotify Playlist"
    cover_art = ""
    visual = entity.get("coverArt", {}).get("sources", [])
    if visual:
        cover_art = visual[0].get("url", "")

    track_list = entity.get("trackList", [])
    tracks = []
    for idx, item in enumerate(track_list):
        uri = item.get("uri", "")
        tid = uri.split(":")[-1] if ":" in uri else f"sp-{idx}"
        audio_preview = item.get("audioPreview", {}) or {}
        preview_url = audio_preview.get("url", "")
        tracks.append({
            "id": tid,
            "uri": uri,
            "title": item.get("title", "Unknown Track"),
            "artist": item.get("subtitle", "Unknown Artist").replace("\u00a0", " "),
            "album": playlist_name,
            "duration_ms": item.get("duration", 200000),
            "preview_url": preview_url,
            "cover_url": cover_art,
            "source": "spotify",
        })

    return {
        "id": playlist_id,
        "name": playlist_name,
        "cover_url": cover_art,
        "tracks": tracks,
    }


class HorizonRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Clean concise console logging
        sys.stdout.write(f"[HorizonRadio] {self.address_string()} - {fmt % args}\n")

    def send_json(self, data: dict, status: int = 200):
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            return self.send_json({
                "ok": True,
                "backend": "python",
                "python_version": sys.version.split()[0],
                "riva_grpc_available": RIVA_GRPC_AVAILABLE,
                "mutagen_available": MUTAGEN_AVAILABLE,
            })

        if path == "/api/config":
            cfg_path = Path(__file__).parent / "config.json"
            if cfg_path.exists():
                try:
                    return self.send_json(json.loads(cfg_path.read_text(encoding="utf-8")))
                except Exception:
                    pass
            return self.send_json({})

        if path == "/api/spotify/playlist-public":
            qs = urllib.parse.parse_qs(parsed.query)
            playlist_id = (qs.get("id") or [""])[0].strip()
            if not playlist_id:
                return self.send_json({"error": "Missing playlist id"}, 400)
            try:
                result = fetch_spotify_public_playlist(playlist_id)
                return self.send_json(result)
            except Exception as e:
                return self.send_json({"error": str(e)}, 502)

        if path == "/api/local/stream":
            qs = urllib.parse.parse_qs(parsed.query)
            file_path_str = (qs.get("path") or [""])[0]
            if not file_path_str:
                return self.send_json({"error": "Missing file path"}, 400)
            fpath = Path(file_path_str)
            if not fpath.exists() or not fpath.is_file():
                return self.send_json({"error": "Audio file not found"}, 404)
            return self.serve_audio_file_with_range(fpath)

        if path == "/callback" or path.startswith("/callback"):
            # Serve index.html so the SPA handles the Spotify OAuth PKCE code
            self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body_raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(body_raw.decode("utf-8"))
        except Exception:
            payload = {}

        if path == "/api/config":
            cfg_path = Path(__file__).parent / "config.json"
            existing = {}
            if cfg_path.exists():
                try:
                    existing = json.loads(cfg_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            existing.update(payload)
            cfg_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
            return self.send_json({"ok": True, "config": existing})

        if path == "/api/local/scan":
            folder_or_file = payload.get("path", "")
            try:
                tracks = scan_local_source(folder_or_file)
                return self.send_json({"ok": True, "tracks": tracks, "count": len(tracks)})
            except Exception as e:
                return self.send_json({"ok": False, "error": str(e)}, 400)

        if path == "/api/tts/riva":
            mode = payload.get("mode", "nim_http")  # 'grpc' or 'nim_http'
            text = payload.get("text", "").strip()
            if not text:
                return self.send_json({"error": "Missing text for TTS"}, 400)
            try:
                if mode == "grpc":
                    audio_bytes = synthesize_riva_grpc(
                        text=text,
                        server_url=payload.get("grpcUri", "localhost:50051"),
                        voice_name=payload.get("voice", "English-US.Female-1"),
                        language_code=payload.get("language", "en-US"),
                    )
                    content_type = "audio/wav"
                else:
                    audio_bytes, content_type = synthesize_riva_http(payload)

                self.send_response(200)
                self.send_header("Content-Type", content_type or "audio/wav")
                self.send_header("Content-Length", str(len(audio_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(audio_bytes)
                return
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="ignore")
                return self.send_json({"error": f"HTTP {he.code}: {err_body or he.reason}"}, he.code)
            except Exception as e:
                return self.send_json({"error": str(e)}, 500)

        if path == "/api/llm/generate":
            return self.handle_llm_proxy(payload)

        return self.send_json({"error": f"Unknown endpoint {path}"}, 404)

    def handle_llm_proxy(self, payload: dict):
        """Proxies LLM requests to NVIDIA NIM, Ollama, OpenAI, or Gemini without CORS issues."""
        provider = payload.get("provider", "nvidia_nim")
        api_key = payload.get("apiKey", "").strip()
        model = payload.get("model", "").strip()
        system_prompt = payload.get("systemPrompt", "")
        user_prompt = payload.get("userPrompt", "")
        endpoint = payload.get("endpoint", "").strip()

        try:
            if provider == "gemini":
                gem_model = model or "gemini-2.5-flash"
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{gem_model}:generateContent?key={api_key}"
                req_body = json.dumps({
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                    "generationConfig": {"temperature": 0.85, "maxOutputTokens": 240},
                }).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=req_body,
                    headers={"Content-Type": "application/json", "User-Agent": "HorizonRadio/1.0"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                text = candidates[0]["content"]["parts"][0]["text"] if candidates else ""
                return self.send_json({"ok": True, "text": text.strip()})

            elif provider == "ollama":
                url = endpoint or "http://localhost:11434/api/chat"
                req_body = json.dumps({
                    "model": model or "llama3.1",
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                }).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=req_body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                text = data.get("message", {}).get("content", "")
                return self.send_json({"ok": True, "text": text.strip()})

            else:
                # NVIDIA NIM (default) or OpenAI-compatible
                if provider == "nvidia_nim":
                    url = endpoint or "https://integrate.api.nvidia.com/v1/chat/completions"
                    chosen_model = model or "meta/llama-3.3-70b-instruct"
                else:
                    url = endpoint or "https://api.openai.com/v1/chat/completions"
                    chosen_model = model or "gpt-4o-mini"

                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "HorizonRadio/1.0",
                }
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"

                req_body = json.dumps({
                    "model": chosen_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.85,
                    "max_tokens": 220,
                }).encode("utf-8")
                req = urllib.request.Request(url, data=req_body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                choices = data.get("choices", [])
                text = choices[0]["message"]["content"] if choices else ""
                return self.send_json({"ok": True, "text": text.strip()})

        except urllib.error.HTTPError as he:
            err_text = he.read().decode("utf-8", errors="ignore")
            return self.send_json({"ok": False, "error": f"HTTP {he.code}: {err_text or he.reason}"}, he.code)
        except Exception as e:
            return self.send_json({"ok": False, "error": str(e)}, 500)

    def serve_audio_file_with_range(self, fpath: Path):
        """Streams local audio files with HTTP Range support for smooth seeking & crossfading."""
        file_size = fpath.stat().st_size
        mime_type, _ = mimetypes.guess_type(str(fpath))
        mime_type = mime_type or "audio/mpeg"

        range_header = self.headers.get("Range")
        start = 0
        end = file_size - 1
        status = 200

        if range_header and range_header.startswith("bytes="):
            status = 206
            parts = range_header.replace("bytes=", "").split("-")
            if parts[0]:
                start = int(parts[0])
            if len(parts) > 1 and parts[1]:
                end = int(parts[1])
            end = min(end, file_size - 1)

        content_length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", mime_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(fpath, "rb") as f:
            f.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)


def main():
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), HorizonRequestHandler)
    url = f"http://127.0.0.1:{PORT}"
    print("=" * 68)
    print("  HORIZON PULSE RADIO - LOCAL STUDIO SERVER")
    print(f"  Listening on: {url}")
    print(f"  NVIDIA Riva gRPC client installed: {RIVA_GRPC_AVAILABLE}")
    print("=" * 68)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Horizon Pulse Radio server...")
        server.server_close()


if __name__ == "__main__":
    main()

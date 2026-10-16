# Horizon Pulse 104.7 FM — Forza Horizon Style Radio Station

An interactive Forza Horizon "Horizon Pulse" radio station desktop/local server app hosted by **Amy Simpson**. Mixes any **Spotify Playlist** and **Local Playlist / Music Folder** into a continuous broadcast with automatic music ducking, outro-to-intro crossfading, and hyper-realistic **NVIDIA Riva TTS** voiceovers about the outgoing and upcoming artists and tracks.

---

## Quick Start

### Option 1: Instant One-Click Desktop Launch (Windows)
Double-click [`Start-HorizonRadio.bat`](Start-HorizonRadio.bat) or run:
```powershell
.\Start-HorizonRadio.ps1
```
- If Python is installed, it automatically runs [`server.py`](server.py).
- If Python is not installed yet, it runs the built-in native `.NET` local server on `http://127.0.0.1:8080` and opens the app in a standalone desktop window.

### Option 2: Python Server (with Local NVIDIA Riva gRPC Support)
```powershell
pip install -r requirements.txt
python server.py
```
Then open `http://127.0.0.1:8080`.

---

## Key Features

1. **Hyper-Realistic Amy Simpson TTS + Broadcast Studio DSP Chain**:
   - **NVIDIA Riva NIM API**: Supports `nvidia/magpie-tts-multilingual` & `nvidia/fastpitch-hifigan-tts` (`https://integrate.api.nvidia.com/v1/audio/synthesize` or local NIM container `http://localhost:9000/v1/audio/synthesize`).
   - **Local NVIDIA Riva gRPC**: Connects directly to `localhost:50051` via `nvidia-riva-client`.
   - **Studio FM Broadcast DSP**: Routes Amy's synthesized voice through a Web Audio 85 Hz high-pass filter, 215 Hz vocal warmth boost, 4.1 kHz presence boost, and 4.5:1 broadcast limiter so she cuts cleanly over the ducked music bed.
   - **Zero-Key Neural Fallback**: Automatically falls back to Windows/Edge Natural Neural voices (`Sonia Online Natural`, `Aria Online Natural`, `Jenny Online Natural`) if no Riva endpoint is active.

2. **Dynamic Artist & Track Commentary (NVIDIA NIM LLM + Offline Horizon Pulse Engine)**:
   - **NVIDIA NIM LLM (Preferred)**: Uses `meta/llama-3.3-70b-instruct` (or `nvidia/llama-3.1-nemotron-70b-instruct`), plus support for local **Ollama**, **OpenAI**, and **Google Gemini**.
   - **Offline Rich Dynamic Script Engine**: Built-in Forza Horizon Pulse script generator with artist trivia, festival driving scenarios, and **Skill Song (2X Multiplier)** announcements when offline or running without an API key.

3. **Hybrid Spotify + Local Playlist Mixing**:
   - **Spotify Integration**:
     - Paste **any public Spotify playlist URL** to load its tracks immediately (even before setting up OAuth!).
     - Connect **Spotify OAuth 2.0 PKCE** (Redirect URI: `http://127.0.0.1:8080/callback`) for full in-app **Spotify Web Playback SDK** streaming with automatic fallback to **Spotify Connect Remote Control API**.
   - **Local Playlists**:
     - Drag-and-drop audio files (`.mp3`, `.flac`, `.wav`, `.ogg`, `.m4a`), select a music folder, or scan any local directory / `.m3u8` playlist from disk.

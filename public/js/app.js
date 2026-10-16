/**
 * Horizon Pulse Radio - Main Studio Controller & UI State Manager (v2 Deluxe GUI)
 */

window.HorizonAppSettings = (function () {
  const STORAGE_KEY = "horizon_pulse_radio_settings_v1";
  const DEFAULTS = {
    // TTS Settings (NVIDIA Riva preferred)
    ttsProvider: "riva_nim", // 'riva_nim', 'riva_grpc', 'local_openai', 'elevenlabs', 'browser_neural'
    rivaEndpoint: "https://integrate.api.nvidia.com/v1/audio/synthesize",
    rivaGrpcUri: "localhost:50051",
    rivaApiKey: "",
    rivaVoice: "English-US.Female-1",
    rivaLanguage: "en-US",
    rivaModel: "nvidia/magpie-tts-multilingual",
    localTtsEndpoint: "http://localhost:8880/v1/audio/speech",
    localTtsVoice: "af_bella",
    elevenApiKey: "",
    elevenVoiceId: "EXAVITQu4vr4xnSDxMaL",
    browserVoiceName: "",
    speechRate: 1.02,
    speechPitch: 1.03,
    djVoiceGain: 1.15,

    // Script / LLM Settings (NVIDIA NIM preferred + Offline Engine fallback)
    scriptMode: "hybrid", // 'hybrid', 'llm_only', 'offline_only'
    llmProvider: "nvidia_nim", // 'nvidia_nim', 'ollama', 'openai', 'gemini'
    llmApiKey: "",
    llmModel: "meta/llama-3.3-70b-instruct",
    llmEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",

    // Mixer & Crossfade Settings
    enableAmyVoice: true,
    outroLeadSec: 10,
    musicDuckLevel: 0.22,
    spotifyClientId: localStorage.getItem("horizon_spotify_client_id") || "",
    spotifyPlaybackMode: "auto", // 'auto', 'sdk_only', 'remote_only'
    visualizerMode: "highway",
  };

  let current = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    current = { ...DEFAULTS, ...saved };
  } catch (_) {}

  function get() {
    return current;
  }

  function update(patch, persistToDisk = true) {
    current = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    if (patch.spotifyClientId !== undefined) {
      localStorage.setItem("horizon_spotify_client_id", patch.spotifyClientId);
    }
    if (persistToDisk) {
      fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nvidiaNimApiKey: current.rivaApiKey || current.llmApiKey || "",
          ttsProvider: current.ttsProvider,
          rivaEndpoint: current.rivaEndpoint,
          rivaGrpcUri: current.rivaGrpcUri,
          rivaVoice: current.rivaVoice,
          rivaModel: current.rivaModel,
          scriptMode: current.scriptMode,
          llmProvider: current.llmProvider,
          llmModel: current.llmModel,
          llmEndpoint: current.llmEndpoint,
          spotifyClientId: current.spotifyClientId,
          spotifyPlaybackMode: current.spotifyPlaybackMode,
          outroLeadSec: current.outroLeadSec,
          musicDuckLevel: current.musicDuckLevel,
          visualizerMode: current.visualizerMode,
        }),
      }).catch(() => {});
    }
    return current;
  }

  async function loadFromDiskConfig() {
    try {
      const resp = await fetch("/api/config");
      if (!resp.ok) return;
      const disk = await resp.json();
      const patch = {};
      if (disk.nvidiaNimApiKey) {
        patch.rivaApiKey = disk.nvidiaNimApiKey;
        patch.llmApiKey = disk.nvidiaNimApiKey;
      }
      if (disk.ttsProvider) patch.ttsProvider = disk.ttsProvider;
      if (disk.rivaEndpoint) patch.rivaEndpoint = disk.rivaEndpoint;
      if (disk.rivaGrpcUri) patch.rivaGrpcUri = disk.rivaGrpcUri;
      if (disk.rivaVoice) patch.rivaVoice = disk.rivaVoice;
      if (disk.rivaModel) patch.rivaModel = disk.rivaModel;
      if (disk.scriptMode) patch.scriptMode = disk.scriptMode;
      if (disk.llmProvider) patch.llmProvider = disk.llmProvider;
      if (disk.llmModel) patch.llmModel = disk.llmModel;
      if (disk.llmEndpoint) patch.llmEndpoint = disk.llmEndpoint;
      if (disk.spotifyClientId) patch.spotifyClientId = disk.spotifyClientId;
      if (disk.visualizerMode) patch.visualizerMode = disk.visualizerMode;
      update(patch, false);
    } catch (_) {}
  }

  return { get, update, loadFromDiskConfig };
})();

document.addEventListener("DOMContentLoaded", async () => {
  const el = (id) => document.getElementById(id);

  // Load config.json from disk first
  await window.HorizonAppSettings.loadFromDiskConfig();

  // Initialize Procedural Audio-Reactive Visualizer
  const initialVisMode = window.HorizonAppSettings.get().visualizerMode || "highway";
  window.HorizonProceduralVisualizer.init(el("spectrum-canvas"), initialVisMode);

  // Toast helper
  function showToast(message, type = "info") {
    const container = el("toast-container");
    if (!container) return;
    const item = document.createElement("div");
    item.className = `toast toast-${type}`;
    item.textContent = message;
    container.appendChild(item);
    setTimeout(() => {
      item.classList.add("toast-hide");
      setTimeout(() => item.remove(), 350);
    }, 4200);
  }

  function fmtTime(sec) {
    if (!sec || !isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function refreshNimBadge() {
    const s = window.HorizonAppSettings.get();
    const key = (s.rivaApiKey || s.llmApiKey || "").trim();
    const badge = el("nim-key-status-badge");
    const quickInput = el("quick-nim-api-key");
    if (quickInput && key && !quickInput.value) {
      quickInput.value = key;
    }
    if (badge) {
      if (key) {
        badge.textContent = "NVIDIA NIM: ACTIVE (RIVA + LLAMA 3.3)";
        badge.className = "status-chip badge-online";
      } else if (s.ttsProvider === "riva_grpc") {
        badge.textContent = `RIVA LOCAL gRPC (${s.rivaGrpcUri})`;
        badge.className = "status-chip badge-online";
      } else {
        badge.textContent = "NVIDIA NIM: OFFLINE FALLBACK READY";
        badge.className = "status-chip";
      }
    }
  }

  async function checkBackendHealth() {
    try {
      const resp = await fetch("/api/health");
      const data = await resp.json();
      const badge = el("backend-status-badge");
      if (badge && data.ok) {
        badge.textContent =
          data.backend === "python"
            ? `PYTHON SERVER (${data.riva_grpc_available ? "RIVA gRPC READY" : "NIM REST READY"})`
            : data.backend === "native-exe"
            ? "HORIZON RADIO .EXE ACTIVE"
            : "STUDIO SERVER ACTIVE";
        badge.classList.add("badge-online");
      }
    } catch (_) {}
  }

  function populateBrowserVoices() {
    if (!("speechSynthesis" in window)) return;
    const select = el("setting-browser-voice");
    if (!select) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    const currentPref = window.HorizonAppSettings.get().browserVoiceName;
    select.innerHTML = `<option value="">Auto-Select Best Natural Female Voice (Sonia / Aria / Jenny)</option>`;
    voices
      .filter((v) => v.lang.startsWith("en"))
      .forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.name === currentPref) opt.selected = true;
        select.appendChild(opt);
      });
  }

  if ("speechSynthesis" in window) {
    populateBrowserVoices();
    window.speechSynthesis.onvoiceschanged = populateBrowserVoices;
  }

  // Render Queue List
  function renderQueue(queue, currentIndex) {
    const listEl = el("queue-list");
    const countEl = el("queue-count-badge");
    if (!listEl) return;

    const spotifyCount = queue.filter((t) => t.source === "spotify").length;
    const localCount = queue.filter((t) => t.source !== "spotify").length;
    if (countEl) {
      countEl.textContent = `${queue.length} Tracks (${spotifyCount} Spotify • ${localCount} Local)`;
    }

    if (queue.length === 0) {
      listEl.innerHTML = `<div class="empty-queue">No tracks in rotation yet. Load a Spotify playlist or local folder!</div>`;
      return;
    }

    listEl.innerHTML = "";
    queue.forEach((track, idx) => {
      const row = document.createElement("div");
      const isCurrent = idx === currentIndex;
      const isNext = idx === (currentIndex + 1) % queue.length;
      row.className = `queue-item ${isCurrent ? "queue-item-active" : ""} ${isNext ? "queue-item-next" : ""}`;

      const badgeClass = track.source === "spotify" ? "source-badge-spotify" : "source-badge-local";
      const badgeLabel = track.source === "spotify" ? "SPOTIFY" : "LOCAL";

      row.innerHTML = `
        <div class="queue-idx">${isCurrent ? "▶" : idx + 1}</div>
        <div class="queue-info">
          <div class="queue-title">${track.title}</div>
          <div class="queue-artist">${track.artist} <span class="queue-album">• ${track.album || ""}</span></div>
        </div>
        <div class="queue-meta">
          ${isNext ? '<span class="up-next-pill">UP NEXT</span>' : ""}
          <span class="source-badge ${badgeClass}">${badgeLabel}</span>
          <span class="queue-dur">${fmtTime((track.duration_ms || 200000) / 1000)}</span>
        </div>
      `;

      row.addEventListener("click", () => {
        if (idx === currentIndex && window.HorizonRadioMixer.isPlaying()) return;
        window.HorizonRadioMixer.triggerRadioTransition({ reason: "queue_click", targetIndex: idx });
      });

      listEl.appendChild(row);
    });
  }

  // Subscribe to Mixer Events
  window.HorizonRadioMixer.on("onQueueChange", ({ queue, currentIndex }) => {
    renderQueue(queue, currentIndex);
  });

  window.HorizonRadioMixer.on("onTrackChange", ({ track, index }) => {
    if (!track) return;
    el("now-playing-title").textContent = track.title;
    el("now-playing-artist").textContent = track.artist;
    el("now-playing-album").textContent = track.album || "Horizon Pulse Rotation";

    if (el("vis-hud-track")) {
      el("vis-hud-track").textContent = `🎵 NOW PLAYING: ${track.artist} — ${track.title}`;
    }

    const srcBadge = el("now-playing-source");
    if (srcBadge) {
      srcBadge.textContent = track.source === "spotify" ? "SPOTIFY STREAM" : "LOCAL HI-FI AUDIO";
      srcBadge.className = `track-source-pill ${track.source === "spotify" ? "pill-spotify" : "pill-local"}`;
    }

    const artEl = el("now-playing-cover");
    if (artEl && track.cover_url) {
      artEl.style.backgroundImage = `url('${track.cover_url}')`;
    } else if (artEl) {
      artEl.style.backgroundImage = `linear-gradient(135deg, #ff1f8f 0%, #00e5ff 100%)`;
    }

    const vinylEl = el("turntable-disc");
    if (vinylEl) vinylEl.classList.add("spinning");

    const playBtn = el("btn-play-pause");
    if (playBtn) playBtn.innerHTML = `<span class="btn-icon">❚❚</span> PAUSE BROADCAST`;

    const nextTrack = window.HorizonRadioMixer.getNextTrack();
    if (nextTrack) {
      el("up-next-summary").textContent = `${nextTrack.artist} — ${nextTrack.title}`;
    }

    renderQueue(window.HorizonRadioMixer.getQueue(), index);
  });

  window.HorizonRadioMixer.on("onProgress", ({ currentSec, durationSec, remainingSec, percent }) => {
    el("time-current").textContent = fmtTime(currentSec);
    el("time-total").textContent = fmtTime(durationSec);
    el("time-remaining").textContent = `-${fmtTime(remainingSec)}`;
    const fill = el("progress-bar-fill");
    if (fill) fill.style.width = `${percent}%`;
  });

  window.HorizonRadioMixer.on("onDjStateChange", (state) => {
    const banner = el("amy-on-air-banner");
    const statusPill = el("amy-status-pill");
    const scriptBox = el("amy-live-script");
    const voiceEngineLabel = el("amy-voice-engine-label");
    const visHudAmy = el("vis-hud-amy");

    if (state.active) {
      banner?.classList.add("on-air-active");
      if (statusPill) {
        statusPill.textContent = state.phase === "speaking" ? "ON AIR • MIC LIVE (DUCKING MUSIC)" : "CUEING BOOTH MIC...";
        statusPill.className = "amy-mic-pill mic-live";
      }
      if (scriptBox && state.scriptText) {
        scriptBox.textContent = `"${state.scriptText}"`;
      }
      if (visHudAmy) {
        visHudAmy.textContent = `🎙️ AMY SIMPSON ON AIR (${state.voiceProvider || "Riva TTS"})`;
      }
      if (voiceEngineLabel) {
        voiceEngineLabel.textContent = `${state.voiceProvider || "NVIDIA Riva TTS"} • ${state.scriptSource || "Horizon AI"}`;
      }
    } else {
      banner?.classList.remove("on-air-active");
      if (statusPill) {
        statusPill.textContent = "STANDBY • MONITORING MIX";
        statusPill.className = "amy-mic-pill mic-standby";
      }
      if (visHudAmy) {
        visHudAmy.textContent = "🎙️ AMY SIMPSON • STANDBY";
      }
    }
  });

  window.HorizonRadioMixer.on("onPreCacheUpdate", (info) => {
    const cacheBadge = el("precache-status-badge");
    const scriptBox = el("amy-live-script");
    if (!cacheBadge) return;

    if (info.status === "generating") {
      cacheBadge.textContent = "WRITING NEXT DJ LINK...";
      cacheBadge.className = "precache-pill status-working";
    } else if (info.status === "synthesizing_voice") {
      cacheBadge.textContent = "SYNTHESIZING RIVA VOICE...";
      cacheBadge.className = "precache-pill status-working";
    } else if (info.status === "ready") {
      cacheBadge.textContent = `NEXT LINK READY (${info.voiceProvider || "TTS"})`;
      cacheBadge.className = "precache-pill status-ready";
      if (!window.HorizonTTSEngine.isCurrentlySpeaking() && scriptBox && info.scriptText) {
        scriptBox.textContent = `[Up Next Preview]: "${info.scriptText}"`;
      }
    }
  });

  // Skill Song Multiplier HUD
  let skillScoreTimer = null;
  let currentSkillScore = 0;
  window.HorizonRadioMixer.on("onSkillSongState", ({ active }) => {
    const hud = el("skill-song-hud");
    const scoreEl = el("skill-song-score");
    clearInterval(skillScoreTimer);
    if (active) {
      hud?.classList.remove("hidden");
      currentSkillScore = 1000;
      skillScoreTimer = setInterval(() => {
        if (!window.HorizonRadioMixer.isPlaying()) return;
        currentSkillScore += Math.floor(250 + Math.random() * 650);
        if (scoreEl) scoreEl.textContent = `${currentSkillScore.toLocaleString()} x 10.0`;
      }, 450);
    } else {
      hud?.classList.add("hidden");
    }
  });

  // Load Starter Festival Mix immediately
  const starterTracks = window.LocalPlaylistManager.createStarterFestivalTracks();
  window.HorizonRadioMixer.setQueue(starterTracks);
  window.HorizonRadioMixer.preCacheNextTransition();

  // Wire Procedural Visualizer Mode Pills & Theater HUD
  document.querySelectorAll("[data-vis-mode]").forEach((btn) => {
    if (btn.getAttribute("data-vis-mode") === initialVisMode) {
      document.querySelectorAll("[data-vis-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      const m = btn.getAttribute("data-vis-mode");
      document.querySelectorAll("[data-vis-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      window.HorizonProceduralVisualizer.setMode(m);
      window.HorizonAppSettings.update({ visualizerMode: m });
    });
  });

  el("btn-toggle-theater")?.addEventListener("click", () => {
    const stage = el("visualizer-stage");
    const btn = el("btn-toggle-theater");
    if (!stage) return;
    stage.classList.toggle("theater-mode");
    const isTheater = stage.classList.contains("theater-mode");
    if (btn) btn.textContent = isTheater ? "✕ EXIT THEATER HUD" : "⛶ THEATER HUD";
    setTimeout(() => window.HorizonProceduralVisualizer.resizeCanvas(), 60);
  });

  // Wire Quick NVIDIA NIM API Key Bar
  el("btn-save-quick-nim")?.addEventListener("click", () => {
    const key = el("quick-nim-api-key")?.value.trim() || "";
    if (!key) {
      showToast("Paste your NVIDIA NIM API key (starts with nvapi-...) first!", "error");
      return;
    }
    window.HorizonAppSettings.update({
      rivaApiKey: key,
      llmApiKey: key,
      ttsProvider: "riva_nim",
      llmProvider: "nvidia_nim",
    });
    syncSettingsToForm();
    refreshNimBadge();
    window.HorizonRadioMixer.preCacheNextTransition(true);
    showToast("NVIDIA NIM API Key saved to config.json & activated for Riva TTS + Llama 3.3!", "success");
  });

  // Handle Spotify OAuth callback
  try {
    const didAuth = await window.SpotifyManager.handleOAuthCallbackIfPresent();
    if (didAuth) {
      showToast("Connected to Spotify! Web Playback SDK & Playlist Sync active.", "success");
    }
  } catch (err) {
    showToast(err.message, "error");
  }

  window.SpotifyManager.onStatusChange((st) => {
    const spBadge = el("spotify-connection-status");
    if (spBadge) {
      spBadge.textContent = st.connected ? `SPOTIFY: ${st.mode}` : "SPOTIFY: PUBLIC / PREVIEW MODE";
      spBadge.className = `status-chip ${st.connected ? "chip-connected" : ""}`;
    }
  });

  // Wire Transport Controls
  el("btn-play-pause")?.addEventListener("click", () => {
    const nowPlaying = window.HorizonRadioMixer.togglePlayPause();
    const playBtn = el("btn-play-pause");
    const vinylEl = el("turntable-disc");
    if (nowPlaying) {
      if (playBtn) playBtn.innerHTML = `<span class="btn-icon">❚❚</span> PAUSE BROADCAST`;
      vinylEl?.classList.add("spinning");
    } else {
      if (playBtn) playBtn.innerHTML = `<span class="btn-icon">▶</span> START BROADCAST`;
      vinylEl?.classList.remove("spinning");
    }
  });

  el("btn-dj-transition-now")?.addEventListener("click", () => {
    window.HorizonRadioMixer.triggerRadioTransition({ reason: "manual_button" });
  });

  el("btn-shuffle-queue")?.addEventListener("click", () => {
    window.HorizonRadioMixer.shuffleRemainingQueue();
    showToast("Horizon Pulse queue shuffled! Amy is updating her next intro.", "info");
  });

  el("btn-trigger-skill-song")?.addEventListener("click", () => {
    window.HorizonRadioMixer.queueSkillSongNext();
    showToast("Skill Song armed! Amy Simpson will announce 2X Skill Multiplier on the next transition!", "success");
  });

  el("master-volume-slider")?.addEventListener("input", (e) => {
    window.HorizonRadioMixer.setMasterVolume(e.target.value);
  });

  el("progress-bar-track")?.addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    window.HorizonRadioMixer.seekToPercent(pct);
  });

  // Wire Spotify Playlist Loader
  async function loadSpotifyUrlInput(urlOrId) {
    const btn = el("btn-load-spotify-playlist");
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "LOADING...";
      }
      const pl = await window.SpotifyManager.fetchPlaylist(urlOrId);
      const replaceMode = el("chk-replace-queue")?.checked || false;
      if (replaceMode) {
        window.HorizonRadioMixer.setQueue(pl.tracks, { shuffle: false });
      } else {
        window.HorizonRadioMixer.appendTracksToQueue(pl.tracks, { interleaveMix: true });
      }
      showToast(
        `Loaded "${pl.name}" (${pl.tracks.length} tracks via ${pl.loadedVia}) into Horizon Pulse rotation!`,
        "success"
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "ADD SPOTIFY PLAYLIST";
      }
    }
  }

  el("btn-load-spotify-playlist")?.addEventListener("click", () => {
    const val = el("input-spotify-playlist")?.value || "";
    loadSpotifyUrlInput(val);
  });

  document.querySelectorAll("[data-spotify-preset]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const pid = chip.getAttribute("data-spotify-preset");
      const input = el("input-spotify-playlist");
      if (input) input.value = `https://open.spotify.com/playlist/${pid}`;
      loadSpotifyUrlInput(pid);
    });
  });

  el("btn-spotify-oauth")?.addEventListener("click", async () => {
    const clientId =
      el("setting-spotify-client-id")?.value.trim() || window.HorizonAppSettings.get().spotifyClientId;
    if (!clientId) {
      el("settings-modal")?.classList.remove("hidden");
      el("setting-spotify-client-id")?.focus();
      showToast("Enter your Spotify Developer Client ID to connect OAuth PKCE (or paste any public playlist link directly!).", "info");
      return;
    }
    try {
      await window.SpotifyManager.startOAuthPKCE(clientId);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Wire Local Audio Files / Folder / Path Scanner
  el("input-local-files")?.addEventListener("change", async (e) => {
    const tracks = await window.LocalPlaylistManager.ingestBrowserFiles(e.target.files);
    if (tracks.length > 0) {
      const replaceMode = el("chk-replace-queue")?.checked || false;
      if (replaceMode) {
        window.HorizonRadioMixer.setQueue(tracks);
      } else {
        window.HorizonRadioMixer.appendTracksToQueue(tracks, { interleaveMix: true });
      }
      showToast(`Added ${tracks.length} local audio tracks & mixed with current queue!`, "success");
    }
  });

  el("input-local-folder")?.addEventListener("change", async (e) => {
    const tracks = await window.LocalPlaylistManager.ingestBrowserFiles(e.target.files);
    if (tracks.length > 0) {
      const replaceMode = el("chk-replace-queue")?.checked || false;
      if (replaceMode) {
        window.HorizonRadioMixer.setQueue(tracks);
      } else {
        window.HorizonRadioMixer.appendTracksToQueue(tracks, { interleaveMix: true });
      }
      showToast(`Imported ${tracks.length} tracks from folder into Horizon Pulse rotation!`, "success");
    }
  });

  el("btn-scan-local-path")?.addEventListener("click", async () => {
    const pathStr = el("input-local-path")?.value.trim();
    if (!pathStr) {
      showToast("Enter a folder path (e.g. C:\\Users\\reala\\Music) or .m3u8 playlist path.", "info");
      return;
    }
    try {
      const tracks = await window.LocalPlaylistManager.scanLocalFolderOrPlaylist(pathStr);
      if (tracks.length === 0) {
        showToast("No supported audio files (.mp3, .flac, .wav, .m4a, .ogg) found in that path.", "info");
        return;
      }
      const replaceMode = el("chk-replace-queue")?.checked || false;
      if (replaceMode) {
        window.HorizonRadioMixer.setQueue(tracks);
      } else {
        window.HorizonRadioMixer.appendTracksToQueue(tracks, { interleaveMix: true });
      }
      showToast(`Scanned & mixed ${tracks.length} local tracks from disk!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Drag & Drop support
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      const tracks = await window.LocalPlaylistManager.ingestBrowserFiles(e.dataTransfer.files);
      if (tracks.length > 0) {
        window.HorizonRadioMixer.appendTracksToQueue(tracks, { interleaveMix: true });
        showToast(`Dropped ${tracks.length} local tracks into the Horizon Pulse mix!`, "success");
      }
    }
  });

  // Settings Modal Wiring
  function syncSettingsToForm() {
    const s = window.HorizonAppSettings.get();
    if (el("setting-tts-provider")) el("setting-tts-provider").value = s.ttsProvider;
    if (el("setting-riva-endpoint")) el("setting-riva-endpoint").value = s.rivaEndpoint;
    if (el("setting-riva-grpc")) el("setting-riva-grpc").value = s.rivaGrpcUri;
    if (el("setting-riva-api-key")) el("setting-riva-api-key").value = s.rivaApiKey;
    if (el("setting-riva-voice")) el("setting-riva-voice").value = s.rivaVoice;
    if (el("setting-riva-model")) el("setting-riva-model").value = s.rivaModel;
    if (el("setting-local-tts-endpoint")) el("setting-local-tts-endpoint").value = s.localTtsEndpoint;
    if (el("setting-eleven-api-key")) el("setting-eleven-api-key").value = s.elevenApiKey;
    if (el("setting-eleven-voice-id")) el("setting-eleven-voice-id").value = s.elevenVoiceId;

    if (el("setting-script-mode")) el("setting-script-mode").value = s.scriptMode;
    if (el("setting-llm-provider")) el("setting-llm-provider").value = s.llmProvider;
    if (el("setting-llm-api-key")) el("setting-llm-api-key").value = s.llmApiKey;
    if (el("setting-llm-model")) el("setting-llm-model").value = s.llmModel;
    if (el("setting-llm-endpoint")) el("setting-llm-endpoint").value = s.llmEndpoint;

    if (el("setting-outro-lead")) el("setting-outro-lead").value = s.outroLeadSec;
    if (el("setting-duck-level")) el("setting-duck-level").value = Math.round(s.musicDuckLevel * 100);
    if (el("setting-spotify-client-id")) el("setting-spotify-client-id").value = s.spotifyClientId;
    if (el("setting-spotify-mode")) el("setting-spotify-mode").value = s.spotifyPlaybackMode;

    if (el("quick-nim-api-key") && (s.rivaApiKey || s.llmApiKey)) {
      el("quick-nim-api-key").value = s.rivaApiKey || s.llmApiKey;
    }
    refreshNimBadge();
  }

  function saveFormToSettings() {
    const patch = {
      ttsProvider: el("setting-tts-provider")?.value || "riva_nim",
      rivaEndpoint: el("setting-riva-endpoint")?.value.trim() || "https://integrate.api.nvidia.com/v1/audio/synthesize",
      rivaGrpcUri: el("setting-riva-grpc")?.value.trim() || "localhost:50051",
      rivaApiKey: el("setting-riva-api-key")?.value.trim() || el("quick-nim-api-key")?.value.trim() || "",
      rivaVoice: el("setting-riva-voice")?.value.trim() || "English-US.Female-1",
      rivaModel: el("setting-riva-model")?.value.trim() || "nvidia/magpie-tts-multilingual",
      localTtsEndpoint: el("setting-local-tts-endpoint")?.value.trim() || "http://localhost:8880/v1/audio/speech",
      elevenApiKey: el("setting-eleven-api-key")?.value.trim() || "",
      elevenVoiceId: el("setting-eleven-voice-id")?.value.trim() || "EXAVITQu4vr4xnSDxMaL",
      browserVoiceName: el("setting-browser-voice")?.value || "",

      scriptMode: el("setting-script-mode")?.value || "hybrid",
      llmProvider: el("setting-llm-provider")?.value || "nvidia_nim",
      llmApiKey: el("setting-llm-api-key")?.value.trim() || el("quick-nim-api-key")?.value.trim() || "",
      llmModel: el("setting-llm-model")?.value.trim() || "meta/llama-3.3-70b-instruct",
      llmEndpoint: el("setting-llm-endpoint")?.value.trim() || "https://integrate.api.nvidia.com/v1/chat/completions",

      outroLeadSec: parseFloat(el("setting-outro-lead")?.value || 10),
      musicDuckLevel: Math.max(0.05, Math.min(0.6, parseFloat(el("setting-duck-level")?.value || 22) / 100)),
      spotifyClientId: el("setting-spotify-client-id")?.value.trim() || "",
      spotifyPlaybackMode: el("setting-spotify-mode")?.value || "auto",
    };

    if (patch.llmApiKey && !patch.rivaApiKey && patch.llmProvider === "nvidia_nim") {
      patch.rivaApiKey = patch.llmApiKey;
    } else if (patch.rivaApiKey && !patch.llmApiKey && patch.llmProvider === "nvidia_nim") {
      patch.llmApiKey = patch.rivaApiKey;
    }

    window.HorizonAppSettings.update(patch);
    syncSettingsToForm();
    window.HorizonRadioMixer.preCacheNextTransition(true);
    showToast("Studio settings saved to config.json! Re-cueing Amy Simpson's next segment.", "success");
  }

  el("btn-open-settings")?.addEventListener("click", () => {
    syncSettingsToForm();
    el("settings-modal")?.classList.remove("hidden");
  });

  el("btn-close-settings")?.addEventListener("click", () => {
    el("settings-modal")?.classList.add("hidden");
  });

  el("btn-save-settings")?.addEventListener("click", () => {
    saveFormToSettings();
    el("settings-modal")?.classList.add("hidden");
  });

  async function testAmyVoiceSample() {
    const quickVal = el("quick-nim-api-key")?.value.trim();
    if (quickVal) {
      window.HorizonAppSettings.update({ rivaApiKey: quickVal, llmApiKey: quickVal });
      refreshNimBadge();
    }
    const settings = window.HorizonAppSettings.get();
    const cur = window.HorizonRadioMixer.getCurrentTrack();
    const nxt = window.HorizonRadioMixer.getNextTrack();
    showToast("Generating & synthesizing Amy Simpson voice preview...", "info");

    const scriptRes = await window.AmyScriptEngine.generateScript({
      prevTrack: cur,
      nextTrack: nxt,
      settings,
    });

    const clip = await window.HorizonTTSEngine.synthesizeToBuffer(scriptRes.text, settings);
    el("amy-live-script").textContent = `"${scriptRes.text}"`;
    el("amy-voice-engine-label").textContent = `${clip.providerLabel} • ${scriptRes.source}`;
    el("amy-on-air-banner")?.classList.add("on-air-active");

    await window.HorizonTTSEngine.playClip(clip, settings, {
      onEnd: () => {
        el("amy-on-air-banner")?.classList.remove("on-air-active");
      },
    });
  }

  el("btn-test-amy-voice")?.addEventListener("click", testAmyVoiceSample);
  el("btn-audition-amy-booth")?.addEventListener("click", testAmyVoiceSample);
  el("btn-quick-test-voice")?.addEventListener("click", testAmyVoiceSample);

  checkBackendHealth();
  syncSettingsToForm();
});

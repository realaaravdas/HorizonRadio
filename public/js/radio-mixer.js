/**
 * Horizon Pulse Radio - Dual-Deck Auto-DJ Crossfader & Ducking Engine
 * Orchestrates:
 * - Dual Web Audio Decks (Deck A & Deck B) with independent Gain + Low-Pass Ducking Filters
 * - Hybrid Spotify Web Playback SDK / Remote Control / Preview Stream mixing
 * - Background pre-generation & pre-synthesis of Amy Simpson's next DJ voiceover
 * - Authentic Forza Horizon Outro -> DJ Voiceover + Crossfade -> Intro Swell sequence
 */

window.HorizonRadioMixer = (function () {
  let audioCtx = null;
  let masterAnalyser = null;
  let masterGain = null;

  // Two Web Audio decks for seamless overlap crossfading
  const decks = {
    A: createDeckObject("A"),
    B: createDeckObject("B"),
  };
  let activeDeckKey = "A";

  // Radio State
  let queue = [];
  let currentIndex = -1;
  let isPlaying = false;
  let isTransitioning = false;
  let activePlaybackMode = "web_audio"; // 'web_audio' | 'spotify_sdk' | 'spotify_remote'
  let spotifyTrackTimer = null;
  let spotifyElapsedMs = 0;
  let spotifyDurationMs = 200000;

  // Pre-cached next DJ segment
  let preCachedSegment = null;
  let isPreCaching = false;
  let nextIsSkillSong = false;

  // Event listeners for UI
  const listeners = {
    onTrackChange: [],
    onProgress: [],
    onDjStateChange: [],
    onQueueChange: [],
    onPreCacheUpdate: [],
    onSkillSongState: [],
  };

  function on(event, cb) {
    if (listeners[event]) listeners[event].push(cb);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[HorizonRadioMixer] Listener error (${event}):`, e);
      }
    });
  }

  function createDeckObject(id) {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    return {
      id,
      audio,
      sourceNode: null,
      gainNode: null,
      filterNode: null,
      currentVolume: 1.0,
    };
  }

  function ensureAudioGraph() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();

      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1.0;

      masterAnalyser = audioCtx.createAnalyser();
      masterAnalyser.fftSize = 128;
      masterAnalyser.smoothingTimeConstant = 0.8;

      masterGain.connect(masterAnalyser);
      masterAnalyser.connect(audioCtx.destination);

      ["A", "B"].forEach((key) => {
        const d = decks[key];
        d.sourceNode = audioCtx.createMediaElementSource(d.audio);
        d.filterNode = audioCtx.createBiquadFilter();
        d.filterNode.type = "lowpass";
        d.filterNode.frequency.value = 20000;

        d.gainNode = audioCtx.createGain();
        d.gainNode.gain.value = 1.0;

        d.sourceNode.connect(d.filterNode);
        d.filterNode.connect(d.gainNode);
        d.gainNode.connect(masterGain);

        d.audio.addEventListener("timeupdate", () => {
          if (key === activeDeckKey && activePlaybackMode === "web_audio") {
            handlePlaybackTick();
          }
        });

        d.audio.addEventListener("ended", () => {
          if (key === activeDeckKey && !isTransitioning) {
            triggerRadioTransition({ reason: "track_ended" });
          }
        });
      });
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function getSettings() {
    return window.HorizonAppSettings ? window.HorizonAppSettings.get() : {};
  }

  function setDeckDucking(deckKey, ducked, durationSec = 1.1) {
    const d = decks[deckKey];
    const settings = getSettings();
    const duckVol = parseFloat(settings.musicDuckLevel ?? 0.22);
    const targetGain = ducked ? duckVol : 1.0;
    const targetFreq = ducked ? 3100 : 20000;

    if (audioCtx && d.gainNode && d.filterNode) {
      const now = audioCtx.currentTime;
      d.gainNode.gain.cancelScheduledValues(now);
      d.gainNode.gain.setValueAtTime(d.gainNode.gain.value, now);
      d.gainNode.gain.linearRampToValueAtTime(targetGain, now + durationSec);

      d.filterNode.frequency.cancelScheduledValues(now);
      d.filterNode.frequency.setValueAtTime(d.filterNode.frequency.value, now);
      d.filterNode.frequency.exponentialRampToValueAtTime(targetFreq, now + durationSec);
    } else {
      d.audio.volume = targetGain;
    }

    if (activePlaybackMode === "spotify_sdk" || activePlaybackMode === "spotify_remote") {
      window.SpotifyManager.setSpotifyVolume(targetGain);
    }
  }

  function rampDeckVolume(deckKey, fromVol, toVol, durationSec = 2.5) {
    const d = decks[deckKey];
    if (audioCtx && d.gainNode) {
      const now = audioCtx.currentTime;
      d.gainNode.gain.cancelScheduledValues(now);
      d.gainNode.gain.setValueAtTime(fromVol, now);
      d.gainNode.gain.linearRampToValueAtTime(toVol, now + durationSec);
    } else {
      d.audio.volume = toVol;
    }
  }

  function getCurrentTrack() {
    return queue[currentIndex] || null;
  }

  function getNextTrackIndex() {
    if (queue.length === 0) return -1;
    return (currentIndex + 1) % queue.length;
  }

  function getNextTrack() {
    const idx = getNextTrackIndex();
    return idx >= 0 ? queue[idx] : null;
  }

  /**
   * Pre-generates Amy Simpson's script and pre-synthesizes the NVIDIA Riva / Neural TTS audio
   * ahead of the transition so playback is instantaneous.
   */
  async function preCacheNextTransition(force = false) {
    const nextTrack = getNextTrack();
    if (!nextTrack) return null;
    const currentTrack = getCurrentTrack();

    const cacheKey = `${currentTrack ? currentTrack.id : "intro"}__${nextTrack.id}__${nextIsSkillSong}`;
    if (!force && preCachedSegment && preCachedSegment.cacheKey === cacheKey) {
      return preCachedSegment;
    }
    if (isPreCaching && !force) return null;

    isPreCaching = true;
    emit("onPreCacheUpdate", { status: "generating", nextTrack });

    try {
      const settings = getSettings();
      const scriptResult = await window.AmyScriptEngine.generateScript({
        prevTrack: currentTrack,
        nextTrack,
        isSkillSong: nextIsSkillSong,
        settings,
      });

      emit("onPreCacheUpdate", {
        status: "synthesizing_voice",
        nextTrack,
        scriptText: scriptResult.text,
        scriptSource: scriptResult.source,
      });

      const ttsClip = await window.HorizonTTSEngine.synthesizeToBuffer(scriptResult.text, settings);

      preCachedSegment = {
        cacheKey,
        prevTrack: currentTrack,
        nextTrack,
        isSkillSong: nextIsSkillSong,
        scriptText: scriptResult.text,
        scriptSource: scriptResult.source,
        ttsClip,
      };

      emit("onPreCacheUpdate", {
        status: "ready",
        nextTrack,
        scriptText: scriptResult.text,
        scriptSource: scriptResult.source,
        voiceProvider: ttsClip.providerLabel,
      });
      return preCachedSegment;
    } catch (err) {
      console.error("[HorizonRadioMixer] Pre-cache error:", err);
      emit("onPreCacheUpdate", { status: "error", error: err.message });
      return null;
    } finally {
      isPreCaching = false;
    }
  }

  function handlePlaybackTick() {
    let currentSec = 0;
    let durationSec = 180;

    if (activePlaybackMode === "web_audio") {
      const activeAudio = decks[activeDeckKey].audio;
      currentSec = activeAudio.currentTime || 0;
      durationSec =
        activeAudio.duration && isFinite(activeAudio.duration)
          ? activeAudio.duration
          : (getCurrentTrack()?.duration_ms || 180000) / 1000;
    } else {
      currentSec = spotifyElapsedMs / 1000;
      durationSec = spotifyDurationMs / 1000;
    }

    const remainingSec = Math.max(0, durationSec - currentSec);
    emit("onProgress", {
      currentSec,
      durationSec,
      remainingSec,
      percent: durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0,
    });

    const settings = getSettings();
    const outroLeadSec = parseFloat(settings.outroLeadSec || 10);

    // Pre-cache Amy Simpson's upcoming segment ~24 seconds before track ends
    if (!isTransitioning && !preCachedSegment && !isPreCaching && remainingSec <= outroLeadSec + 16) {
      preCacheNextTransition();
    }

    // Trigger automatic DJ outro/intro crossfade when reaching outro window
    if (!isTransitioning && durationSec > 12 && remainingSec <= outroLeadSec && currentSec > 4) {
      triggerRadioTransition({ reason: "outro_window" });
    }
  }

  /**
   * Loads and starts a track on the specified deck (or via Spotify SDK / Remote API).
   */
  async function startTrackOnDeck(track, deckKey, { startDucked = false, fadeInSec = 2.0 } = {}) {
    ensureAudioGraph();
    clearInterval(spotifyTrackTimer);

    const d = decks[deckKey];
    const settings = getSettings();
    const duckVol = parseFloat(settings.musicDuckLevel ?? 0.22);
    const targetInitialVol = startDucked ? duckVol : 1.0;

    if (track.source === "spotify" && !track.isStarter) {
      const spRes = await window.SpotifyManager.playSpotifyTrack(track, settings.spotifyPlaybackMode || "auto");
      if (spRes.playedOnSpotify) {
        activePlaybackMode = spRes.mode === "sdk" ? "spotify_sdk" : "spotify_remote";
        spotifyElapsedMs = 0;
        spotifyDurationMs = track.duration_ms || 200000;
        await window.SpotifyManager.setSpotifyVolume(targetInitialVol);

        spotifyTrackTimer = setInterval(() => {
          if (!isPlaying) return;
          const sdkState = window.SpotifyManager.getSdkState();
          if (activePlaybackMode === "spotify_sdk" && sdkState && !sdkState.paused) {
            spotifyElapsedMs = sdkState.position || spotifyElapsedMs + 500;
            spotifyDurationMs = sdkState.duration || spotifyDurationMs;
          } else {
            spotifyElapsedMs += 500;
          }
          handlePlaybackTick();
        }, 500);
        return;
      }
    }

    // Web Audio Deck playback (for local tracks and Spotify direct audio resolver streams)
    activePlaybackMode = "web_audio";
    let audioUrl = track.audio_url || "";
    if (!audioUrl) {
      audioUrl = `/api/spotify/resolve-audio?artist=${encodeURIComponent(track.artist || "")}&title=${encodeURIComponent(track.title || "")}&preview=${encodeURIComponent(track.preview_url || "")}`;
      track.audio_url = audioUrl;
    }

    d.audio.src = audioUrl;
    d.audio.currentTime = 0;

    if (audioCtx && d.filterNode && d.gainNode) {
      const now = audioCtx.currentTime;
      d.filterNode.frequency.setValueAtTime(startDucked ? 3100 : 20000, now);
      d.gainNode.gain.setValueAtTime(0.01, now);
      d.gainNode.gain.linearRampToValueAtTime(targetInitialVol, now + fadeInSec);
    }

    try {
      await d.audio.play();
    } catch (err) {
      console.warn("[HorizonRadioMixer] Deck play warning:", err);
    }
  }

  /**
   * Executes the signature Forza Horizon Radio Transition:
   * 1. Ducks outgoing track
   * 2. Plays Amy Simpson's voiceover over the outgoing outro
   * 3. Crossfades into the incoming track's intro underneath Amy's voice
   * 4. Swells the incoming track to 100% as Amy finishes her intro
   */
  async function triggerRadioTransition({ reason = "manual", targetIndex = null } = {}) {
    if (isTransitioning || queue.length === 0) return;
    isTransitioning = true;
    ensureAudioGraph();

    const settings = getSettings();
    const djEnabled = settings.enableAmyVoice !== false;
    const outgoingDeckKey = activeDeckKey;
    const incomingDeckKey = activeDeckKey === "A" ? "B" : "A";

    const nextIdx = targetIndex !== null ? targetIndex : getNextTrackIndex();
    const prevTrack = getCurrentTrack();
    const nextTrack = queue[nextIdx];

    if (!djEnabled) {
      // Pure musical crossfade without DJ voiceover
      rampDeckVolume(outgoingDeckKey, 1.0, 0.0, 2.5);
      activeDeckKey = incomingDeckKey;
      currentIndex = nextIdx;
      emit("onTrackChange", { track: nextTrack, index: currentIndex });
      await startTrackOnDeck(nextTrack, incomingDeckKey, { startDucked: false, fadeInSec: 2.5 });
      setTimeout(() => {
        decks[outgoingDeckKey].audio.pause();
        isTransitioning = false;
        preCachedSegment = null;
        preCacheNextTransition();
      }, 2600);
      return;
    }

    // Step 1: Duck the current song down so Amy's voice sits clearly on top
    if (isPlaying && prevTrack) {
      setDeckDucking(outgoingDeckKey, true, 1.0);
    }

    // Ensure we have a prepared DJ segment for this transition
    let segment = preCachedSegment;
    if (!segment || segment.nextTrack?.id !== nextTrack.id) {
      emit("onDjStateChange", {
        active: true,
        phase: "preparing",
        scriptText: "Cueing up Amy Simpson in the Horizon Pulse booth...",
        prevTrack,
        nextTrack,
      });
      segment = await preCacheNextTransition(true);
    }

    const isSkill = Boolean(segment?.isSkillSong || nextIsSkillSong);
    nextIsSkillSong = false;
    emit("onSkillSongState", { active: isSkill, track: nextTrack });

    // Step 2: Start Amy Simpson's voiceover over the ducked outro of the outgoing track
    let crossfadeTriggered = false;

    const triggerUnderneathCrossfade = async () => {
      if (crossfadeTriggered) return;
      crossfadeTriggered = true;

      // Fade out outgoing deck completely
      rampDeckVolume(outgoingDeckKey, parseFloat(settings.musicDuckLevel ?? 0.22), 0.0, 2.8);
      setTimeout(() => {
        try {
          decks[outgoingDeckKey].audio.pause();
        } catch (_) {}
      }, 2900);

      // Switch active deck and start incoming track DUCKED underneath Amy's remaining intro
      activeDeckKey = incomingDeckKey;
      currentIndex = nextIdx;
      isPlaying = true;
      emit("onTrackChange", { track: nextTrack, index: currentIndex, isSkillSong: isSkill });
      await startTrackOnDeck(nextTrack, incomingDeckKey, { startDucked: true, fadeInSec: 2.2 });
    };

    if (segment && segment.ttsClip) {
      await window.HorizonTTSEngine.playClip(segment.ttsClip, settings, {
        onStart: ({ durationSec, providerLabel }) => {
          emit("onDjStateChange", {
            active: true,
            phase: "speaking",
            scriptText: segment.scriptText,
            scriptSource: segment.scriptSource,
            voiceProvider: providerLabel,
            durationSec,
            prevTrack,
            nextTrack,
            isSkillSong: isSkill,
          });

          // If there was no previous track playing, start the new track ducked right away
          if (!prevTrack || !isPlaying) {
            setTimeout(triggerUnderneathCrossfade, 900);
          }
        },
        onProgress: (ratio) => {
          // Crossfade into the new song's intro ~42% of the way through Amy's link!
          if (ratio >= 0.42 && !crossfadeTriggered) {
            triggerUnderneathCrossfade();
          }
        },
        onEnd: () => {
          if (!crossfadeTriggered) {
            triggerUnderneathCrossfade();
          }
        },
      });
    } else {
      await triggerUnderneathCrossfade();
    }

    // Step 4: Swell the new song up to 100% full fidelity right as Amy finishes!
    setDeckDucking(activeDeckKey, false, 1.4);
    emit("onDjStateChange", {
      active: false,
      phase: "idle",
      scriptText: segment ? segment.scriptText : "",
    });

    isTransitioning = false;
    preCachedSegment = null;

    // Schedule pre-caching for the following track
    setTimeout(() => {
      if (isPlaying) preCacheNextTransition();
    }, 3500);
  }

  async function startBroadcast(startIndex = 0) {
    if (queue.length === 0) return;
    ensureAudioGraph();
    isPlaying = true;
    currentIndex = -1; // So the opening DJ segment introduces `startIndex` as the first song!
    await triggerRadioTransition({ reason: "station_start", targetIndex: startIndex });
  }

  function togglePlayPause() {
    ensureAudioGraph();
    if (queue.length === 0) return false;
    if (currentIndex < 0) {
      startBroadcast(0);
      return true;
    }

    const activeAudio = decks[activeDeckKey].audio;
    if (isPlaying) {
      isPlaying = false;
      if (activePlaybackMode === "web_audio") {
        activeAudio.pause();
      } else {
        window.SpotifyManager.pauseSpotify();
      }
      window.HorizonTTSEngine.stop();
    } else {
      isPlaying = true;
      if (activePlaybackMode === "web_audio") {
        activeAudio.play().catch(() => {});
      } else {
        window.SpotifyManager.resumeSpotify();
      }
    }
    return isPlaying;
  }

  function setQueue(newTracks, { shuffle = false } = {}) {
    let list = [...newTracks];
    if (shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    queue = list;
    currentIndex = -1;
    preCachedSegment = null;
    emit("onQueueChange", { queue, currentIndex });
  }

  function appendTracksToQueue(tracksToAdd, { interleaveMix = true } = {}) {
    if (!tracksToAdd || tracksToAdd.length === 0) return;

    // If the queue currently only has the default starter tracks, replace them with the user's tracks!
    const onlyStarters = queue.length > 0 && queue.every((t) => t.isStarter);
    if (onlyStarters) {
      queue = [...tracksToAdd];
      currentIndex = -1;
      preCachedSegment = null;
      emit("onQueueChange", { queue, currentIndex });
      if (isPlaying) {
        triggerRadioTransition({ reason: "playlist_loaded", targetIndex: 0 });
      } else {
        preCacheNextTransition(true);
      }
      return;
    }

    if (!interleaveMix || queue.length === 0) {
      queue = [...queue, ...tracksToAdd];
    } else {
      const combined = [];
      const existing = [...queue];
      const incoming = [...tracksToAdd];
      while (existing.length > 0 || incoming.length > 0) {
        if (existing.length > 0) combined.push(existing.shift());
        if (incoming.length > 0) combined.push(incoming.shift());
      }
      queue = combined;
    }
    preCachedSegment = null;
    emit("onQueueChange", { queue, currentIndex });
    preCacheNextTransition(true);
  }

  function shuffleRemainingQueue() {
    if (queue.length <= 2) return;
    const startIdx = currentIndex + 1;
    const head = queue.slice(0, startIdx);
    const tail = queue.slice(startIdx);
    for (let i = tail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    queue = [...head, ...tail];
    preCachedSegment = null;
    emit("onQueueChange", { queue, currentIndex });
    if (isPlaying) preCacheNextTransition(true);
  }

  function queueSkillSongNext() {
    nextIsSkillSong = true;
    preCacheNextTransition(true);
    return nextIsSkillSong;
  }

  function setMasterVolume(val0to1) {
    const v = Math.max(0, Math.min(1, parseFloat(val0to1)));
    if (masterGain && audioCtx) {
      masterGain.gain.setValueAtTime(v, audioCtx.currentTime);
    }
  }

  function seekToPercent(pct0to100) {
    const ratio = Math.max(0, Math.min(1, pct0to100 / 100));
    if (activePlaybackMode === "web_audio") {
      const a = decks[activeDeckKey].audio;
      if (a.duration && isFinite(a.duration)) {
        a.currentTime = a.duration * ratio;
      }
    }
  }

  function getMasterFrequencyData() {
    if (!masterAnalyser || !isPlaying) return null;
    const data = new Uint8Array(masterAnalyser.frequencyBinCount);
    masterAnalyser.getByteFrequencyData(data);
    return data;
  }

  return {
    on,
    setQueue,
    appendTracksToQueue,
    shuffleRemainingQueue,
    startBroadcast,
    togglePlayPause,
    triggerRadioTransition,
    preCacheNextTransition,
    queueSkillSongNext,
    setMasterVolume,
    seekToPercent,
    getMasterFrequencyData,
    getQueue: () => queue,
    getCurrentIndex: () => currentIndex,
    getCurrentTrack,
    getNextTrack,
    isPlaying: () => isPlaying,
  };
})();

/**
 * Horizon Pulse Radio - Hyper-Realistic TTS & Studio Broadcast DSP Engine
 * Primary: NVIDIA Riva TTS (Local gRPC localhost:50051 & NVIDIA NIM Cloud/Container API)
 * Additional: Local OpenAI-compatible TTS (Kokoro / Piper / F5), OpenAI TTS, ElevenLabs
 * Fallback: Windows / Edge Natural Neural Voice (Aria / Sonia / Jenny Online Natural)
 * Includes a Web Audio FM Broadcast Microphone DSP Chain (EQ + Broadcast Compressor + Live Voice Analyzer).
 */

window.HorizonTTSEngine = (function () {
  let audioCtx = null;
  let broadcastInputGain = null;
  let voiceAnalyser = null;
  let currentAudioSource = null;
  let isSpeaking = false;

  function ensureAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();

      // Build FM Broadcast Studio Condenser Mic Chain for Amy Simpson
      broadcastInputGain = audioCtx.createGain();
      broadcastInputGain.gain.value = 1.18;

      // 1. High-pass filter at 85Hz (studio low-cut)
      const highpass = audioCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;

      // 2. Close-mic vocal warmth at 215Hz
      const warmthEq = audioCtx.createBiquadFilter();
      warmthEq.type = "peaking";
      warmthEq.frequency.value = 215;
      warmthEq.Q.value = 1.1;
      warmthEq.gain.value = 2.4;

      // 3. Broadcast presence & articulation boost at 4.1kHz
      const presenceEq = audioCtx.createBiquadFilter();
      presenceEq.type = "peaking";
      presenceEq.frequency.value = 4100;
      presenceEq.Q.value = 1.2;
      presenceEq.gain.value = 3.2;

      // 4. Broadcast FM Limiter / Compressor
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -21;
      compressor.knee.value = 12;
      compressor.ratio.value = 4.5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.16;

      // 5. Voice AnalyserNode for live DJ waveform in the Horizon HUD
      voiceAnalyser = audioCtx.createAnalyser();
      voiceAnalyser.fftSize = 256;
      voiceAnalyser.smoothingTimeConstant = 0.75;

      broadcastInputGain.connect(highpass);
      highpass.connect(warmthEq);
      warmthEq.connect(presenceEq);
      presenceEq.connect(compressor);
      compressor.connect(voiceAnalyser);
      voiceAnalyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  /**
   * Pre-synthesizes speech into an ArrayBuffer so the radio mixer can trigger it
   * with zero latency right when the song outro starts ducking.
   */
  async function synthesizeToBuffer(text, settings = {}) {
    const provider = settings.ttsProvider || "riva_nim"; // 'riva_nim', 'riva_grpc', 'local_openai', 'elevenlabs', 'browser_neural'

    if (provider === "browser_neural") {
      return { type: "browser_speech", text, providerLabel: "Neural Web Speech" };
    }

    try {
      if (provider === "riva_grpc" || provider === "riva_nim") {
        const mode = provider === "riva_grpc" ? "grpc" : "nim_http";
        const apiKey = (settings.rivaApiKey || settings.llmApiKey || "").trim();
        if (mode === "nim_http" && !apiKey && (settings.rivaEndpoint || "").includes("integrate.api.nvidia.com")) {
          // If no NVIDIA NIM API key is configured yet, fall back gracefully to Browser Neural Voice
          throw new Error("NVIDIA NIM API Key not set; falling back to local neural voice.");
        }

        const resp = await fetch("/api/tts/riva", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            text,
            grpcUri: settings.rivaGrpcUri || "localhost:50051",
            endpoint: settings.rivaEndpoint || "https://integrate.api.nvidia.com/v1/audio/synthesize",
            apiKey,
            voice: settings.rivaVoice || "English-US.Female-1",
            language: settings.rivaLanguage || "en-US",
            model: settings.rivaModel || "nvidia/magpie-tts-multilingual",
          }),
        });

        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson.error || `Riva TTS returned HTTP ${resp.status}`);
        }

        const arrayBuffer = await resp.arrayBuffer();
        return {
          type: "audio_buffer",
          arrayBuffer,
          text,
          providerLabel: mode === "grpc" ? "NVIDIA Riva (Local gRPC)" : "NVIDIA Riva NIM TTS",
        };
      }

      if (provider === "local_openai") {
        // Supports local Kokoro-FastAPI (http://localhost:8880/v1/audio/speech), Piper, or OpenAI TTS
        const endpoint = settings.localTtsEndpoint || "http://localhost:8880/v1/audio/speech";
        const resp = await fetch("/api/tts/riva", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "nim_http",
            text,
            endpoint,
            apiKey: settings.localTtsApiKey || "",
            voice: settings.localTtsVoice || "af_bella",
            model: settings.localTtsModel || "kokoro",
          }),
        });
        if (!resp.ok) {
          throw new Error(`Local/OpenAI TTS returned HTTP ${resp.status}`);
        }
        const arrayBuffer = await resp.arrayBuffer();
        return {
          type: "audio_buffer",
          arrayBuffer,
          text,
          providerLabel: "Neural Audio TTS",
        };
      }

      if (provider === "elevenlabs") {
        const voiceId = settings.elevenVoiceId || "EXAVITQu4vr4xnSDxMaL"; // Bella / Rachel
        const elevenKey = (settings.elevenApiKey || "").trim();
        if (!elevenKey) throw new Error("Missing ElevenLabs API key");

        const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenKey,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.45, similarity_boost: 0.82, style: 0.35, use_speaker_boost: true },
          }),
        });
        if (!resp.ok) throw new Error(`ElevenLabs HTTP ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        return {
          type: "audio_buffer",
          arrayBuffer,
          text,
          providerLabel: "ElevenLabs Turbo v2.5",
        };
      }
    } catch (err) {
      console.warn("[HorizonTTSEngine] Falling back to Neural Browser Speech:", err.message);
      return {
        type: "browser_speech",
        text,
        providerLabel: "Windows/Edge Natural Voice (Fallback)",
        fallbackReason: err.message,
      };
    }

    return { type: "browser_speech", text, providerLabel: "Neural Web Speech" };
  }

  /**
   * Selects the most realistic female radio host voice available in the browser
   * (prioritizing Microsoft Natural Online voices like Sonia, Libby, Aria, Jenny).
   */
  function selectBestBrowserVoice(preferredName = "") {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    if (preferredName) {
      const exact = voices.find((v) => v.name === preferredName);
      if (exact) return exact;
    }

    // Priority list of ultra-natural female voices (UK/US Horizon Pulse vibe)
    const priorityKeywords = [
      "Sonia Online (Natural)",
      "Libby Online (Natural)",
      "Aria Online (Natural)",
      "Jenny Online (Natural)",
      "Maisie Online (Natural)",
      "Ava Online (Natural)",
      "Emma Online (Natural)",
      "Google UK English Female",
      "Google US English",
      "Hazel",
      "Zira",
    ];

    for (const kw of priorityKeywords) {
      const match = voices.find((v) => v.name.toLowerCase().includes(kw.toLowerCase()));
      if (match) return match;
    }

    return voices.find((v) => v.lang.startsWith("en")) || voices[0];
  }

  /**
   * Plays a pre-synthesized TTS clip through the Broadcast Studio DSP Chain
   * (or Web Speech API fallback) and resolves when Amy finishes speaking.
   */
  function playClip(preparedClip, settings = {}, callbacks = {}) {
    stop();
    const { onStart, onEnd, onProgress } = callbacks;

    if (preparedClip && preparedClip.type === "audio_buffer" && preparedClip.arrayBuffer) {
      return new Promise(async (resolve) => {
        try {
          const ctx = ensureAudioContext();
          // Copy buffer in case it gets detached
          const bufferCopy = preparedClip.arrayBuffer.slice(0);
          const decoded = await ctx.decodeAudioData(bufferCopy);

          const source = ctx.createBufferSource();
          source.buffer = decoded;
          broadcastInputGain.gain.value = parseFloat(settings.djVoiceGain || 1.15);
          source.connect(broadcastInputGain);

          currentAudioSource = source;
          isSpeaking = true;
          const durationSec = decoded.duration;
          const startTime = ctx.currentTime;

          if (onStart) onStart({ durationSec, providerLabel: preparedClip.providerLabel });

          const timer = setInterval(() => {
            if (!isSpeaking) {
              clearInterval(timer);
              return;
            }
            const elapsed = ctx.currentTime - startTime;
            if (onProgress) onProgress(Math.min(1, elapsed / Math.max(0.1, durationSec)), elapsed, durationSec);
          }, 80);

          source.onended = () => {
            clearInterval(timer);
            isSpeaking = false;
            currentAudioSource = null;
            if (onEnd) onEnd();
            resolve();
          };

          source.start(0);
        } catch (err) {
          console.warn("[HorizonTTSEngine] AudioBuffer decode failed, using Web Speech fallback:", err);
          playBrowserSpeech(preparedClip.text, settings, callbacks).then(resolve);
        }
      });
    }

    return playBrowserSpeech(preparedClip ? preparedClip.text : "", settings, callbacks);
  }

  function playBrowserSpeech(text, settings = {}, callbacks = {}) {
    const { onStart, onEnd, onProgress } = callbacks;
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || !text) {
        if (onStart) onStart({ durationSec: 4, providerLabel: "Simulated Voice" });
        setTimeout(() => {
          if (onEnd) onEnd();
          resolve();
        }, 4000);
        return;
      }

      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const chosenVoice = selectBestBrowserVoice(settings.browserVoiceName);
      if (chosenVoice) utter.voice = chosenVoice;

      utter.rate = parseFloat(settings.speechRate || 1.03);
      utter.pitch = parseFloat(settings.speechPitch || 1.04);
      utter.volume = Math.min(1, parseFloat(settings.djVoiceGain || 1.0));

      // Estimate duration from word count (~2.7 words/sec)
      const words = text.split(/\s+/).length;
      const estimatedDurationSec = Math.max(4, words / 2.75);
      const startedAt = performance.now();
      isSpeaking = true;

      const timer = setInterval(() => {
        if (!isSpeaking) {
          clearInterval(timer);
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        if (onProgress) {
          onProgress(Math.min(0.98, elapsed / estimatedDurationSec), elapsed, estimatedDurationSec);
        }
      }, 100);

      utter.onstart = () => {
        if (onStart) {
          onStart({
            durationSec: estimatedDurationSec,
            providerLabel: chosenVoice ? `Neural (${chosenVoice.name})` : "Browser Speech",
          });
        }
      };

      const finish = () => {
        clearInterval(timer);
        if (!isSpeaking) return;
        isSpeaking = false;
        if (onEnd) onEnd();
        resolve();
      };

      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.speak(utter);
    });
  }

  function stop() {
    isSpeaking = false;
    if (currentAudioSource) {
      try {
        currentAudioSource.stop();
      } catch (_) {}
      currentAudioSource = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function getVoiceFrequencyData() {
    if (!isSpeaking) return null;
    if (voiceAnalyser && currentAudioSource) {
      const arr = new Uint8Array(voiceAnalyser.frequencyBinCount);
      voiceAnalyser.getByteFrequencyData(arr);
      return arr;
    }
    // Simulated reactive broadcast modulation meter when Web Speech API is speaking
    const simulated = new Uint8Array(32);
    const now = performance.now() * 0.012;
    for (let i = 0; i < 32; i++) {
      simulated[i] = Math.max(
        18,
        Math.min(255, Math.floor(110 + 85 * Math.sin(now + i * 0.45) * Math.cos(now * 0.7 - i * 0.2)))
      );
    }
    return simulated;
  }

  return {
    synthesizeToBuffer,
    playClip,
    stop,
    selectBestBrowserVoice,
    getVoiceFrequencyData,
    isCurrentlySpeaking: () => isSpeaking,
  };
})();

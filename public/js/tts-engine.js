/**
 * Horizon Pulse Radio - Hyper-Realistic Energetic Neural TTS & Broadcast Studio DSP Engine
 * Routes all synthesized speech through a Web Audio FM Broadcast Condenser Mic Chain:
 * - 85Hz High-Pass Filter -> 215Hz Studio Warmth -> 4.2kHz Presence -> 6kHz Air Exciter -> 4.5:1 Broadcast Limiter
 * - Supports multi-sentence Neural MP3 chunk stitching (with silence trimming for fast, punchy radio pacing!),
 *   Local NVIDIA Riva gRPC/HTTP, ElevenLabs, and OpenAI-compatible local TTS.
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

      broadcastInputGain = audioCtx.createGain();
      broadcastInputGain.gain.value = 1.25;

      // 1. Studio Low-Cut at 85Hz
      const highpass = audioCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;

      // 2. Close-Mic Vocal Warmth at 215Hz
      const warmthEq = audioCtx.createBiquadFilter();
      warmthEq.type = "peaking";
      warmthEq.frequency.value = 215;
      warmthEq.Q.value = 1.1;
      warmthEq.gain.value = 2.6;

      // 3. Energetic Radio Presence Boost at 4.2kHz
      const presenceEq = audioCtx.createBiquadFilter();
      presenceEq.type = "peaking";
      presenceEq.frequency.value = 4200;
      presenceEq.Q.value = 1.1;
      presenceEq.gain.value = 3.5;

      // 4. High-Shelf Exciter Air at 6.5kHz
      const airShelf = audioCtx.createBiquadFilter();
      airShelf.type = "highshelf";
      airShelf.frequency.value = 6500;
      airShelf.gain.value = 2.2;

      // 5. Punchy FM Broadcast Compressor
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -22;
      compressor.knee.value = 10;
      compressor.ratio.value = 4.8;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.14;

      // 6. Voice AnalyserNode for live DJ waveform
      voiceAnalyser = audioCtx.createAnalyser();
      voiceAnalyser.fftSize = 256;
      voiceAnalyser.smoothingTimeConstant = 0.72;

      broadcastInputGain.connect(highpass);
      highpass.connect(warmthEq);
      warmthEq.connect(presenceEq);
      presenceEq.connect(airShelf);
      airShelf.connect(compressor);
      compressor.connect(voiceAnalyser);
      voiceAnalyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function base64ToArrayBuffer(b64) {
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Trims dead leading/trailing silence from decoded sentence AudioBuffers and stitches them
   * together with a tight 55ms radio breath pause so Amy sounds fast, energetic, and seamless!
   */
  function stitchAudioBuffers(ctx, buffers) {
    if (!buffers || buffers.length === 0) return null;
    if (buffers.length === 1) return buffers[0];

    const sampleRate = buffers[0].sampleRate;
    const trimmedRanges = buffers.map((buf) => {
      const data = buf.getChannelData(0);
      let start = 0;
      let end = data.length - 1;
      const threshold = 0.008;
      while (start < end && Math.abs(data[start]) < threshold) start++;
      while (end > start && Math.abs(data[end]) < threshold) end--;
      start = Math.max(0, start - Math.floor(sampleRate * 0.015));
      end = Math.min(data.length - 1, end + Math.floor(sampleRate * 0.025));
      return { buf, start, length: Math.max(1, end - start + 1) };
    });

    const pauseSamples = Math.floor(sampleRate * 0.055); // Tight 55ms energetic radio breath
    const totalLength =
      trimmedRanges.reduce((acc, r) => acc + r.length, 0) + pauseSamples * (trimmedRanges.length - 1);

    const out = ctx.createBuffer(1, totalLength, sampleRate);
    const outData = out.getChannelData(0);
    let offset = 0;

    trimmedRanges.forEach((r, idx) => {
      const src = r.buf.getChannelData(0).subarray(r.start, r.start + r.length);
      outData.set(src, offset);
      offset += r.length;
      if (idx < trimmedRanges.length - 1) {
        offset += pauseSamples;
      }
    });

    return out;
  }

  async function synthesizeToBuffer(text, settings = {}) {
    const provider = settings.ttsProvider || "riva_nim";

    try {
      if (provider === "elevenlabs" && (settings.elevenApiKey || "").trim()) {
        const voiceId = settings.elevenVoiceId || "EXAVITQu4vr4xnSDxMaL";
        const elevenKey = settings.elevenApiKey.trim();
        const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenKey,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.65, use_speaker_boost: true },
          }),
        });
        if (resp.ok) {
          const arrayBuffer = await resp.arrayBuffer();
          return {
            type: "audio_buffer",
            arrayBuffer,
            text,
            providerLabel: "ElevenLabs Turbo v2.5 (Energetic)",
          };
        }
      }

      // Call our backend neural synthesizer (/api/tts/riva) which handles:
      // 1. High-Energy Horizon Neural DJ Voices (en_us_001 Jessie, en_uk_001 British, en_au_001, etc.)
      // 2. Local NVIDIA Riva gRPC / NIM container
      // 3. Local Kokoro / Piper / OpenAI TTS
      const resp = await fetch("/api/tts/riva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: provider === "riva_grpc" ? "grpc" : "nim_http",
          text,
          grpcUri: settings.rivaGrpcUri || "localhost:50051",
          endpoint: settings.rivaEndpoint || "",
          apiKey: settings.rivaApiKey || settings.llmApiKey || "",
          voice: settings.rivaVoice || "en_us_001",
          language: settings.rivaLanguage || "en-US",
          model: settings.rivaModel || "nvidia/magpie-tts-multilingual",
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || `TTS HTTP ${resp.status}`);
      }

      const contentType = resp.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await resp.json();
        if (data.ok && Array.isArray(data.chunks) && data.chunks.length > 0) {
          return {
            type: "audio_chunks",
            chunks: data.chunks.map(base64ToArrayBuffer),
            text,
            providerLabel: data.providerLabel || "Horizon Neural HD (Energetic)",
          };
        }
        throw new Error(data.error || "Invalid JSON TTS response");
      }

      const arrayBuffer = await resp.arrayBuffer();
      return {
        type: "audio_buffer",
        arrayBuffer,
        text,
        providerLabel: "NVIDIA Riva / Neural Studio Audio",
      };
    } catch (err) {
      console.warn("[HorizonTTSEngine] Falling back to Browser Speech:", err.message);
      return {
        type: "browser_speech",
        text,
        providerLabel: "Natural Browser Voice (Fallback)",
      };
    }
  }

  function playClip(preparedClip, settings = {}, callbacks = {}) {
    stop();
    const { onStart, onEnd, onProgress } = callbacks;

    if (
      preparedClip &&
      (preparedClip.type === "audio_chunks" || preparedClip.type === "audio_buffer")
    ) {
      return new Promise(async (resolve) => {
        try {
          const ctx = ensureAudioContext();
          let finalBuffer = null;

          if (preparedClip.type === "audio_chunks" && preparedClip.chunks.length > 0) {
            const decodedList = [];
            for (const rawBuf of preparedClip.chunks) {
              const copy = rawBuf.slice(0);
              const dec = await ctx.decodeAudioData(copy);
              decodedList.push(dec);
            }
            finalBuffer = stitchAudioBuffers(ctx, decodedList);
          } else if (preparedClip.arrayBuffer) {
            const copy = preparedClip.arrayBuffer.slice(0);
            finalBuffer = await ctx.decodeAudioData(copy);
          }

          if (!finalBuffer) throw new Error("Empty decoded buffer");

          const source = ctx.createBufferSource();
          source.buffer = finalBuffer;
          // Slight energetic broadcast tempo boost (1.03x) so delivery is crisp and upbeat!
          const rateBoost = parseFloat(settings.speechRate || 1.03);
          source.playbackRate.value = Math.max(0.9, Math.min(1.2, rateBoost));

          broadcastInputGain.gain.value = parseFloat(settings.djVoiceGain || 1.25);
          source.connect(broadcastInputGain);

          currentAudioSource = source;
          isSpeaking = true;
          const durationSec = finalBuffer.duration / source.playbackRate.value;
          const startTime = ctx.currentTime;

          if (onStart) onStart({ durationSec, providerLabel: preparedClip.providerLabel });

          const timer = setInterval(() => {
            if (!isSpeaking) {
              clearInterval(timer);
              return;
            }
            const elapsed = ctx.currentTime - startTime;
            if (onProgress) onProgress(Math.min(1, elapsed / Math.max(0.1, durationSec)), elapsed, durationSec);
          }, 75);

          source.onended = () => {
            clearInterval(timer);
            isSpeaking = false;
            currentAudioSource = null;
            if (onEnd) onEnd();
            resolve();
          };

          source.start(0);
        } catch (err) {
          console.warn("[HorizonTTSEngine] Decode fallback:", err);
          playBrowserSpeech(preparedClip.text, settings, callbacks).then(resolve);
        }
      });
    }

    return playBrowserSpeech(preparedClip ? preparedClip.text : "", settings, callbacks);
  }

  function selectBestBrowserVoice(preferredName = "") {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    if (preferredName) {
      const exact = voices.find((v) => v.name === preferredName);
      if (exact) return exact;
    }
    const priorityKeywords = [
      "Sonia Online (Natural)",
      "Libby Online (Natural)",
      "Aria Online (Natural)",
      "Jenny Online (Natural)",
      "Ava Online (Natural)",
      "Google UK English Female",
    ];
    for (const kw of priorityKeywords) {
      const match = voices.find((v) => v.name.toLowerCase().includes(kw.toLowerCase()));
      if (match) return match;
    }
    return voices.find((v) => v.lang.startsWith("en")) || voices[0];
  }

  function playBrowserSpeech(text, settings = {}, callbacks = {}) {
    const { onStart, onEnd, onProgress } = callbacks;
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || !text) {
        if (onStart) onStart({ durationSec: 3, providerLabel: "Voice Standby" });
        setTimeout(() => {
          if (onEnd) onEnd();
          resolve();
        }, 3000);
        return;
      }

      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const chosenVoice = selectBestBrowserVoice(settings.browserVoiceName);
      if (chosenVoice) utter.voice = chosenVoice;
      utter.rate = 1.08;
      utter.pitch = 1.08;
      utter.volume = 1.0;

      const words = text.split(/\s+/).length;
      const estimatedDurationSec = Math.max(3.5, words / 2.9);
      const startedAt = performance.now();
      isSpeaking = true;

      const timer = setInterval(() => {
        if (!isSpeaking) {
          clearInterval(timer);
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        if (onProgress) onProgress(Math.min(0.98, elapsed / estimatedDurationSec), elapsed, estimatedDurationSec);
      }, 90);

      utter.onstart = () => {
        if (onStart) onStart({ durationSec: estimatedDurationSec, providerLabel: "Browser Speech" });
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
    const simulated = new Uint8Array(32);
    const now = performance.now() * 0.015;
    for (let i = 0; i < 32; i++) {
      simulated[i] = Math.max(
        24,
        Math.min(255, Math.floor(125 + 95 * Math.sin(now + i * 0.45) * Math.cos(now * 0.7 - i * 0.2)))
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

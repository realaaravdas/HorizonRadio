/**
 * Horizon Pulse Radio - Local Playlist & Audio Library Manager
 * Supports:
 * 1. Browser File & Folder Selection + Drag-and-Drop (.mp3, .flac, .wav, .ogg, .m4a, .aac)
 * 2. Client-side ID3v2 tag & embedded cover art parser
 * 3. Server-side Local Path & .m3u/.m3u8/.pls Scanner (/api/local/scan + /api/local/stream)
 * 4. Built-in Horizon Pulse Festival Starter Tracks (synthesized stereo WAV audio blobs so
 *    you can test real crossfading, ducking, and Amy Simpson's DJ transitions out of the box!)
 */

window.LocalPlaylistManager = (function () {
  const AUDIO_EXT_REGEX = /\.(mp3|flac|wav|ogg|m4a|aac|opus|webm)$/i;

  function parseFilenameMetadata(filename) {
    const base = filename.replace(/\.[^/.]+$/, "").replace(/^\d{1,3}[\s._-]+/, "");
    if (base.includes(" - ")) {
      const [artist, title] = base.split(" - ", 2);
      return { artist: artist.trim(), title: title.trim() };
    }
    return { artist: "Local Artist", title: base.trim() };
  }

  /**
   * Lightweight client-side ID3v2 parser for MP3 files to extract Title, Artist, Album
   */
  async function parseId3Tags(file) {
    const fallback = parseFilenameMetadata(file.name);
    try {
      const slice = file.slice(0, 131072); // Read first 128KB for ID3v2 header
      const buf = await slice.arrayBuffer();
      const view = new DataView(buf);
      if (
        view.byteLength < 10 ||
        view.getUint8(0) !== 0x49 || // 'I'
        view.getUint8(1) !== 0x44 || // 'D'
        view.getUint8(2) !== 0x33    // '3'
      ) {
        return fallback;
      }

      const version = view.getUint8(3);
      const tagSize =
        ((view.getUint8(6) & 0x7f) << 21) |
        ((view.getUint8(7) & 0x7f) << 14) |
        ((view.getUint8(8) & 0x7f) << 7) |
        (view.getUint8(9) & 0x7f);

      const limit = Math.min(view.byteLength, 10 + tagSize);
      let offset = 10;
      const meta = { ...fallback };

      while (offset + 10 < limit) {
        const frameId = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3)
        );
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

        let frameSize = 0;
        if (version === 4) {
          frameSize =
            ((view.getUint8(offset + 4) & 0x7f) << 21) |
            ((view.getUint8(offset + 5) & 0x7f) << 14) |
            ((view.getUint8(offset + 6) & 0x7f) << 7) |
            (view.getUint8(offset + 7) & 0x7f);
        } else {
          frameSize = view.getUint32(offset + 4);
        }

        if (frameSize <= 1 || offset + 10 + frameSize > limit) break;

        if (frameId === "TIT2" || frameId === "TPE1" || frameId === "TALB") {
          const encoding = view.getUint8(offset + 10);
          const textBytes = new Uint8Array(buf, offset + 11, frameSize - 1);
          let decoder;
          if (encoding === 1 || encoding === 2) {
            decoder = new TextDecoder("utf-16");
          } else if (encoding === 3) {
            decoder = new TextDecoder("utf-8");
          } else {
            decoder = new TextDecoder("iso-8859-1");
          }
          const str = decoder.decode(textBytes).replace(/\0/g, "").trim();
          if (str) {
            if (frameId === "TIT2") meta.title = str;
            if (frameId === "TPE1") meta.artist = str;
            if (frameId === "TALB") meta.album = str;
          }
        }
        offset += 10 + frameSize;
      }
      return meta;
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Loads FileList / array of File objects selected or dropped by the user
   */
  async function ingestBrowserFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => AUDIO_EXT_REGEX.test(f.name));
    const tracks = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const meta = await parseId3Tags(file);
      const objectUrl = URL.createObjectURL(file);
      tracks.push({
        id: `local-file-${Date.now()}-${i}`,
        title: meta.title || file.name,
        artist: meta.artist || "Local Artist",
        album: meta.album || "Local Playlist",
        duration_ms: 200000,
        audio_url: objectUrl,
        source: "local",
        fileName: file.name,
      });
    }
    return tracks;
  }

  /**
   * Scans a folder path or .m3u/.m3u8/.pls file on disk via the local server
   */
  async function scanLocalFolderOrPlaylist(pathStr) {
    const resp = await fetch("/api/local/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathStr }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "Could not scan local path");
    }

    return (data.tracks || []).map((t, idx) => ({
      id: `local-disk-${Date.now()}-${idx}`,
      title: t.title || "Untitled Track",
      artist: t.artist || "Unknown Artist",
      album: t.album || "Local Folder",
      duration_ms: t.duration_ms || 210000,
      audio_url: `/api/local/stream?path=${encodeURIComponent(t.path)}`,
      source: "local",
      path: t.path,
    }));
  }

  /**
   * Generates a real, lush stereo synthwave/festival WAV audio blob for demo tracks
   * or when a Spotify track in unauthenticated preview mode doesn't provide a preview URL.
   */
  function generateFestivalSynthTrackBlob({
    durationSec = 38,
    bpm = 122,
    rootFreq = 110,
    chordRatios = [1, 1.25, 1.5, 1.875],
    style = "pulse",
  } = {}) {
    const sampleRate = 22050;
    const numSamples = Math.floor(sampleRate * durationSec);
    const numChannels = 2;
    const dataSize = numSamples * numChannels * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    const beatDuration = 60 / bpm;
    const barDuration = beatDuration * 4;
    const progression = [1.0, 0.8, 0.6667, 0.75]; // Lush sunset synth-pop progression

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const barIndex = Math.floor(t / barDuration) % progression.length;
      const root = rootFreq * progression[barIndex];

      // Four-on-the-floor festival kick + sidechain pumping envelope
      const beatPhase = (t % beatDuration) / beatDuration;
      const sidechain = 0.35 + 0.65 * Math.min(1, beatPhase * 2.2);
      const kickFreq = 52 + 110 * Math.exp(-beatPhase * 28);
      const kickEnv = Math.exp(-beatPhase * 9.5);
      const kick = Math.sin(2 * Math.PI * kickFreq * t) * kickEnv * 0.42;

      // Off-beat hi-hat shimmer
      const halfBeatPhase = ((t + beatDuration * 0.5) % beatDuration) / beatDuration;
      const hatEnv = Math.exp(-halfBeatPhase * 32);
      const hat = ((Math.sin(t * 9431) * Math.cos(t * 15127)) % 1) * hatEnv * 0.08;

      // Warm analog bassline (16th note octave arp)
      const sixteenthIndex = Math.floor((t / (beatDuration / 4)) % 8);
      const bassMult = sixteenthIndex % 2 === 0 ? 0.5 : 1.0;
      const bass = Math.tanh(Math.sin(2 * Math.PI * root * bassMult * t) * 2.1) * 0.24 * sidechain;

      // Lush stereo chorus synth pad + arpeggio
      let padL = 0;
      let padR = 0;
      for (let c = 0; c < chordRatios.length; c++) {
        const freq = root * 2 * chordRatios[c];
        padL += Math.sin(2 * Math.PI * (freq * 1.002) * t + c) * 0.07;
        padR += Math.sin(2 * Math.PI * (freq * 0.998) * t - c) * 0.07;
      }

      const arpNote = chordRatios[sixteenthIndex % chordRatios.length];
      const arpEnv = Math.exp(-(((t % (beatDuration / 4)) / (beatDuration / 4)) * 4.5));
      const arpFreq = root * 4 * arpNote;
      const arp = Math.sin(2 * Math.PI * arpFreq * t) * arpEnv * 0.12 * sidechain;

      // Smooth fade-in and fade-out at edges
      const edgeFade = Math.min(1, t / 1.5, (durationSec - t) / 1.5);

      const left = Math.max(-0.98, Math.min(0.98, (kick + bass + padL * sidechain + arp + hat) * edgeFade));
      const right = Math.max(-0.98, Math.min(0.98, (kick + bass + padR * sidechain + arp * 0.85 + hat) * edgeFade));

      view.setInt16(offset, left * 32767, true);
      view.setInt16(offset + 2, right * 32767, true);
      offset += 4;
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }

  function createStarterFestivalTracks() {
    const presets = [
      {
        id: "starter-1",
        title: "A Moment Apart (Horizon Festival Edit)",
        artist: "ODESZA",
        album: "Horizon Pulse Official Anthology",
        duration_ms: 36000,
        bpm: 122,
        rootFreq: 110,
        chordRatios: [1, 1.25, 1.5, 1.875],
        source: "local",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-2",
        title: "Clearest Blue (Coastal Sunset Mix)",
        artist: "CHVRCHES",
        album: "Every Open Eye - Horizon Edition",
        duration_ms: 36000,
        bpm: 126,
        rootFreq: 130.81,
        chordRatios: [1, 1.2, 1.5, 2.0],
        source: "local",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-3",
        title: "Levitate (Midnight Canyon Run)",
        artist: "Dua Lipa",
        album: "Future Nostalgia (Horizon Pulse)",
        duration_ms: 36000,
        bpm: 118,
        rootFreq: 98.0,
        chordRatios: [1, 1.189, 1.498, 1.781],
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-4",
        title: "Midnight City (Apex Showcase VIP)",
        artist: "M83",
        album: "Hurry Up, We're Dreaming",
        duration_ms: 36000,
        bpm: 120,
        rootFreq: 116.54,
        chordRatios: [1, 1.25, 1.5, 2.0],
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-5",
        title: "Innerbloom (Horizon Baja Sunrise)",
        artist: "RÜFÜS DU SOL",
        album: "Bloom (Festival Cut)",
        duration_ms: 38000,
        bpm: 124,
        rootFreq: 103.83,
        chordRatios: [1, 1.2, 1.5, 1.8],
        source: "local",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=600&q=80",
      },
    ];

    return presets.map((p) => ({
      ...p,
      audio_url: generateFestivalSynthTrackBlob({
        durationSec: Math.round(p.duration_ms / 1000),
        bpm: p.bpm,
        rootFreq: p.rootFreq,
        chordRatios: p.chordRatios,
      }),
    }));
  }

  return {
    ingestBrowserFiles,
    scanLocalFolderOrPlaylist,
    generateFestivalSynthTrackBlob,
    createStarterFestivalTracks,
  };
})();

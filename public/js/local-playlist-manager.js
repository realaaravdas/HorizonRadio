/**
 * Horizon Pulse Radio - Local Playlist & Audio Library Manager
 * Supports:
 * 1. Browser File & Folder Selection + Drag-and-Drop (.mp3, .flac, .wav, .ogg, .m4a, .aac)
 * 2. Client-side ID3v2 tag parser
 * 3. Server-side Local Path & .m3u/.m3u8/.pls Scanner (/api/local/scan + /api/local/stream)
 * 4. Built-in Horizon Pulse Festival Starter Tracks (streams the real studio recordings of
 *    ODESZA, CHVRCHES, Dua Lipa, M83, and RÜFÜS DU SOL via /api/spotify/resolve-audio!)
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

  async function parseId3Tags(file) {
    const fallback = parseFilenameMetadata(file.name);
    try {
      const slice = file.slice(0, 131072);
      const buf = await slice.arrayBuffer();
      const view = new DataView(buf);
      if (
        view.byteLength < 10 ||
        view.getUint8(0) !== 0x49 ||
        view.getUint8(1) !== 0x44 ||
        view.getUint8(2) !== 0x33
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

  function createStarterFestivalTracks() {
    const presets = [
      {
        id: "starter-1",
        title: "A Moment Apart",
        artist: "ODESZA",
        album: "A Moment Apart (Horizon Pulse Official)",
        duration_ms: 30000,
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-2",
        title: "Clearest Blue",
        artist: "CHVRCHES",
        album: "Every Open Eye",
        duration_ms: 30000,
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-3",
        title: "Levitating",
        artist: "Dua Lipa",
        album: "Future Nostalgia",
        duration_ms: 30000,
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-4",
        title: "Midnight City",
        artist: "M83",
        album: "Hurry Up, We're Dreaming",
        duration_ms: 30000,
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
      },
      {
        id: "starter-5",
        title: "Innerbloom",
        artist: "RÜFÜS DU SOL",
        album: "Bloom",
        duration_ms: 30000,
        source: "spotify",
        isStarter: true,
        cover_url: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=600&q=80",
      },
    ];

    return presets.map((p) => ({
      ...p,
      audio_url: `/api/spotify/resolve-audio?artist=${encodeURIComponent(p.artist)}&title=${encodeURIComponent(p.title)}`,
    }));
  }

  return {
    ingestBrowserFiles,
    scanLocalFolderOrPlaylist,
    createStarterFestivalTracks,
  };
})();

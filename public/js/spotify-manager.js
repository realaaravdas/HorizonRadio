/**
 * Horizon Pulse Radio - Spotify Integration Manager
 * Supports:
 * 1. Instant Zero-Key Spotify Playlist / Album / Track Loader (Resolves real studio audio for every song!)
 * 2. OAuth 2.0 PKCE Authentication (Client ID only, Redirect URI: http://127.0.0.1:8080/callback)
 * 3. Spotify Web Playback SDK (In-app streaming player with smooth volume ducking)
 * 4. Spotify Connect Remote Control API Fallback
 */

window.SpotifyManager = (function () {
  const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
  ].join(" ");

  let accessToken = localStorage.getItem("horizon_spotify_access_token") || "";
  let refreshToken = localStorage.getItem("horizon_spotify_refresh_token") || "";
  let tokenExpiry = parseInt(localStorage.getItem("horizon_spotify_token_expiry") || "0", 10);
  let sdkPlayer = null;
  let sdkDeviceId = null;
  let sdkReady = false;
  let currentSdkState = null;
  let onStatusChangeCallbacks = [];

  function onStatusChange(cb) {
    onStatusChangeCallbacks.push(cb);
  }

  function notifyStatus(statusObj) {
    onStatusChangeCallbacks.forEach((cb) => {
      try {
        cb(statusObj);
      } catch (_) {}
    });
  }

  function isTokenValid() {
    return Boolean(accessToken && Date.now() < tokenExpiry - 30000);
  }

  function getRedirectUri() {
    return `${window.location.origin}/callback`;
  }

  function generateRandomString(length = 64) {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values)
      .map((x) => possible[x % possible.length])
      .join("");
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest("SHA-256", data);
  }

  function base64urlencode(buffer) {
    let str = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function startOAuthPKCE(clientId) {
    const cleanClientId = (clientId || "").trim();
    if (!cleanClientId) {
      throw new Error("Please enter your Spotify Developer Client ID in Settings first.");
    }
    localStorage.setItem("horizon_spotify_client_id", cleanClientId);

    const codeVerifier = generateRandomString(64);
    localStorage.setItem("horizon_spotify_code_verifier", codeVerifier);

    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64urlencode(hashed);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: cleanClientId,
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
      redirect_uri: getRedirectUri(),
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async function handleOAuthCallbackIfPresent() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const error = urlParams.get("error");

    if (error) {
      window.history.replaceState({}, document.title, "/");
      throw new Error(`Spotify Auth Error: ${error}`);
    }
    if (!code) {
      if (isTokenValid()) {
        initWebPlaybackSDK();
      }
      return false;
    }

    const codeVerifier = localStorage.getItem("horizon_spotify_code_verifier");
    const clientId = localStorage.getItem("horizon_spotify_client_id");
    window.history.replaceState({}, document.title, "/");

    if (!codeVerifier || !clientId) {
      throw new Error("Missing PKCE verifier or Client ID.");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    });

    const resp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await resp.json();
    if (!resp.ok || !data.access_token) {
      throw new Error(data.error_description || "Failed to exchange Spotify OAuth code");
    }

    saveTokens(data);
    initWebPlaybackSDK();
    return true;
  }

  function saveTokens(data) {
    accessToken = data.access_token;
    if (data.refresh_token) {
      refreshToken = data.refresh_token;
      localStorage.setItem("horizon_spotify_refresh_token", refreshToken);
    }
    tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    localStorage.setItem("horizon_spotify_access_token", accessToken);
    localStorage.setItem("horizon_spotify_token_expiry", String(tokenExpiry));
  }

  function disconnect() {
    accessToken = "";
    refreshToken = "";
    tokenExpiry = 0;
    sdkReady = false;
    sdkDeviceId = null;
    localStorage.removeItem("horizon_spotify_access_token");
    localStorage.removeItem("horizon_spotify_refresh_token");
    localStorage.removeItem("horizon_spotify_token_expiry");
    if (sdkPlayer) {
      try {
        sdkPlayer.disconnect();
      } catch (_) {}
      sdkPlayer = null;
    }
    notifyStatus({ connected: false, mode: "Instant Stream Mode" });
  }

  function initWebPlaybackSDK() {
    if (!isTokenValid()) return;
    if (window.Spotify && window.Spotify.Player) {
      createPlayerInstance();
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      createPlayerInstance();
    };
    if (!document.getElementById("spotify-player-sdk-script")) {
      const script = document.createElement("script");
      script.id = "spotify-player-sdk-script";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }

  function createPlayerInstance() {
    if (sdkPlayer || !window.Spotify) return;
    sdkPlayer = new window.Spotify.Player({
      name: "Horizon Pulse Radio (Amy Simpson)",
      getOAuthToken: (cb) => cb(accessToken),
      volume: 1.0,
    });

    sdkPlayer.addListener("ready", ({ device_id }) => {
      sdkDeviceId = device_id;
      sdkReady = true;
      notifyStatus({
        connected: true,
        sdkReady: true,
        deviceId: device_id,
        mode: "Web Playback SDK (Full In-App Mix)",
      });
    });

    sdkPlayer.addListener("not_ready", () => {
      sdkReady = false;
      notifyStatus({
        connected: true,
        sdkReady: false,
        mode: "Remote Control API Fallback",
      });
    });

    sdkPlayer.addListener("account_error", () => {
      sdkReady = false;
      notifyStatus({
        connected: true,
        sdkReady: false,
        mode: "Instant Stream Fallback",
      });
    });

    sdkPlayer.addListener("player_state_changed", (state) => {
      currentSdkState = state;
    });

    sdkPlayer.connect();
  }

  function parseSpotifyInput(input) {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;
    const match = trimmed.match(/(playlist|album|track)[/:]([a-zA-Z0-9]+)/i);
    if (match) {
      return { kind: match[1].toLowerCase(), id: match[2] };
    }
    if (/^[a-zA-Z0-9]{15,30}$/.test(trimmed)) {
      return { kind: "playlist", id: trimmed };
    }
    return null;
  }

  function attachAudioResolverUrl(tracks) {
    return (tracks || []).map((t) => {
      const resolveUrl = `/api/spotify/resolve-audio?artist=${encodeURIComponent(t.artist || "")}&title=${encodeURIComponent(t.title || "")}&preview=${encodeURIComponent(t.preview_url || "")}`;
      return {
        ...t,
        audio_url: resolveUrl,
        duration_ms: 30000, // Resolved stream duration when playing on Web Audio deck
        full_duration_ms: t.duration_ms || 200000,
      };
    });
  }

  async function fetchPlaylist(playlistUrlOrId) {
    const parsed = parseSpotifyInput(playlistUrlOrId);
    if (!parsed) {
      throw new Error(
        "Paste any Spotify Playlist, Album, or Track link (e.g. https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n)"
      );
    }

    if (isTokenValid() && parsed.kind === "playlist") {
      try {
        const resp = await fetch(`https://api.spotify.com/v1/playlists/${parsed.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          const playlistCover = data.images && data.images[0] ? data.images[0].url : "";
          const items = (data.tracks && data.tracks.items) || [];
          const tracks = items
            .map((item) => item && item.track)
            .filter((t) => t && t.name)
            .map((t) => ({
              id: t.id,
              uri: t.uri || `spotify:track:${t.id}`,
              title: t.name,
              artist: (t.artists || []).map((a) => a.name).join(", ") || "Unknown Artist",
              album: (t.album && t.album.name) || data.name || "Spotify",
              year: t.album && t.album.release_date ? t.album.release_date.slice(0, 4) : "",
              duration_ms: t.duration_ms || 200000,
              preview_url: t.preview_url || "",
              cover_url:
                (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) ||
                playlistCover,
              source: "spotify",
            }));

          if (tracks.length > 0) {
            return {
              id: parsed.id,
              name: data.name || "Spotify Playlist",
              cover_url: playlistCover,
              tracks: attachAudioResolverUrl(tracks),
              loadedVia: "Spotify Web API",
            };
          }
        }
      } catch (e) {
        console.warn("[SpotifyManager] Web API playlist fetch failed, using embed parser:", e);
      }
    }

    const pubResp = await fetch(
      `/api/spotify/playlist-public?id=${encodeURIComponent(parsed.id)}&kind=${encodeURIComponent(parsed.kind)}`
    );
    const pubData = await pubResp.json();
    if (!pubResp.ok || pubData.error) {
      throw new Error(pubData.error || "Could not load Spotify link.");
    }
    return {
      ...pubData,
      tracks: attachAudioResolverUrl(pubData.tracks || []),
      loadedVia: "Spotify Direct Resolver",
    };
  }

  async function fetchUserPlaylists() {
    if (!isTokenValid()) return [];
    const resp = await fetch("https://api.spotify.com/v1/me/playlists?limit=30", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.items || []).map((p) => ({
      id: p.id,
      name: p.name,
      count: p.tracks ? p.tracks.total : 0,
      cover_url: p.images && p.images[0] ? p.images[0].url : "",
    }));
  }

  async function playSpotifyTrack(track, modePreference = "auto") {
    if (!isTokenValid() || !track.uri) {
      return { playedOnSpotify: false, mode: "direct_stream" };
    }

    if (sdkReady && sdkDeviceId && modePreference !== "remote_only") {
      try {
        const resp = await fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(sdkDeviceId)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [track.uri] }),
          }
        );
        if (resp.ok || resp.status === 204) {
          return { playedOnSpotify: true, mode: "sdk" };
        }
      } catch (err) {
        console.warn("[SpotifyManager] SDK play failed, trying remote control:", err);
      }
    }

    try {
      const resp = await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [track.uri] }),
      });
      if (resp.ok || resp.status === 204) {
        return { playedOnSpotify: true, mode: "remote" };
      }
    } catch (err) {
      console.warn("[SpotifyManager] Remote control play failed:", err);
    }

    return { playedOnSpotify: false, mode: "direct_stream" };
  }

  async function setSpotifyVolume(volume0to1) {
    const clamped = Math.max(0, Math.min(1, volume0to1));
    if (sdkPlayer && sdkReady) {
      try {
        await sdkPlayer.setVolume(clamped);
        return;
      } catch (_) {}
    }
    if (isTokenValid()) {
      const pct = Math.round(clamped * 100);
      fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${pct}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  }

  async function pauseSpotify() {
    if (sdkPlayer && sdkReady) {
      try {
        await sdkPlayer.pause();
        return;
      } catch (_) {}
    }
    if (isTokenValid()) {
      fetch("https://api.spotify.com/v1/me/player/pause", {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  }

  async function resumeSpotify() {
    if (sdkPlayer && sdkReady) {
      try {
        await sdkPlayer.resume();
        return;
      } catch (_) {}
    }
    if (isTokenValid()) {
      fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  }

  return {
    startOAuthPKCE,
    handleOAuthCallbackIfPresent,
    disconnect,
    fetchPlaylist,
    fetchUserPlaylists,
    playSpotifyTrack,
    setSpotifyVolume,
    pauseSpotify,
    resumeSpotify,
    onStatusChange,
    isAuthenticated: isTokenValid,
    isSdkReady: () => sdkReady,
    getSdkState: () => currentSdkState,
  };
})();

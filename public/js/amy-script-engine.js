/**
 * Horizon Pulse Radio - Amy Simpson DJ Script & Trivia Engine
 * Combines:
 * 1. AI LLM Generation (NVIDIA NIM preferred, Ollama local, OpenAI, Google Gemini)
 * 2. Offline Rich Dynamic Script Engine (authentic Forza Horizon "Horizon Pulse" Amy Simpson
 *    templates, artist/track trivia knowledge base, festival telemetry events, and Skill Song callouts)
 */

window.AmyScriptEngine = (function () {
  const SYSTEM_PROMPT = `You are Amy Simpson, the iconic, warm, witty, and effortlessly cool host of "Horizon Pulse" radio at the Forza Horizon Festival.
Your job is to deliver a hyper-natural, engaging between-song radio DJ link transitioning from the outgoing track (or station intro) into the upcoming track.

Style Guidelines for Spoken TTS Realism:
- Speak naturally like a live FM/festival radio DJ in the booth. Use contractions ("you're", "we've", "it's", "that's").
- Include brief, genuine musical trivia, production details, or vibe commentary about the artist and song (e.g. their signature sound, era, infectious hook, bassline, or why it's the ultimate driving track).
- Weave in subtle Forza Horizon Festival flavor (cruising the coast at golden hour, hitting apexes, Horizon Festival wrist-bands, Skill Songs, or late-night highway runs) without overdoing it.
- Keep it concise: 2 to 4 sentences (roughly 40 to 70 words) so it fits smoothly over a 12-to-18 second song outro/intro crossfade.
- Output ONLY the exact spoken words Amy says. Do NOT include stage directions, asterisks, sound effect tags, emojis, or quotation marks.`;

  // Curated artist & genre trivia snippets for the rich offline engine
  const ARTIST_TRIVIA_DB = {
    "odesza": "Known for those massive cinematic drums and shimmering vocal chops, ODESZA practically defined the modern Horizon Festival sound.",
    "chvrches": "Lauren Mayberry and the Glasgow trio have been Horizon Pulse royalty since day one with their razor-sharp synth-pop hooks.",
    "dua lipa": "Blending nu-disco basslines with pure pop adrenaline, Dua Lipa knows how to turn any highway stretch into a midnight runway.",
    "daft punk": "The legendary French duo changed electronic music forever with their vocoders, analog filters, and unmistakable French touch groove.",
    "the weeknd": "With those eighties-soaked analog synths and midnight falsetto vocals, Abel Tesfaye makes every night drive feel like a movie.",
    "justice": "Gritty French electro meets arena-sized disco slap bass—Justice always brings high-voltage energy to the festival.",
    "disclosure": "The Lawrence brothers have a sixth sense for garage-inflected house beats and infectious two-step rhythms.",
    "porter robinson": "From euphoric synth worlds to emotional electronic anthems, Porter Robinson is pure Horizon nostalgia in audio form.",
    "madeon": "Hugo Leclercq packs more French house samples and technicolor synth chord progressions into three minutes than almost anyone on the planet.",
    "empire of the sun": "Luke Steele and Nick Littlemore always bring larger-than-life theatrical synth-pop that sounds like a permanent sunset.",
    "phoenix": "Versailles indie-pop perfection—Phoenix brings that effortless French rhythm guitar and punchy synth groove.",
    "tame impala": "Kevin Parker records, produces, and mixes every psychedelic layer himself, creating those lush, swirling phaser grooves.",
    "gorillaz": "Damon Albarn's genre-blending virtual collective never plays by the rules, mixing alt-rock, hip-hop, and synth-funk.",
    "kaytranada": "Nobody swings a kick drum and a bouncy synth bassline quite like KAYTRANADA.",
    "fred again..": "Turning voice notes and lived-in moments into euphoric club catharsis, Fred again.. brings pure emotion to the dancefloor.",
    "rufus du sol": "Built for wide-open desert highways and late-night festival stages, RÜFÜS DU SOL masters the slow-burning melodic build.",
    "flume": "Harley Streten pioneered that wonky, future-bass synth texture that rattled festival subwoofers around the world.",
    "mgmt": "Psychedelic synth hooks and indie sleaze charm that turn any cruise into an instant throwback.",
    "m83": "Anthony Gonzalez crafts widescreen, reverb-drenched synth walls that make sixty miles an hour feel like warp speed.",
    "new order": "Born out of Manchester's post-punk scene, New Order bridged the gap between live bass guitars and electronic dancefloor sequencers.",
    "kavinsky": "Outrun synthwave at its finest—crafted specifically for testing your rev limiter under neon streetlights."
  };

  const HORIZON_SCENARIOS = [
    "cruising down the coastal highway as the sun dips below the horizon",
    "tearing through the canyon switchbacks with the windows down",
    "weaving through neon-lit street scene traffic at midnight",
    "clocking top speed down the main festival motorway",
    "taking the scenic route past the Horizon Pulse main stage",
    "drifting through the mountain hairpins with your foot planted to the floor",
    "chasing a sunset glow across the festival tarmac"
  ];

  const BACK_ANNOUNCE_TEMPLATES = [
    "That was {prevArtist} with {prevTitle}, sounding massive right here on Horizon Pulse.",
    "You just heard {prevTitle} from {prevArtist}—always an absolute vibe on the open road.",
    "{prevArtist} there with {prevTitle}. Honestly, that track never gets old when you're behind the wheel.",
    "What a tune! {prevTitle} by {prevArtist} wrapping up on Horizon Pulse.",
    "Pure festival magic from {prevArtist} with {prevTitle}."
  ];

  const STATION_OPENERS = [
    "You're locked into Horizon Pulse! I'm Amy Simpson, and whether you're chasing apexes or just cruising with friends, I've got your soundtrack sorted.",
    "Welcome back to Horizon Pulse, I'm Amy Simpson in the studio overlooking the festival grounds, and the energy out there today is unreal.",
    "Hey there, Horizon drivers! Amy Simpson here on Horizon Pulse, mixing your favorite playlists into one non-stop festival broadcast.",
    "104.7 Horizon Pulse on your dial! I'm Amy Simpson, keeping the synths bright and the basslines rolling while you rack up those clean driving skills."
  ];

  const MUSICAL_COMMENTARY_TEMPLATES = [
    "What I love about {nextArtist} is how they layer that punchy groove with a hook that refuses to leave your head.",
    "{nextArtist} has this incredible knack for crafting tracks that feel tailor-made for {scenario}.",
    "From the moment the arrangement kicks in on this one, {nextArtist} brings a sense of momentum that makes you want to shift up a gear.",
    "If your playlist needed a shot of pure adrenaline, {nextArtist} always delivers with production that sparkles on a car stereo.",
    "There's a warmth and rhythm to {nextArtist}'s sound that fits the Horizon Pulse atmosphere like a racing glove."
  ];

  const FRONT_ANNOUNCE_TEMPLATES = [
    "Turn it up—here's {nextArtist} with {nextTitle}!",
    "Keep your eyes on the apex and the volume all the way up. This is {nextTitle} by {nextArtist}.",
    "Let's roll right into it—here is {nextArtist} with {nextTitle}, on Horizon Pulse!",
    "Hands on the wheel, let's dive into {nextTitle} from {nextArtist}.",
    "Coming through your speakers right now, it's {nextArtist} with {nextTitle}!"
  ];

  const SKILL_SONG_TEMPLATES = [
    "Wait—do you hear that alarm in the booth? You know what time it is! The next track is an official Horizon Pulse Skill Song! Every drift, near miss, and speed trap counts for double skill points while {nextArtist} plays. Here's {nextTitle}—go rack up a massive multiplier!",
    "Hold onto your steering wheel, drivers—I'm hitting the big pink Skill Song button in the studio! For the entire length of {nextTitle} by {nextArtist}, your skill chain multiplier is doubled. Don't tap any walls—let's go!"
  ];

  function pickRandom(arr, avoidIndex = -1) {
    if (!arr || arr.length === 0) return "";
    if (arr.length === 1) return arr[0];
    let idx = Math.floor(Math.random() * arr.length);
    if (idx === avoidIndex) {
      idx = (idx + 1) % arr.length;
    }
    return arr[idx];
  }

  function cleanTrackTitle(title) {
    if (!title) return "this next track";
    // Strip noisy suffixes like "(Official Video)", "[Remastered 2024]", "- Single Version"
    return title
      .replace(/\s*[\(\[][^)\]]*(official|video|audio|lyric|remaster|hd|hq|visualizer)[^)\]]*[\)\]]/gi, "")
      .replace(/\s+-\s+(remastered|single|radio edit).*$/i, "")
      .trim();
  }

  function lookupArtistTrivia(artistName) {
    if (!artistName) return null;
    const lower = artistName.toLowerCase();
    for (const [key, trivia] of Object.entries(ARTIST_TRIVIA_DB)) {
      if (lower.includes(key)) {
        return trivia;
      }
    }
    return null;
  }

  function buildOfflineScript({ prevTrack, nextTrack, isSkillSong = false, customNote = "" }) {
    const prevArtist = prevTrack ? prevTrack.artist : null;
    const prevTitle = prevTrack ? cleanTrackTitle(prevTrack.title) : null;
    const nextArtist = nextTrack ? nextTrack.artist : "a Horizon favorite";
    const nextTitle = nextTrack ? cleanTrackTitle(nextTrack.title) : "our next anthem";
    const scenario = pickRandom(HORIZON_SCENARIOS);

    if (isSkillSong && nextTrack) {
      const prefix = prevTrack
        ? pickRandom(BACK_ANNOUNCE_TEMPLATES)
            .replace("{prevArtist}", prevArtist)
            .replace("{prevTitle}", prevTitle) + " "
        : "";
      const skillBody = pickRandom(SKILL_SONG_TEMPLATES)
        .replace(/\{nextArtist\}/g, nextArtist)
        .replace(/\{nextTitle\}/g, nextTitle);
      return `${prefix}${skillBody}`.trim();
    }

    const parts = [];

    // 1. Outgoing track back-announce OR station opener
    if (prevTrack && prevTitle && prevArtist) {
      parts.push(
        pickRandom(BACK_ANNOUNCE_TEMPLATES)
          .replace(/\{prevArtist\}/g, prevArtist)
          .replace(/\{prevTitle\}/g, prevTitle)
      );
      if (Math.random() < 0.45) {
        parts.push("You're locked into Horizon Pulse with me, Amy Simpson.");
      }
    } else {
      parts.push(pickRandom(STATION_OPENERS));
    }

    // 2. Artist trivia or musical vibe bridge
    const dbTrivia = lookupArtistTrivia(nextArtist);
    if (customNote) {
      parts.push(customNote);
    } else if (dbTrivia) {
      parts.push(dbTrivia);
    } else {
      let commentary = pickRandom(MUSICAL_COMMENTARY_TEMPLATES)
        .replace(/\{nextArtist\}/g, nextArtist)
        .replace(/\{scenario\}/g, scenario);
      if (nextTrack && nextTrack.album && nextTrack.album !== "Spotify Playlist" && !nextTrack.album.toLowerCase().includes("unknown")) {
        if (Math.random() < 0.5) {
          commentary += ` Taken from ${nextTrack.album}, this cut hits the sweet spot right from the first bar.`;
        }
      }
      parts.push(commentary);
    }

    // 3. Front-announce the incoming track
    parts.push(
      pickRandom(FRONT_ANNOUNCE_TEMPLATES)
        .replace(/\{nextArtist\}/g, nextArtist)
        .replace(/\{nextTitle\}/g, nextTitle)
    );

    return parts.join(" ");
  }

  async function generateScript({ prevTrack, nextTrack, isSkillSong = false, settings = {} }) {
    const mode = settings.scriptMode || "hybrid"; // 'hybrid', 'llm_only', 'offline_only'
    const llmProvider = settings.llmProvider || "nvidia_nim";
    const apiKey = (settings.llmApiKey || "").trim();
    const model = (settings.llmModel || "").trim();
    const endpoint = (settings.llmEndpoint || "").trim();

    // Always build the rich offline script first so we can either use it as fallback or context
    const offlineFallback = buildOfflineScript({ prevTrack, nextTrack, isSkillSong });

    if (mode === "offline_only") {
      return {
        text: offlineFallback,
        source: "Offline Horizon Pulse Engine",
      };
    }

    // Check if an LLM provider can be called (Ollama doesn't need an API key; cloud providers do)
    const canCallLLM = llmProvider === "ollama" || apiKey.length > 0;
    if (!canCallLLM) {
      return {
        text: offlineFallback,
        source: "Offline Horizon Pulse Engine (No LLM Key Set)",
      };
    }

    const prevDesc = prevTrack
      ? `Previous Song: "${cleanTrackTitle(prevTrack.title)}" by ${prevTrack.artist} (${prevTrack.source === "spotify" ? "Spotify Playlist" : "Local Library"})`
      : "Previous Song: None (Station broadcast opening segment)";

    const nextDesc = nextTrack
      ? `Upcoming Song: "${cleanTrackTitle(nextTrack.title)}" by ${nextTrack.artist}${nextTrack.album ? ` (Album/Playlist: ${nextTrack.album})` : ""}`
      : "Upcoming Song: Next Horizon Pulse festival track";

    const skillDirective = isSkillSong
      ? "IMPORTANT: Announce that this upcoming song is an official 'Horizon Pulse Skill Song' where the driver earns DOUBLE Skill Points for every drift, speed trap, and near miss!"
      : "Include one cool, authentic musical detail or trivia fact about the upcoming artist/song and tie it naturally to driving at the Horizon Festival.";

    const userPrompt = `${prevDesc}
${nextDesc}
${skillDirective}
Write Amy Simpson's spoken radio transition now (40-65 words, natural spoken English for TTS):`;

    try {
      const resp = await fetch("/api/llm/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmProvider,
          apiKey,
          model,
          endpoint,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
        }),
      });

      const data = await resp.json();
      if (resp.ok && data.ok && data.text) {
        const cleaned = data.text
          .replace(/^["']|["']$/g, "")
          .replace(/\*[^*]+\*/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned.length > 15) {
          return {
            text: cleaned,
            source: `AI (${llmProvider.toUpperCase()})`,
          };
        }
      }
      throw new Error(data.error || "Empty LLM response");
    } catch (err) {
      console.warn("[AmyScriptEngine] LLM fallback to Offline Engine:", err.message);
      return {
        text: offlineFallback,
        source: "Offline Horizon Pulse Engine (Fallback)",
      };
    }
  }

  return {
    generateScript,
    buildOfflineScript,
    cleanTrackTitle,
  };
})();

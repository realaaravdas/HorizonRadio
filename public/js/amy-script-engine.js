/**
 * Horizon Pulse Radio - Amy Simpson DJ Script & Trivia Engine (High-Energy Festival Edition)
 * Combines:
 * 1. AI LLM Generation (NVIDIA NIM Llama 3.3 preferred, Ollama, OpenAI, Google Gemini)
 * 2. Offline Rich Dynamic Script Engine (authentic Forza Horizon "Horizon Pulse" Amy Simpson
 *    high-energy templates, artist/track trivia knowledge base, and Skill Song callouts)
 */

window.AmyScriptEngine = (function () {
  const SYSTEM_PROMPT = `You are Amy Simpson, the iconic, high-energy, hyped, witty, and effortlessly cool radio host of "Horizon Pulse" at the Forza Horizon Festival!
Your job is to deliver an upbeat, infectious, fast-paced between-song radio DJ link transitioning from the outgoing track into the upcoming track.

Style Guidelines for High-Energy Spoken TTS Realism:
- Sound genuinely excited and full of festival adrenaline—like you are live on-air overlooking thousands of drivers and supercars at the Horizon Festival!
- Use punchy, rhythmic sentences and exclamation points so the voice synthesizer delivers bright, energetic upward inflections ("What a tune!", "Turn it all the way up!", "Let's go!").
- Drop one cool, specific musical detail or trivia fact about the artist or song (their signature synths, infectious bassline, vocals, or why this track is pure driving fuel).
- Keep it tight and punchy: 2 to 3 sentences (roughly 35 to 55 words) so it hits hard over the song crossfade.
- Output ONLY the exact spoken words Amy says. Do NOT include stage directions, asterisks, sound effect tags, emojis, or quotation marks.`;

  const ARTIST_TRIVIA_DB = {
    "odesza": "Those massive cinematic drums and euphoric vocal chops from ODESZA practically defined the modern Horizon Festival sound!",
    "chvrches": "Lauren Mayberry and the Glasgow trio are pure Horizon Pulse royalty with those razor-sharp synth-pop hooks!",
    "dua lipa": "Blending nu-disco basslines with pure pop adrenaline, Dua Lipa turns every stretch of highway into a midnight runway!",
    "daft punk": "The legendary French duo changed dance music forever with their vocoders, analog filters, and unstoppable groove!",
    "the weeknd": "With those eighties-soaked analog synths and midnight falsetto vocals, Abel makes every night drive feel like a blockbuster movie!",
    "justice": "Gritty French electro meets arena-sized slap bass—Justice always brings high-voltage energy to the festival!",
    "disclosure": "The Lawrence brothers have a sixth sense for garage-inflected house beats and infectious rhythms!",
    "porter robinson": "From euphoric synth worlds to emotional electronic anthems, Porter Robinson is pure Horizon magic in audio form!",
    "madeon": "Hugo Leclercq packs more technicolor French house chord progressions into three minutes than almost anyone on the planet!",
    "empire of the sun": "Luke Steele and Nick Littlemore bring larger-than-life synth-pop that sounds like a permanent golden hour!",
    "phoenix": "Versailles indie-pop perfection! Phoenix always brings that effortless French rhythm and punchy synth groove!",
    "tame impala": "Kevin Parker produces and mixes every psychedelic layer himself, creating those lush, swirling phaser grooves!",
    "gorillaz": "Damon Albarn's genre-blending collective never plays by the rules, mixing alt-rock, hip-hop, and synth-funk!",
    "kaytranada": "Nobody swings a kick drum and a bouncy synth bassline quite like KAYTRANADA!",
    "fred again": "Turning lived-in moments into euphoric club catharsis, Fred again brings pure electricity to the festival!",
    "rufus du sol": "Built for wide-open desert highways and mainstage lasers, RÜFÜS DU SOL masters the euphoric melodic build!",
    "flume": "Harley Streten pioneered that future-bass synth bounce that rattled festival subwoofers around the world!",
    "m83": "Anthony Gonzalez crafts widescreen, reverb-drenched synth walls that make sixty miles an hour feel like warp speed!",
    "sara landry": "High-octane festival energy! Sara Landry is cranking the tempo all the way into the red zone!",
    "kettama": "Pure club-ready euphoria—KETTAMA knows exactly how to keep the festival floor moving!"
  };

  const HORIZON_SCENARIOS = [
    "blasting down the coastal highway at golden hour",
    "throwing it sideways through the canyon switchbacks",
    "weaving through neon-lit street scene traffic at midnight",
    "redlining in top gear down the main festival motorway",
    "flying past the Horizon Pulse mainstage with the roof down"
  ];

  const BACK_ANNOUNCE_TEMPLATES = [
    "What a tune! That was {prevArtist} with {prevTitle}, sounding huge right here on Horizon Pulse!",
    "Oh, I love that track! You just heard {prevTitle} from {prevArtist}!",
    "{prevArtist} there with {prevTitle}—pure festival fuel when your foot is planted to the floor!",
    "Absolute magic from {prevArtist} with {prevTitle} wrapping up on Horizon Pulse!"
  ];

  const STATION_OPENERS = [
    "What is up, Horizon drivers! I'm Amy Simpson, you're locked into Horizon Pulse, and the energy out at the festival today is off the charts!",
    "Welcome back to 104.7 Horizon Pulse! I'm Amy Simpson in the booth, and we are turning the volume all the way up right now!",
    "Hey there, Horizon Festival! Amy Simpson here on Horizon Pulse, mixing your favorite tracks into one non-stop high-speed broadcast!"
  ];

  const MUSICAL_COMMENTARY_TEMPLATES = [
    "Up next, {nextArtist} brings a groove that is practically built for {scenario}!",
    "I cannot get enough of the energy {nextArtist} packs into this production—it makes you want to shift straight into top gear!",
    "If you needed a shot of pure festival adrenaline, {nextArtist} is about to light up your stereo!"
  ];

  const FRONT_ANNOUNCE_TEMPLATES = [
    "Crank it up—here is {nextArtist} with {nextTitle}! Let's go!",
    "Eyes on the apex and volume to the max! Here's {nextTitle} by {nextArtist}!",
    "Let's roll right into it! This is {nextArtist} with {nextTitle}, live on Horizon Pulse!"
  ];

  const SKILL_SONG_TEMPLATES = [
    "Wait—do you hear that siren in the booth?! It is Skill Song time on Horizon Pulse! Every drift, near miss, and speed trap counts for DOUBLE skill points while {nextArtist} plays! Crank up {nextTitle} and go rack up a massive multiplier!",
    "Hold onto your steering wheel, drivers—I am smashing the pink Skill Song button right now! For the entire length of {nextTitle} by {nextArtist}, your skill chain is doubled! Don't tap any walls—let's go!"
  ];

  function pickRandom(arr) {
    if (!arr || arr.length === 0) return "";
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function cleanTrackTitle(title) {
    if (!title) return "this next anthem";
    return title
      .replace(/\s*[\(\[][^)\]]*(official|video|audio|lyric|remaster|hd|hq|visualizer|horizon festival edit|coastal sunset mix|midnight canyon run|apex showcase vip|horizon baja sunrise)[^)\]]*[\)\]]/gi, "")
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

  function buildOfflineScript({ prevTrack, nextTrack, isSkillSong = false }) {
    const prevArtist = prevTrack ? prevTrack.artist : null;
    const prevTitle = prevTrack ? cleanTrackTitle(prevTrack.title) : null;
    const nextArtist = nextTrack ? nextTrack.artist : "a Horizon favorite";
    const nextTitle = nextTrack ? cleanTrackTitle(nextTrack.title) : "our next anthem";
    const scenario = pickRandom(HORIZON_SCENARIOS);

    if (isSkillSong && nextTrack) {
      const prefix = prevTrack
        ? pickRandom(BACK_ANNOUNCE_TEMPLATES)
            .replace(/\{prevArtist\}/g, prevArtist)
            .replace(/\{prevTitle\}/g, prevTitle) + " "
        : "";
      const skillBody = pickRandom(SKILL_SONG_TEMPLATES)
        .replace(/\{nextArtist\}/g, nextArtist)
        .replace(/\{nextTitle\}/g, nextTitle);
      return `${prefix}${skillBody}`.trim();
    }

    const parts = [];
    if (prevTrack && prevTitle && prevArtist) {
      parts.push(
        pickRandom(BACK_ANNOUNCE_TEMPLATES)
          .replace(/\{prevArtist\}/g, prevArtist)
          .replace(/\{prevTitle\}/g, prevTitle)
      );
    } else {
      parts.push(pickRandom(STATION_OPENERS));
    }

    const dbTrivia = lookupArtistTrivia(nextArtist);
    if (dbTrivia) {
      parts.push(dbTrivia);
    } else {
      parts.push(
        pickRandom(MUSICAL_COMMENTARY_TEMPLATES)
          .replace(/\{nextArtist\}/g, nextArtist)
          .replace(/\{scenario\}/g, scenario)
      );
    }

    parts.push(
      pickRandom(FRONT_ANNOUNCE_TEMPLATES)
        .replace(/\{nextArtist\}/g, nextArtist)
        .replace(/\{nextTitle\}/g, nextTitle)
    );

    return parts.join(" ");
  }

  async function generateScript({ prevTrack, nextTrack, isSkillSong = false, settings = {} }) {
    const mode = settings.scriptMode || "hybrid";
    const llmProvider = settings.llmProvider || "nvidia_nim";
    const apiKey = (settings.llmApiKey || settings.rivaApiKey || "").trim();
    const model = (settings.llmModel || "").trim();
    const endpoint = (settings.llmEndpoint || "").trim();

    const offlineFallback = buildOfflineScript({ prevTrack, nextTrack, isSkillSong });

    if (mode === "offline_only") {
      return {
        text: offlineFallback,
        source: "Offline Horizon Pulse Engine",
      };
    }

    const prevDesc = prevTrack
      ? `Outgoing Song: "${cleanTrackTitle(prevTrack.title)}" by ${prevTrack.artist}`
      : "Outgoing Song: None (Opening the Horizon Pulse broadcast!)";

    const nextDesc = nextTrack
      ? `Upcoming Song: "${cleanTrackTitle(nextTrack.title)}" by ${nextTrack.artist}`
      : "Upcoming Song: Next Horizon Pulse festival anthem";

    const skillDirective = isSkillSong
      ? "IMPORTANT: Hype up that this upcoming song is an official 'Horizon Pulse Skill Song' where the driver earns DOUBLE Skill Points!"
      : "Include one energetic, fun fact or musical vibe comment about the upcoming artist/song and hype the driver up!";

    const userPrompt = `${prevDesc}
${nextDesc}
${skillDirective}
Write Amy Simpson's high-energy spoken radio link now (35-55 words, punchy sentences with exclamation points for upbeat TTS delivery):`;

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
        source: "Offline Horizon Pulse Engine",
      };
    }
  }

  return {
    generateScript,
    buildOfflineScript,
    cleanTrackTitle,
  };
})();

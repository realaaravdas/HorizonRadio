/**
 * Horizon Pulse Radio - Lightweight Procedural Audio-Reactive Visualizer
 * 4 Real-Time Procedural Modes (Zero external dependencies, <1ms/frame):
 * 1. "highway" - 3D Perspective Horizon Highway Grid, Beat-Reactive Sun, Mountain Silhouettes & Starfield
 * 2. "reactor" - 360° Radial Frequency Core with Beat Shockwave Rings & Orbital Particles
 * 3. "aurora"  - Multi-Layer Harmonic Sine Wave Ribbons + Voice Telemetry Wave
 * 4. "bars"    - 64-Band Festival Spectrum Analyzer with Peak-Hold & Rising Bass Embers
 */

window.HorizonProceduralVisualizer = (function () {
  let canvas = null;
  let ctx = null;
  let mode = "highway"; // 'highway' | 'reactor' | 'aurora' | 'bars'

  // Procedural state (lightweight fixed-size pools)
  let gridOffset = 0;
  let phase = 0;
  let smoothedBass = 0;
  let smoothedMid = 0;
  let smoothedHigh = 0;
  let smoothedVoice = 0;
  let prevBass = 0;

  const stars = Array.from({ length: 55 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.55,
    size: 0.8 + Math.random() * 1.8,
    twinkle: Math.random() * Math.PI * 2,
  }));

  const particles = Array.from({ length: 42 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.002,
    vy: -0.002 - Math.random() * 0.004,
    size: 1.5 + Math.random() * 2.5,
    hue: Math.random() > 0.5 ? 330 : 190,
  }));

  const shockwaves = [];
  const peakCaps = new Float32Array(64);

  function init(canvasElement, initialMode = "highway") {
    canvas = canvasElement;
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    mode = initialMode || "highway";
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    }
  }

  function setMode(newMode) {
    mode = newMode;
  }

  function getMode() {
    return mode;
  }

  function computeBands(musicFreq, voiceFreq, isPlaying) {
    let bass = 0;
    let mid = 0;
    let high = 0;
    let voice = 0;

    if (musicFreq && musicFreq.length > 0) {
      // Sub-bass & kick (bins 0..7)
      for (let i = 0; i < 8; i++) bass += musicFreq[i];
      bass /= 8 * 255;

      // Mids (bins 8..28)
      for (let i = 8; i < 28; i++) mid += musicFreq[i];
      mid /= 20 * 255;

      // Highs (bins 28..56)
      const end = Math.min(56, musicFreq.length);
      for (let i = 28; i < end; i++) high += musicFreq[i];
      high /= Math.max(1, end - 28) * 255;
    } else if (isPlaying) {
      // Ambient procedural pulse if streaming on an external Spotify Connect device
      const t = performance.now() * 0.004;
      bass = 0.35 + 0.25 * Math.pow(Math.sin(t * 2.1), 4);
      mid = 0.28 + 0.18 * Math.sin(t * 1.3 + 1);
      high = 0.2 + 0.15 * Math.cos(t * 2.7);
    } else {
      // Gentle idle breathing
      const t = performance.now() * 0.0015;
      bass = 0.08 + 0.04 * Math.sin(t);
      mid = 0.06 + 0.03 * Math.cos(t * 0.8);
      high = 0.04;
    }

    if (voiceFreq && voiceFreq.length > 0) {
      for (let i = 0; i < voiceFreq.length; i++) voice += voiceFreq[i];
      voice /= voiceFreq.length * 255;
    }

    // Smooth envelopes for fluid 60fps response
    smoothedBass += (bass - smoothedBass) * 0.28;
    smoothedMid += (mid - smoothedMid) * 0.22;
    smoothedHigh += (high - smoothedHigh) * 0.25;
    smoothedVoice += (voice - smoothedVoice) * 0.32;

    // Detect kick transient to spawn a shockwave ring
    if (smoothedBass - prevBass > 0.085 && smoothedBass > 0.42 && shockwaves.length < 6) {
      shockwaves.push({ radius: 0.08, alpha: 0.85 });
    }
    prevBass = smoothedBass;
  }

  function drawHighwayScene(w, h, musicFreq, voiceFreq) {
    const horizonY = h * 0.54;

    // 1. Deep night-drive sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, "#050611");
    skyGrad.addColorStop(0.55, "#140b29");
    skyGrad.addColorStop(1, `rgba(255, 31, 143, ${0.28 + smoothedBass * 0.35})`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // 2. Twinkling procedural starfield
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const alpha = 0.35 + 0.55 * Math.sin(phase * 1.5 + s.twinkle) + smoothedHigh * 0.3;
      ctx.fillStyle = `rgba(220, 242, 255, ${Math.min(1, alpha)})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.size * (1 + smoothedHigh * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Beat-reactive Horizon Sunset Sun
    const sunRadius = Math.min(w, h) * (0.21 + smoothedBass * 0.075);
    const sunCenterX = w * 0.5;
    const sunCenterY = horizonY - sunRadius * 0.22;

    ctx.save();
    const sunGrad = ctx.createLinearGradient(0, sunCenterY - sunRadius, 0, sunCenterY + sunRadius);
    sunGrad.addColorStop(0, "#00e5ff");
    sunGrad.addColorStop(0.42, "#ff7538");
    sunGrad.addColorStop(1, "#ff1f8f");
    ctx.fillStyle = sunGrad;
    ctx.shadowColor = "#ff1f8f";
    ctx.shadowBlur = 24 + smoothedBass * 28;
    ctx.beginPath();
    ctx.arc(sunCenterX, sunCenterY, sunRadius, Math.PI, 0, false);
    ctx.lineTo(sunCenterX + sunRadius, horizonY);
    ctx.lineTo(sunCenterX - sunRadius, horizonY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Retro scanline cutouts across the lower sun
    ctx.fillStyle = "#110922";
    for (let s = 0; s < 5; s++) {
      const sliceY = horizonY - (s + 1) * (sunRadius * 0.14);
      const sliceH = Math.max(1.5, (5 - s) * 1.4);
      ctx.fillRect(sunCenterX - sunRadius - 2, sliceY, sunRadius * 2 + 4, sliceH);
    }

    // 4. Procedural Audio-Reactive Mountain Silhouettes along the horizon
    ctx.fillStyle = "#090b18";
    ctx.strokeStyle = `rgba(0, 229, 255, ${0.45 + smoothedMid * 0.45})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    const segments = 36;
    for (let i = 0; i <= segments; i++) {
      const px = (i / segments) * w;
      const centerDist = Math.abs(i / segments - 0.5) * 2; // Valley in the center for the road
      const valleyMask = Math.pow(centerDist, 1.35);
      const binVal = musicFreq ? musicFreq[(i * 2) % musicFreq.length] / 255 : smoothedMid;
      const mountainH = (18 + Math.sin(i * 0.9) * 12 + binVal * 42) * valleyMask;
      ctx.lineTo(px, horizonY - mountainH);
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 5. 3D Perspective Highway Grid
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, "#120924");
    groundGrad.addColorStop(1, "#05060f");
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Perspective radial lines from vanishing point
    ctx.strokeStyle = `rgba(255, 31, 143, ${0.28 + smoothedBass * 0.4})`;
    ctx.lineWidth = 1.4;
    const numRays = 16;
    for (let i = -numRays; i <= numRays; i++) {
      ctx.beginPath();
      ctx.moveTo(sunCenterX + i * (w * 0.012), horizonY);
      ctx.lineTo(sunCenterX + i * (w * 0.16), h);
      ctx.stroke();
    }

    // Scrolling horizontal perspective bars (speed scales with bass!)
    gridOffset = (gridOffset + 0.014 + smoothedBass * 0.042) % 1;
    const numHoriz = 10;
    for (let j = 0; j < numHoriz; j++) {
      const norm = (j + gridOffset) / numHoriz;
      const yPos = horizonY + Math.pow(norm, 2.35) * (h - horizonY);
      const alpha = Math.min(0.85, norm * (0.45 + smoothedBass * 0.5));
      ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
      ctx.lineWidth = 1 + norm * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(w, yPos);
      ctx.stroke();
    }

    // 6. Amy Simpson Live Voice Telemetry Ribbon in the Sky (when speaking)
    if (smoothedVoice > 0.04 && voiceFreq) {
      ctx.save();
      ctx.strokeStyle = "#00f5d4";
      ctx.shadowColor = "#00f5d4";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      const vyBase = h * 0.22;
      for (let i = 0; i < voiceFreq.length; i++) {
        const vx = (i / (voiceFreq.length - 1)) * w;
        const offset = ((voiceFreq[i] / 255) - 0.4) * (h * 0.22) * Math.sin(phase * 3 + i * 0.5);
        if (i === 0) ctx.moveTo(vx, vyBase + offset);
        else ctx.lineTo(vx, vyBase + offset);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawReactorScene(w, h, musicFreq, voiceFreq) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const minDim = Math.min(w, h);
    const baseR = minDim * (0.22 + smoothedBass * 0.09);

    // Background radial glow
    const bg = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, minDim * 0.65);
    bg.addColorStop(0, `rgba(255, 31, 143, ${0.22 + smoothedBass * 0.35})`);
    bg.addColorStop(0.5, `rgba(0, 229, 255, ${0.08 + smoothedMid * 0.18})`);
    bg.addColorStop(1, "rgba(7, 8, 16, 0.95)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Expanding Beat Shockwaves
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const sw = shockwaves[i];
      sw.radius += 0.018 + smoothedBass * 0.02;
      sw.alpha *= 0.94;
      if (sw.alpha < 0.03) {
        shockwaves.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(0, 229, 255, ${sw.alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, sw.radius * minDim, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Symmetrical 360-degree Frequency Rays
    const numSpokes = 64;
    for (let i = 0; i < numSpokes; i++) {
      const angle = (i / numSpokes) * Math.PI * 2 + phase * 0.25;
      const mirrorIdx = i < numSpokes / 2 ? i : numSpokes - 1 - i;
      const val = musicFreq
        ? musicFreq[mirrorIdx % musicFreq.length] / 255
        : 0.25 + 0.2 * Math.sin(phase * 2 + i * 0.3);

      const innerR = baseR;
      const outerR = baseR + val * (minDim * 0.24);

      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * outerR;
      const y2 = cy + Math.sin(angle) * outerR;

      ctx.strokeStyle = i % 2 === 0 ? "#ff1f8f" : "#00e5ff";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Inner Reactor Core & Amy Voice Modulation Ring
    ctx.strokeStyle = smoothedVoice > 0.05 ? "#00f5d4" : "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = smoothedVoice > 0.05 ? 3.5 : 2;
    ctx.beginPath();
    for (let a = 0; a <= 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      const vMod =
        voiceFreq && smoothedVoice > 0.05
          ? (voiceFreq[a % voiceFreq.length] / 255) * (minDim * 0.07)
          : 0;
      const r = baseR * 0.72 + vMod;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function drawAuroraScene(w, h, musicFreq, voiceFreq) {
    ctx.fillStyle = "rgba(7, 9, 18, 0.92)";
    ctx.fillRect(0, 0, w, h);

    const layers = [
      { color: "rgba(255, 31, 143, 0.55)", amp: smoothedBass, speed: 1.2, yOffset: 0.62, freq: 2.2 },
      { color: "rgba(255, 117, 56, 0.45)", amp: smoothedMid, speed: -0.9, yOffset: 0.54, freq: 3.1 },
      { color: "rgba(0, 229, 255, 0.52)", amp: smoothedHigh, speed: 1.5, yOffset: 0.46, freq: 4.0 },
      { color: "rgba(0, 245, 212, 0.75)", amp: smoothedVoice * 1.4, speed: 2.4, yOffset: 0.35, freq: 5.5 },
    ];

    layers.forEach((layer, idx) => {
      ctx.beginPath();
      const baseY = h * layer.yOffset;
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = ratio * w;
        const binBoost =
          musicFreq && idx < 3
            ? (musicFreq[(i + idx * 8) % musicFreq.length] / 255) * (h * 0.16)
            : 0;
        const wave =
          Math.sin(ratio * Math.PI * layer.freq + phase * layer.speed) *
          (14 + layer.amp * (h * 0.25) + binBoost * 0.4);
        const y = baseY + wave;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = 3.2;
      ctx.stroke();

      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = layer.color.replace(/[\d.]+\)$/, "0.12)");
      ctx.fill();
    });
  }

  function drawBarsScene(w, h, musicFreq, voiceFreq) {
    ctx.fillStyle = "rgba(7, 9, 18, 0.92)";
    ctx.fillRect(0, 0, w, h);

    // Floating bass embers
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x = (p.x + p.vx + 1) % 1;
      p.y += p.vy * (1 + smoothedBass * 3.5);
      if (p.y < 0) p.y = 1;
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${0.25 + smoothedBass * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, p.size * (1 + smoothedBass), 0, Math.PI * 2);
      ctx.fill();
    }

    const bars = 56;
    const gap = 3;
    const barWidth = Math.max(2, (w - bars * gap) / bars);

    for (let i = 0; i < bars; i++) {
      let norm = 0.06;
      if (musicFreq) {
        norm = Math.max(0.06, musicFreq[i % musicFreq.length] / 255);
      } else {
        norm = 0.12 + 0.15 * Math.sin(phase * 2 + i * 0.25) * smoothedBass;
      }

      const barH = norm * (h * 0.84);
      if (barH > peakCaps[i]) {
        peakCaps[i] = barH;
      } else {
        peakCaps[i] = Math.max(4, peakCaps[i] - 1.2);
      }

      const x = i * (barWidth + gap);
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "#ff1f8f");
      grad.addColorStop(0.55, "#ff7538");
      grad.addColorStop(1, "#00e5ff");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, h - barH, barWidth, barH, 3);
      ctx.fill();

      // Peak hold cap
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, Math.max(2, h - peakCaps[i] - 4), barWidth, 2.5);

      // Voice overlay bar
      if (voiceFreq && smoothedVoice > 0.04) {
        const vH = (voiceFreq[i % voiceFreq.length] / 255) * (h * 0.88);
        ctx.fillStyle = "rgba(0, 245, 212, 0.9)";
        ctx.fillRect(x, h - vH, barWidth, 5);
      }
    }
  }

  function loop() {
    if (canvas && ctx) {
      const w = canvas.width;
      const h = canvas.height;
      phase += 0.032;

      const musicFreq = window.HorizonRadioMixer ? window.HorizonRadioMixer.getMasterFrequencyData() : null;
      const voiceFreq = window.HorizonTTSEngine ? window.HorizonTTSEngine.getVoiceFrequencyData() : null;
      const isPlaying = window.HorizonRadioMixer ? window.HorizonRadioMixer.isPlaying() : false;

      computeBands(musicFreq, voiceFreq, isPlaying);

      if (mode === "highway") {
        drawHighwayScene(w, h, musicFreq, voiceFreq);
      } else if (mode === "reactor") {
        drawReactorScene(w, h, musicFreq, voiceFreq);
      } else if (mode === "aurora") {
        drawAuroraScene(w, h, musicFreq, voiceFreq);
      } else {
        drawBarsScene(w, h, musicFreq, voiceFreq);
      }
    }
    requestAnimationFrame(loop);
  }

  return {
    init,
    setMode,
    getMode,
    resizeCanvas,
  };
})();

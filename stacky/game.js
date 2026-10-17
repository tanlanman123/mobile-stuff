(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $('hud'), score: $('score'), combo: $('combo'),
    menu: $('menu'), menuBest: $('menu-best'),
    over: $('over'), final: $('final'), newBest: $('new-best'), overBest: $('over-best'), rank: $('rank'),
  };

  // ---- Persistence (best score) ----
  const BEST_KEY = 'stacky.best';
  const loadBest = () => { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* ignore */ } };
  let best = loadBest();

  // ---- Sizing ----
  let W = 0, H = 0, dpr = 1;
  let blockH = 28, baseW = 240, groundY = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    blockH = Math.max(22, Math.min(36, H / 26));
    groundY = H * 0.62;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Audio ----
  let audio = null;
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.18) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch { /* audio unavailable */ }
  }
  const buzz = (ms) => { if (navigator.vibrate) navigator.vibrate(ms); };
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

  // ---- Game state ----
  let state = 'menu';        // 'menu' | 'playing' | 'over'
  let stack = [];            // { x, w, hue }
  let current = null;        // { x, w, dir, hue }
  let debris = [];           // falling cut-offs
  let sparks = [];           // perfect-drop particles
  let rings = [];            // perfect-drop outlines
  let score = 0, combo = 0;
  let camY = 0;              // world height scrolled
  let zoom = 1;              // zooms out on game over to show the tower
  let hueBase = Math.random() * 360;
  let overAt = 0;
  let shake = 0;

  const hueFor = (i) => (hueBase + i * 7) % 360;
  const color = (hue, l = 60) => `hsl(${hue}, 70%, ${l}%)`;

  function reset() {
    baseW = Math.min(W * 0.62, 320);
    hueBase = Math.random() * 360;
    stack = [];
    for (let i = 0; i < 4; i++) stack.push({ x: (W - baseW) / 2, w: baseW, hue: hueFor(i - 4) });
    debris = []; sparks = []; rings = [];
    score = 0; combo = 0; camY = 0; zoom = 1;
    ui.score.textContent = '0';
    ui.combo.classList.remove('show');
    spawn();
  }

  function speed() {
    const s = W / 400;
    return Math.min(170 + score * 7, 520) * Math.max(0.8, s);
  }

  function spawn() {
    const top = stack[stack.length - 1];
    const fromLeft = stack.length % 2 === 0;
    current = {
      x: fromLeft ? top.x - top.w - 16 : top.x + top.w + 16,
      w: top.w,
      dir: fromLeft ? 1 : -1,
      hue: hueFor(stack.length),
    };
  }

  function place() {
    const top = stack[stack.length - 1];
    const cur = current;
    const left = Math.max(cur.x, top.x);
    const right = Math.min(cur.x + cur.w, top.x + top.w);
    const overlap = right - left;
    const level = stack.length;

    if (overlap <= 0) {
      dropDebris(cur.x, cur.w, level, cur.hue, cur.dir * 60);
      current = null;
      gameOver();
      return;
    }

    const tolerance = Math.max(4, W * 0.012);
    if (Math.abs(cur.x - top.x) <= tolerance) {
      combo++;
      let w = top.w, x = top.x;
      if (combo >= 3 && w < baseW) {
        const grow = Math.min(10, baseW - w);
        w += grow;
        x -= grow / 2;
      }
      stack.push({ x, w, hue: cur.hue });
      perfectFx(x, w, level, cur.hue);
      tone(440 * Math.pow(2, SCALE[Math.min(combo - 1, SCALE.length - 1)] / 12), 0.18, 'triangle', 0.22);
      buzz(15);
    } else {
      combo = 0;
      if (cur.x < top.x) dropDebris(cur.x, top.x - cur.x, level, cur.hue, -80);
      else dropDebris(right, cur.x + cur.w - right, level, cur.hue, 80);
      stack.push({ x: left, w: overlap, hue: cur.hue });
      tone(220 + Math.min(score, 40) * 4, 0.08, 'square', 0.08);
      buzz(8);
    }

    score++;
    ui.score.textContent = String(score);
    if (combo >= 2) {
      ui.combo.textContent = `PERFECT ×${combo}`;
      ui.combo.style.color = color(cur.hue, 75);
      ui.combo.classList.add('show');
    } else if (combo === 1) {
      ui.combo.textContent = 'PERFECT';
      ui.combo.style.color = color(cur.hue, 75);
      ui.combo.classList.add('show');
    } else {
      ui.combo.classList.remove('show');
    }
    spawn();
  }

  function dropDebris(x, w, level, hue, vx) {
    if (w <= 0.5) return;
    debris.push({ x, y: level * blockH, w, h: blockH, vx, vy: 0, rot: 0, vr: (vx > 0 ? 1 : -1) * (1 + Math.random() * 2), hue });
  }

  function perfectFx(x, w, level, hue) {
    rings.push({ x, y: level * blockH, w, h: blockH, t: 0, hue });
    for (let i = 0; i < 14; i++) {
      sparks.push({
        x: x + Math.random() * w, y: level * blockH + blockH,
        vx: (Math.random() - 0.5) * 220, vy: 120 + Math.random() * 260,
        life: 0.6 + Math.random() * 0.4, t: 0, hue,
      });
    }
  }

  function rankFor(s) {
    if (s >= 100) return 'Okay, you win. Unreal.';
    if (s >= 60) return 'Tower architect. Seriously impressive.';
    if (s >= 40) return 'Steady hands. You beat my game.';
    if (s >= 25) return 'Solid. Now go for 40.';
    if (s >= 12) return 'Not bad! Warming up.';
    return 'Ouch. Run it back.';
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    shake = 10;
    tone(110, 0.45, 'sawtooth', 0.15);
    buzz([30, 40, 60]);
    const isBest = score > best;
    if (isBest) { best = score; saveBest(best); }
    ui.final.textContent = String(score);
    ui.overBest.textContent = String(best);
    ui.newBest.classList.toggle('hidden', !isBest || score === 0);
    ui.rank.textContent = rankFor(score);
    ui.combo.classList.remove('show');
    setTimeout(() => {
      if (state !== 'over') return;
      ui.hud.classList.add('hidden');
      ui.over.classList.remove('hidden');
    }, 650);
  }

  function start() {
    reset();
    state = 'playing';
    ui.menu.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.hud.classList.remove('hidden');
  }

  function onTap(e) {
    if (e) e.preventDefault();
    if (state === 'menu') start();
    else if (state === 'playing') place();
    else if (state === 'over' && performance.now() - overAt > 900) start();
  }

  canvas.addEventListener('pointerdown', onTap);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) onTap(e); }
  });

  // ---- Update ----
  function update(dt) {
    if (state !== 'over' && current) {
      current.x += current.dir * speed() * dt;
      // Slide just far enough past the tower on each side to be a clean miss.
      const top = stack[stack.length - 1];
      const minX = top.x - current.w - 16;
      const maxX = top.x + top.w + 16;
      if (current.x < minX) { current.x = minX; current.dir = 1; }
      if (current.x > maxX) { current.x = maxX; current.dir = -1; }
    }

    let camTarget = Math.max(0, (stack.length + 1) * blockH - groundY * 0.55);
    let zoomTarget = 1;
    if (state === 'over') {
      camTarget = 0;
      zoomTarget = Math.min(1, (groundY - H * 0.12) / ((stack.length + 1) * blockH));
    }
    const ease = Math.min(1, dt * (state === 'over' ? 2.5 : 6));
    camY += (camTarget - camY) * ease;
    zoom += (zoomTarget - zoom) * ease;

    for (const d of debris) {
      d.vy -= 2200 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
    }
    debris = debris.filter((d) => d.y > camY - (H - groundY) / zoom - 200);

    for (const s of sparks) {
      s.t += dt;
      s.vy -= 600 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    sparks = sparks.filter((s) => s.t < s.life);

    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < 0.5);

    shake = Math.max(0, shake - dt * 30);
  }

  // ---- Render ----
  const sy = (worldY) => groundY - (worldY - camY);

  function drawBlock(x, worldY, w, hue, alpha = 1) {
    const y = sy(worldY) - blockH;
    const lip = Math.max(4, blockH * 0.22);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color(hue, 55);
    ctx.fillRect(x, y + lip, w, blockH - lip);
    ctx.fillStyle = color(hue, 70);
    ctx.fillRect(x, y, w, lip);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, y + blockH - 3, w, 3);
    ctx.globalAlpha = 1;
  }

  function render() {
    const topHue = hueFor(stack.length);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `hsl(${(topHue + 200) % 360}, 45%, 16%)`);
    bg.addColorStop(1, `hsl(${(topHue + 160) % 360}, 50%, 30%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.translate(W / 2, groundY);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -groundY);

    // Pillar under the base so the tower doesn't float.
    const base = stack[0];
    if (base) {
      const top = sy(0);
      ctx.fillStyle = color(base.hue, 30);
      ctx.fillRect(base.x, top, base.w, (H - top) / zoom + 20);
    }

    const firstVisible = Math.max(0, Math.floor((camY - (H - groundY) / zoom) / blockH) - 1);
    for (let i = firstVisible; i < stack.length; i++) {
      const b = stack[i];
      drawBlock(b.x, i * blockH, b.w, b.hue);
    }

    if (state !== 'over' && current) drawBlock(current.x, stack.length * blockH, current.w, current.hue);

    for (const r of rings) {
      const p = r.t / 0.5;
      const grow = p * 14;
      ctx.strokeStyle = `rgba(255,255,255,${1 - p})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - grow, sy(r.y) - blockH - grow, r.w + grow * 2, blockH + grow * 2);
    }

    for (const d of debris) {
      ctx.save();
      ctx.translate(d.x + d.w / 2, sy(d.y) - d.h / 2);
      ctx.rotate(d.rot);
      ctx.fillStyle = color(d.hue, 55);
      ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      ctx.fillStyle = color(d.hue, 70);
      ctx.fillRect(-d.w / 2, -d.h / 2, d.w, Math.max(4, d.h * 0.22));
      ctx.restore();
    }

    for (const s of sparks) {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = color(s.hue, 80);
      ctx.fillRect(s.x - 2, sy(s.y) - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- Loop ----
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  ui.menuBest.textContent = String(best);
  reset();
  requestAnimationFrame(frame);
})();

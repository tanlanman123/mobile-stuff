(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $('hud'), score: $('score'), hearts: $('hearts'),
    menu: $('menu'), menuBest: $('menu-best'),
    pauseBtn: $('pause'), paused: $('paused'), pausedScore: $('paused-score'),
    over: $('over'), final: $('final'), newBest: $('new-best'), overBest: $('over-best'), stats: $('stats'),
  };

  // ---- Persistence ----
  const BEST_KEY = 'lasso.best';
  const loadBest = () => { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* ignore */ } };
  let best = loadBest();
  ui.menuBest.textContent = best;

  // ---- Tuning ----
  const COLORS = ['#4de1ff', '#b86bff', '#5dff8f', '#ff9b3d'];
  const GOLD = '#ffd84d';
  const PINK = '#ff5c9a';
  const MINE = '#ff4a4a';
  const START_HEARTS = 3;
  const MAX_HEARTS = 5;

  // ---- Canvas sizing ----
  let W = 0, H = 0, DPR = 1, S = 1; // S = scale relative to a 400px wide phone
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.max(0.75, Math.min(1.4, Math.min(W, H) / 400));
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Sound (tiny synth, no files) ----
  let audio = null;
  function ensureAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, delay = 0, slide = 0) {
    if (!audio) return;
    const t = audio.currentTime + delay;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const NOTES = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319, 1568];
  const sfx = {
    catch(n) { for (let i = 0; i < Math.min(n, NOTES.length); i++) tone(NOTES[i], 0.18, 'triangle', 0.1, i * 0.05); },
    mixed() { tone(330, 0.15, 'square', 0.05); tone(262, 0.2, 'square', 0.05, 0.07); },
    boom() { tone(160, 0.5, 'sawtooth', 0.16, 0, 0.2); tone(90, 0.6, 'square', 0.1, 0.03, 0.3); },
    snap() { tone(900, 0.12, 'square', 0.05, 0, 0.4); },
    lost() { tone(440, 0.3, 'sine', 0.1, 0, 0.5); },
    heal() { tone(660, 0.12, 'sine', 0.1); tone(990, 0.2, 'sine', 0.1, 0.08); },
  };
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } };

  // ---- Glow sprites (pre-rendered so we don't need shadowBlur every frame) ----
  const spriteCache = new Map();
  function glowSprite(color) {
    if (spriteCache.has(color)) return spriteCache.get(color);
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + 'aa');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    spriteCache.set(color, c);
    return c;
  }

  // ---- State ----
  let state = 'menu'; // menu | play | paused | over
  let orbs = [];
  let particles = [];
  let popups = [];
  let flashes = []; // captured loop shapes fading out
  let trail = [];   // {x, y}
  let drawing = false;
  let score = 0, hearts = START_HEARTS, time = 0, spawnTimer = 0;
  let bestLoop = 0, caught = 0, streak = 0;
  let shake = 0, redFlash = 0;
  let overAt = 0;
  let graceUntil = 0; // after losing a heart to a fading orb, a short window where more fades are free

  const inkLength = () => Math.min(W, H) * 2.2;

  function difficulty() {
    // 0 at start, ~1 after about 2 minutes, keeps creeping after that.
    return time / 120;
  }

  function colorCount() {
    return time < 25 ? 3 : 4;
  }

  function resetGame() {
    orbs = []; particles = []; popups = []; flashes = []; trail = [];
    score = 0; hearts = START_HEARTS; time = 0; spawnTimer = 0.2; graceUntil = 0;
    bestLoop = 0; caught = 0; streak = 0; shake = 0; redFlash = 0;
    // Open with a friendly cluster so the first loop is easy.
    spawnCluster(0, 4);
    spawnCluster(1, 3);
    updateHud();
  }

  function updateHud() {
    ui.score.textContent = score;
    ui.hearts.textContent = '♥'.repeat(hearts) + '♡'.repeat(Math.max(0, START_HEARTS - hearts));
  }

  // ---- Spawning ----

  function randomSpot(r) {
    const top = 80;
    for (let tries = 0; tries < 20; tries++) {
      const x = r + 10 + Math.random() * (W - 2 * r - 20);
      const y = top + r + Math.random() * (H - top - 2 * r - 20);
      let ok = true;
      for (const o of orbs) {
        if (Math.hypot(o.x - x, o.y - y) < o.r + r + 14) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  }

  function makeOrb(kind, colorIdx, x, y) {
    const d = difficulty();
    const speed = (14 + Math.random() * 22 + d * 26) * S;
    const a = Math.random() * Math.PI * 2;
    const r = (kind === 'mine' ? 15 : 13) * S;
    const life = kind === 'mine'
      ? 9 + Math.random() * 5
      : Math.max(5.5, 11 - d * 4) + Math.random() * 3;
    return {
      kind, color: kind === 'orb' ? COLORS[colorIdx] : kind === 'gold' ? GOLD : kind === 'heart' ? PINK : MINE,
      colorIdx, x, y, r,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life, maxLife: life, born: 0, spin: Math.random() * 6,
    };
  }

  function spawnCluster(colorIdx, n) {
    const r = 13 * S;
    const c = randomSpot(r * 3);
    const baseA = Math.random() * Math.PI * 2;
    const drift = makeOrb('orb', colorIdx, 0, 0);
    for (let i = 0; i < n; i++) {
      const a = baseA + (i / n) * Math.PI * 2;
      const dist = (n > 1 ? 30 : 0) * S;
      const x = Math.max(r, Math.min(W - r, c.x + Math.cos(a) * dist));
      const y = Math.max(80, Math.min(H - r, c.y + Math.sin(a) * dist));
      const o = makeOrb('orb', colorIdx, x, y);
      // Clusters drift together, with a bit of wobble.
      o.vx = drift.vx + (Math.random() - 0.5) * 10 * S;
      o.vy = drift.vy + (Math.random() - 0.5) * 10 * S;
      o.life = drift.life + Math.random() * 0.6;
      o.maxLife = o.life;
      orbs.push(o);
    }
  }

  function spawnTick() {
    const d = difficulty();
    const roll = Math.random();
    const mines = orbs.filter((o) => o.kind === 'mine').length;
    if (time > 15 && roll < 0.16 + d * 0.12 && mines < 2 + Math.floor(d * 3)) {
      const r = 15 * S;
      const p = randomSpot(r * 2);
      orbs.push(makeOrb('mine', -1, p.x, p.y));
    } else if (roll > 0.955 && time > 10) {
      const p = randomSpot(14 * S);
      orbs.push(makeOrb(hearts < MAX_HEARTS && Math.random() < 0.45 ? 'heart' : 'gold', -1, p.x, p.y));
    } else {
      const n = 2 + Math.floor(Math.random() * (2 + Math.min(3, d * 3)));
      spawnCluster(Math.floor(Math.random() * colorCount()), n);
    }
  }

  // ---- Geometry ----
  function segIntersect(a, b, c, d) {
    const r1x = b.x - a.x, r1y = b.y - a.y;
    const r2x = d.x - c.x, r2y = d.y - c.y;
    const den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c.x - a.x) * r2y - (c.y - a.y) * r2x) / den;
    const u = ((c.x - a.x) * r1y - (c.y - a.y) * r1x) / den;
    if (t > 0 && t <= 1 && u >= 0 && u <= 1) return { x: a.x + r1x * t, y: a.y + r1y * t };
    return null;
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
  }

  function trailLength() {
    let L = 0;
    for (let i = 1; i < trail.length; i++) L += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
    return L;
  }

  // ---- Input ----
  let pointerId = null;
  function toLocal(e) { return { x: e.clientX, y: e.clientY }; }

  canvas.addEventListener('pointerdown', (e) => {
    ensureAudio();
    if (state === 'menu') { start(); return; }
    if (state === 'over') { if (performance.now() - overAt > 600) start(); return; }
    if (state === 'paused') { resume(); return; }
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drawing = true;
    trail = [toLocal(e)];
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== pointerId) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) addPoint(toLocal(ev));
  });

  // Letting go close to your own rope still closes the loop.
  const SNAP_DIST = () => 55 * S;
  function findSnap() {
    const n = trail.length;
    if (n < 6) return -1;
    const tip = trail[n - 1];
    const minPath = 140 * S;
    let walked = 0, bestJ = -1, bestD = SNAP_DIST();
    for (let j = n - 2; j >= 0; j--) {
      walked += Math.hypot(trail[j + 1].x - trail[j].x, trail[j + 1].y - trail[j].y);
      if (walked < minPath) continue;
      const d = Math.hypot(trail[j].x - tip.x, trail[j].y - tip.y);
      if (d <= bestD) { bestD = d; bestJ = j; }
    }
    return bestJ;
  }

  const endDraw = (e) => {
    if (e.pointerId !== pointerId) return;
    if (state === 'play' && e.type === 'pointerup') {
      const j = findSnap();
      if (j >= 0) closeLoop(trail.slice(j));
    }
    pointerId = null;
    drawing = false;
    trail = [];
  };
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  function addPoint(p) {
    const last = trail[trail.length - 1];
    if (!last) { trail.push(p); return; }
    if (Math.hypot(p.x - last.x, p.y - last.y) < 4) return;
    trail.push(p);

    // Touching a mine with the rope snaps it.
    for (const o of orbs) {
      if (o.kind === 'mine' && o.born > 0.3 && distToSeg(o.x, o.y, last, p) < o.r * 0.8) {
        snapTrail(o);
        return;
      }
    }

    // Did the newest segment cross an older one? That closes a loop.
    const n = trail.length;
    const a = trail[n - 2], b = trail[n - 1];
    for (let j = n - 4; j >= 0; j--) {
      const hit = segIntersect(a, b, trail[j], trail[j + 1]);
      if (hit) {
        const poly = [hit, ...trail.slice(j + 1, n - 1), hit];
        closeLoop(poly);
        trail = [hit, b];
        return;
      }
    }

    // Limited rope: trim the tail.
    let L = trailLength();
    const max = inkLength();
    while (L > max && trail.length > 2) {
      L -= Math.hypot(trail[1].x - trail[0].x, trail[1].y - trail[0].y);
      trail.shift();
    }
  }

  function snapTrail(mine) {
    sfx.snap();
    buzz(30);
    for (const pt of trail) if (Math.random() < 0.3) burst(pt.x, pt.y, '#ffffff', 1, 60);
    burst(mine.x, mine.y, MINE, 8, 120);
    popups.push({ x: mine.x, y: mine.y - 26 * S, text: 'SNAP!', color: MINE, t: 0, size: 18 });
    trail = [];
    drawing = false;
    pointerId = null;
  }

  function polyArea(poly) {
    let A = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) A += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    return Math.abs(A / 2);
  }

  function closeLoop(poly) {
    if (poly.length < 3 || polyArea(poly) < 200) return;
    const inside = orbs.filter((o) => o.born > 0.15 && pointInPoly(o.x, o.y, poly));
    if (!inside.length) {
      flashes.push({ poly, color: '#ffffff', t: 0, dur: 0.35 });
      return;
    }
    const cx = inside.reduce((s, o) => s + o.x, 0) / inside.length;
    const cy = inside.reduce((s, o) => s + o.y, 0) / inside.length;

    // Mines blow up the whole loop.
    const mine = inside.find((o) => o.kind === 'mine');
    if (mine) {
      for (const o of inside) { removeOrb(o); burst(o.x, o.y, o.kind === 'mine' ? MINE : o.color, o.kind === 'mine' ? 40 : 8, 260); }
      flashes.push({ poly, color: MINE, t: 0, dur: 0.6 });
      popups.push({ x: cx, y: cy, text: 'BOOM', color: MINE, t: 0, size: 34 });
      loseHeart(true);
      sfx.boom();
      buzz([60, 40, 90]);
      streak = 0;
      return;
    }

    const healers = inside.filter((o) => o.kind === 'heart');
    const golds = inside.filter((o) => o.kind === 'gold');
    const plain = inside.filter((o) => o.kind === 'orb');
    const colorsUsed = new Set(plain.map((o) => o.colorIdx));
    const pure = colorsUsed.size <= 1;
    const n = plain.length + golds.length;

    let gained = 0;
    if (n > 0) {
      if (pure) {
        streak++;
        const mult = 1 + Math.floor(streak / 4);
        gained = 10 * n * n * mult + golds.length * 25;
        const loopColor = plain.length ? plain[0].color : GOLD;
        flashes.push({ poly, color: loopColor, t: 0, dur: 0.5 });
        let label = '+' + gained;
        if (n >= 6) label = 'MEGA! ' + label;
        else if (n >= 4) label = 'NICE! ' + label;
        popups.push({ x: cx, y: cy, text: label, color: loopColor, t: 0, size: 18 + Math.min(18, n * 3) });
        if (mult > 1) popups.push({ x: cx, y: cy + 30 * S, text: 'x' + mult + ' streak', color: '#ffffff', t: 0, size: 14 });
        sfx.catch(n);
        buzz(15 + n * 4);
        if (n >= 5) shake = Math.max(shake, 6);
      } else {
        streak = 0;
        gained = 5 * n;
        flashes.push({ poly, color: '#9aa0b8', t: 0, dur: 0.4 });
        popups.push({ x: cx, y: cy, text: 'mixed +' + gained, color: '#c8cce0', t: 0, size: 16 });
        sfx.mixed();
      }
      bestLoop = Math.max(bestLoop, pure ? n : 0);
      caught += n;
    }
    if (healers.length) {
      hearts = Math.min(MAX_HEARTS, hearts + healers.length);
      popups.push({ x: cx, y: cy - 30 * S, text: '+♥', color: PINK, t: 0, size: 26 });
      sfx.heal();
      if (n === 0) flashes.push({ poly, color: PINK, t: 0, dur: 0.5 });
    }
    for (const o of inside) { removeOrb(o); burst(o.x, o.y, o.color, 14, 200); }
    score += gained;
    updateHud();
  }

  function removeOrb(o) {
    const i = orbs.indexOf(o);
    if (i >= 0) orbs.splice(i, 1);
  }

  function loseHeart(big) {
    hearts--;
    redFlash = big ? 1 : 0.6;
    shake = Math.max(shake, big ? 14 : 6);
    updateHud();
    if (hearts <= 0) gameOver();
  }

  // ---- Particles ----
  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.3 + Math.random()) * speed * S;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, t: 0, color, r: (1.5 + Math.random() * 2.5) * S });
    }
  }

  // ---- Flow ----
  function start() {
    resetGame();
    state = 'play';
    ui.menu.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ui.pauseBtn.classList.remove('hidden');
    ui.paused.classList.add('hidden');
  }

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    drawing = false; pointerId = null; trail = [];
    ui.pausedScore.textContent = score;
    ui.paused.classList.remove('hidden');
    ui.pauseBtn.classList.add('hidden');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    ui.paused.classList.add('hidden');
    ui.pauseBtn.classList.remove('hidden');
  }

  ui.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); pause(); });
  // Pause by itself when you switch apps or lock the phone.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    drawing = false; pointerId = null; trail = [];
    const isBest = score > best;
    if (isBest) { best = score; saveBest(best); }
    ui.final.textContent = score;
    ui.overBest.textContent = best;
    ui.menuBest.textContent = best;
    ui.newBest.classList.toggle('hidden', !isBest);
    const secs = Math.floor(time);
    ui.stats.innerHTML = `Orbs caught: <b>${caught}</b><br>Biggest one-color loop: <b>${bestLoop}</b><br>Survived: <b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b>`;
    ui.over.classList.remove('hidden');
    ui.hud.classList.add('hidden');
    ui.pauseBtn.classList.add('hidden');
  }

  // ---- Update ----
  function update(dt) {
    if (state === 'paused') return;
    if (state === 'play') {
      time += dt;
      spawnTimer -= dt;
      const d = difficulty();
      const alive = orbs.filter((o) => o.kind === 'orb').length;
      if (spawnTimer <= 0 || alive < 3) {
        spawnTick();
        spawnTimer = Math.max(0.9, 2.6 - d * 1.3) * (0.75 + Math.random() * 0.5);
      }
    }

    const top = 64;
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.born += dt;
      o.spin += dt * (o.kind === 'mine' ? 1.5 : 0.8);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); }
      if (o.x > W - o.r) { o.x = W - o.r; o.vx = -Math.abs(o.vx); }
      if (o.y < top + o.r) { o.y = top + o.r; o.vy = Math.abs(o.vy); }
      if (o.y > H - o.r) { o.y = H - o.r; o.vy = -Math.abs(o.vy); }
      if (state !== 'play') continue;
      o.life -= dt;
      if (o.life <= 0) {
        orbs.splice(i, 1);
        if (o.kind === 'orb') {
          burst(o.x, o.y, '#666a80', 10, 80);
          streak = 0;
          if (time < graceUntil) continue;
          graceUntil = time + 1.2;
          popups.push({ x: o.x, y: o.y, text: '−♥', color: MINE, t: 0, size: 18 });
          sfx.lost();
          buzz(40);
          loseHeart(false);
          if (state !== 'play') break;
        } else {
          burst(o.x, o.y, o.color, 6, 50);
        }
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      if (p.t > p.life) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > 1.1) popups.splice(i, 1); }
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].t += dt; if (flashes[i].t > flashes[i].dur) flashes.splice(i, 1); }
    shake = Math.max(0, shake - dt * 40);
    redFlash = Math.max(0, redFlash - dt * 2);
  }

  // ---- Draw ----
  let bgTime = 0;
  function drawBackground(dt) {
    bgTime += dt;
    ctx.fillStyle = '#0b0d1f';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    // Faint dotted grid that slowly drifts.
    const gap = 34 * S;
    const off = (bgTime * 6) % gap;
    ctx.fillStyle = 'rgba(140, 160, 255, 0.08)';
    for (let y = -gap + off; y < H + gap; y += gap) {
      for (let x = 0; x < W + gap; x += gap) ctx.fillRect(x, y, 2, 2);
    }
  }

  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function drawHeart(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.8);
    ctx.bezierCurveTo(x - r * 1.4, y - r * 0.2, x - r * 0.6, y - r * 1.2, x, y - r * 0.4);
    ctx.bezierCurveTo(x + r * 0.6, y - r * 1.2, x + r * 1.4, y - r * 0.2, x, y + r * 0.8);
    ctx.closePath();
  }

  let orbAlpha = 1;
  function drawOrb(o) {
    const pop = Math.min(1, o.born / 0.25);
    const scale = pop < 1 ? 1 - Math.pow(1 - pop, 3) * 1 + Math.sin(pop * Math.PI) * 0.25 : 1;
    const frac = Math.max(0, o.life / o.maxLife);
    const urgent = o.kind === 'orb' && frac < 0.3;
    const blink = urgent ? (Math.sin(o.born * 22) > 0 ? 1 : 0.45) : 1;
    const r = o.r * scale;

    ctx.globalAlpha = blink * orbAlpha;
    const g = glowSprite(o.color);
    const gs = r * 4.2;
    ctx.drawImage(g, o.x - gs / 2, o.y - gs / 2, gs, gs);

    ctx.fillStyle = o.color;
    if (o.kind === 'mine') {
      ctx.beginPath();
      const spikes = 9;
      for (let i = 0; i < spikes * 2; i++) {
        const a = o.spin + (i * Math.PI) / spikes;
        const rr = i % 2 ? r * 0.7 : r * 1.25;
        ctx.lineTo(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a0a0a';
      ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffdddd';
      ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.16, 0, Math.PI * 2); ctx.fill();
    } else if (o.kind === 'gold') {
      drawStar(o.x, o.y, r * 1.15, o.spin);
      ctx.fill();
    } else if (o.kind === 'heart') {
      drawHeart(o.x, o.y, r);
      ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.78, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(o.x - r * 0.25, o.y - r * 0.25, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }

    // Life ring
    if (o.kind !== 'mine' && pop >= 1) {
      ctx.strokeStyle = urgent ? '#ff6b6b' : o.color;
      ctx.lineWidth = 2.5 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(o.x, o.y, r + 6 * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function tracePoly(poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }

  function drawTrail() {
    if (trail.length < 2) return;
    const max = inkLength();
    const used = trailLength() / max;
    // Rope color shifts from cyan to hot pink as you run out of rope.
    const hue = 190 + used * 140;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, a] of [[16, 0.12], [8, 0.3], [3.5, 1]]) {
      ctx.strokeStyle = a === 1 ? `hsl(${hue}, 100%, 85%)` : `hsla(${hue}, 100%, 65%, ${a})`;
      ctx.lineWidth = w * S;
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    const tip = trail[trail.length - 1];

    // Show that letting go here will close the loop.
    const j = drawing ? findSnap() : -1;
    if (j >= 0) {
      const anchor = trail[j];
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
      tracePoly(trail.slice(j));
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([6 * S, 6 * S]);
      ctx.strokeStyle = `hsl(${hue}, 100%, 85%)`;
      ctx.lineWidth = 3 * S;
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(anchor.x, anchor.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.drawImage(glowSprite('#ffffff'), anchor.x - 12 * S, anchor.y - 12 * S, 24 * S, 24 * S);
    }

    ctx.drawImage(glowSprite('#ffffff'), tip.x - 18 * S, tip.y - 18 * S, 36 * S, 36 * S);
  }

  function draw(dt) {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBackground(dt);

    for (const f of flashes) {
      const k = 1 - f.t / f.dur;
      ctx.globalAlpha = 0.35 * k;
      ctx.fillStyle = f.color;
      tracePoly(f.poly);
      ctx.fill();
      ctx.globalAlpha = k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3 * S;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    orbAlpha = state === 'menu' ? 0.35 : 1;
    for (const o of orbs) drawOrb(o);

    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawTrail();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of popups) {
      const k = p.t / 1.1;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = p.color;
      ctx.font = `900 ${Math.round(p.size * S)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(p.text, p.x, p.y - k * 40 * S);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (redFlash > 0) {
      ctx.fillStyle = `rgba(255, 40, 60, ${redFlash * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- Attract mode for the menu: drifting orbs in the background ----
  function seedMenu() {
    orbs = [];
    for (let i = 0; i < 4; i++) spawnCluster(i % 3, 3);
    for (const o of orbs) o.born = 1;
  }
  seedMenu();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Hooks for automated testing.
  window.__lasso = {
    get state() { return state; }, get score() { return score; }, get hearts() { return hearts; },
    get orbs() { return orbs; }, start, pause,
  };
})();

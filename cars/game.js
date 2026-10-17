(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $('hud'), miles: $('miles'), speed: $('speed'),
    menu: $('menu'), menuBest: $('menu-best'),
    over: $('over'), final: $('final'), newBest: $('new-best'), overBest: $('over-best'),
    topSpeed: $('top-speed'), rank: $('rank'),
  };

  // ---- Persistence (best distance in miles) ----
  const BEST_KEY = 'cars.best';
  const loadBest = () => { try { return parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* ignore */ } };
  let best = loadBest();
  const fmt = (mi) => mi.toFixed(2);

  // ---- Tuning ----
  const LANES = 4;
  const START_MPH = 60;
  const MAX_MPH = 300;
  const MPH_PER_SEC = 1.6;     // how quickly you speed up
  const TRAFFIC_RATIO = 0.55;  // traffic drives at this fraction of your speed
  // Game clock runs faster than real time so the miles add up at a fun pace.
  const TIME_SCALE = 6;
  const CAR_COLORS = ['#e8443a', '#3a8ee8', '#f2c230', '#9b5de5', '#f28c28', '#2ec4b6', '#eeeeee', '#555b66'];

  // ---- Sizing ----
  let W = 0, H = 0, dpr = 1;
  let roadW = 0, roadX = 0, laneW = 0, carW = 0, carH = 0, playerY = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    roadW = Math.min(W * 0.86, 440);
    roadX = (W - roadW) / 2;
    laneW = roadW / LANES;
    carW = laneW * 0.6;
    carH = carW * 1.85;
    playerY = H - carH - Math.max(40, H * 0.1);
    if (player) player.x = player.tx = Math.min(Math.max(player.x, minX()), maxX());
  }

  const laneCenter = (i) => roadX + laneW * (i + 0.5);
  const minX = () => roadX + carW / 2 + 4;
  const maxX = () => roadX + roadW - carW / 2 - 4;

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

  // ---- Game state ----
  let state = 'menu';        // 'menu' | 'playing' | 'over'
  let player = null;         // { x, tx, tilt, color }
  let traffic = [];          // { x, y, color, lane }
  let sparks = [];
  let mph = START_MPH, miles = 0, topMph = START_MPH;
  let scroll = 0;            // road scroll for lane dashes, in px
  let nextRow = 0;           // px left until the next row of traffic
  let lastFree = 0;          // lane that stayed open in the last row
  let overAt = 0, shake = 0, nextMileTone = 1;

  // Pixels per second the road moves past you at a given speed.
  const pxPerSec = (v) => v * (H / 900) * 9;

  function reset() {
    player = { x: laneCenter(1), tx: laneCenter(1), tilt: 0, color: '#ffd84d' };
    traffic = []; sparks = [];
    mph = START_MPH; miles = 0; topMph = START_MPH;
    nextRow = H * 0.5; lastFree = 1; nextMileTone = 1;
    updateHud();
  }

  function updateHud() {
    ui.miles.firstChild.nodeValue = fmt(miles);
    ui.speed.textContent = `${Math.round(mph)} mph`;
  }

  // Spawn a row of cars, always leaving at least one lane open
  // and keeping it within reach of the previous open lane.
  function spawnRow() {
    const difficulty = Math.min(1, (mph - START_MPH) / (MAX_MPH - START_MPH));
    const maxCars = difficulty > 0.35 ? LANES - 1 : LANES - 2;
    const count = 1 + Math.floor(Math.random() * maxCars);
    const free = Math.max(0, Math.min(LANES - 1, lastFree + Math.floor(Math.random() * 3) - 1));
    const lanes = [];
    for (let i = 0; i < LANES; i++) if (i !== free) lanes.push(i);
    lanes.sort(() => Math.random() - 0.5);
    for (const lane of lanes.slice(0, count)) {
      traffic.push({
        lane,
        x: laneCenter(lane),
        y: -carH - Math.random() * carH * 0.6,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      });
    }
    lastFree = free;
    // Rows get a little closer together as you speed up.
    nextRow = carH * (3.4 - 1.2 * difficulty) + Math.random() * carH;
  }

  function rankFor(mi) {
    if (mi >= 20) return 'Road legend. Nobody catches you.';
    if (mi >= 12) return 'Highway hero. Seriously impressive.';
    if (mi >= 7) return 'Smooth driving. Now go for 12.';
    if (mi >= 3) return 'Not bad! Keep your eyes on the road.';
    if (mi >= 1) return 'You made it a mile. Run it back.';
    return 'Ouch. Maybe take the bus.';
  }

  function crash(car) {
    state = 'over';
    overAt = performance.now();
    shake = 14;
    tone(90, 0.5, 'sawtooth', 0.2);
    tone(60, 0.6, 'square', 0.12);
    buzz([40, 30, 80]);
    const cx = (player.x + car.x) / 2, cy = (playerY + car.y + carH) / 2;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 320;
      sparks.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.5 + Math.random() * 0.6 });
    }
    const isBest = miles > best;
    if (isBest) { best = miles; saveBest(best); }
    ui.final.textContent = fmt(miles);
    ui.overBest.textContent = fmt(best);
    ui.newBest.classList.toggle('hidden', !isBest || miles < 0.01);
    ui.topSpeed.textContent = `Top speed: ${Math.round(topMph)} mph`;
    ui.rank.textContent = rankFor(miles);
    setTimeout(() => {
      if (state !== 'over') return;
      ui.hud.classList.add('hidden');
      ui.over.classList.remove('hidden');
    }, 800);
  }

  function start() {
    reset();
    state = 'playing';
    ui.menu.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.hud.classList.remove('hidden');
  }

  // ---- Input ----
  // Drag anywhere to steer; the car follows your finger's sideways movement.
  let drag = null; // { id, px, carX }
  const keys = { left: false, right: false };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state === 'menu') start();
    else if (state === 'over') { if (performance.now() - overAt > 1000) start(); return; }
    drag = { id: e.pointerId, px: e.clientX, carX: player.tx };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || state !== 'playing') return;
    player.tx = Math.min(Math.max(drag.carX + (e.clientX - drag.px) * 1.3, minX()), maxX());
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
    else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      if (state === 'menu') start();
      else if (state === 'over' && performance.now() - overAt > 1000) start();
    } else return;
    e.preventDefault();
    if (state === 'menu' && (keys.left || keys.right)) start();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  });

  // ---- Update ----
  const hit = (a, b) => {
    // Slightly forgiving boxes so near misses feel fair.
    const mx = carW * 0.12, my = carH * 0.1;
    return Math.abs(a.x - b.x) < carW - mx * 2 && Math.abs(a.y - b.y) < carH - my * 2;
  };

  function update(dt) {
    const moving = state !== 'over';
    if (state === 'playing') {
      mph = Math.min(MAX_MPH, mph + MPH_PER_SEC * dt);
      topMph = Math.max(topMph, mph);
      miles += (mph / 3600) * dt * TIME_SCALE;
      if (miles >= nextMileTone) {
        nextMileTone++;
        tone(660, 0.1, 'triangle', 0.16);
        setTimeout(() => tone(990, 0.16, 'triangle', 0.16), 90);
      }

      const steer = laneW * 4.5 * (1 + (mph - START_MPH) / 300);
      if (keys.left) player.tx = Math.max(minX(), player.tx - steer * dt);
      if (keys.right) player.tx = Math.min(maxX(), player.tx + steer * dt);
      updateHud();
    }

    if (state !== 'over') {
      const prev = player.x;
      player.x += (player.tx - player.x) * Math.min(1, dt * 14);
      const vx = (player.x - prev) / Math.max(dt, 1e-4);
      player.tilt += (Math.max(-0.35, Math.min(0.35, vx / 1800)) - player.tilt) * Math.min(1, dt * 10);
    }

    if (moving) {
      const roadSpeed = pxPerSec(mph);
      scroll = (scroll + roadSpeed * dt) % (carH * 2);
      if (state === 'playing') {
        const rel = roadSpeed * (1 - TRAFFIC_RATIO);
        for (const c of traffic) c.y += rel * dt;
        traffic = traffic.filter((c) => c.y < H + carH);
        nextRow -= rel * dt;
        if (nextRow <= 0) spawnRow();

        const me = { x: player.x, y: playerY };
        for (const c of traffic) {
          if (hit(me, c)) { crash(c); break; }
        }
      }
    }

    for (const s of sparks) {
      s.t += dt;
      s.vx *= 1 - dt * 2;
      s.vy *= 1 - dt * 2;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    sparks = sparks.filter((s) => s.t < s.life);
    shake = Math.max(0, shake - dt * 30);
  }

  // ---- Render ----
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Top-down car centred on (cx, y + carH/2), nose pointing up.
  function drawCar(cx, y, color, tilt = 0, isPlayer = false) {
    const w = carW, h = carH;
    ctx.save();
    ctx.translate(cx, y + h / 2);
    ctx.rotate(tilt);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rrect(-w / 2 + 3, -h / 2 + 5, w, h, w * 0.25);
    ctx.fill();
    // Wheels
    ctx.fillStyle = '#111';
    const ww = w * 0.16, wh = h * 0.18;
    for (const sy of [-h * 0.3, h * 0.18]) {
      ctx.fillRect(-w / 2 - ww * 0.35, sy, ww, wh);
      ctx.fillRect(w / 2 - ww * 0.65, sy, ww, wh);
    }
    // Body
    ctx.fillStyle = color;
    rrect(-w / 2, -h / 2, w, h, w * 0.25);
    ctx.fill();
    // Roof highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rrect(-w * 0.32, -h * 0.12, w * 0.64, h * 0.34, w * 0.12);
    ctx.fill();
    // Windshield (front) and rear window
    ctx.fillStyle = '#1d2a36';
    rrect(-w * 0.36, -h * 0.28, w * 0.72, h * 0.16, w * 0.08);
    ctx.fill();
    rrect(-w * 0.33, h * 0.24, w * 0.66, h * 0.1, w * 0.06);
    ctx.fill();
    if (isPlayer) {
      // Racing stripe and headlights
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-w * 0.07, -h / 2, w * 0.14, h * 0.22);
      ctx.fillStyle = '#fffbe0';
      ctx.fillRect(-w * 0.4, -h / 2 + 1, w * 0.18, h * 0.04);
      ctx.fillRect(w * 0.22, -h / 2 + 1, w * 0.18, h * 0.04);
    } else {
      // Brake lights at the back
      ctx.fillStyle = '#ff2a2a';
      ctx.fillRect(-w * 0.42, h / 2 - h * 0.05, w * 0.2, h * 0.04);
      ctx.fillRect(w * 0.22, h / 2 - h * 0.05, w * 0.2, h * 0.04);
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // Grass
    ctx.fillStyle = '#2f6b3a';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    // Roadside stripes on the grass so speed reads even at the edges
    const stripe = carH * 2;
    ctx.fillStyle = '#2a6234';
    for (let y = -stripe + (scroll % stripe); y < H; y += stripe) {
      ctx.fillRect(-20, y, roadX + 20, stripe / 2);
      ctx.fillRect(roadX + roadW, y, W - roadX - roadW + 20, stripe / 2);
    }

    // Road
    ctx.fillStyle = '#3b3f45';
    ctx.fillRect(roadX, -20, roadW, H + 40);
    // Curbs
    const curb = Math.max(6, laneW * 0.08);
    const seg = carH * 0.5;
    for (let y = -seg * 2 + (scroll % (seg * 2)); y < H; y += seg) {
      const red = Math.round((y - scroll) / seg) % 2 === 0;
      ctx.fillStyle = red ? '#d8423a' : '#f2f2f2';
      ctx.fillRect(roadX - curb, y, curb, seg + 1);
      ctx.fillRect(roadX + roadW, y, curb, seg + 1);
    }
    // Lane dashes
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const dash = carH * 0.7, gap = carH * 1.3;
    for (let i = 1; i < LANES; i++) {
      const x = roadX + laneW * i - 2;
      for (let y = -(dash + gap) + (scroll % (dash + gap)); y < H; y += dash + gap) {
        ctx.fillRect(x, y, 4, dash);
      }
    }

    for (const c of traffic) drawCar(c.x, c.y, c.color);
    if (player) drawCar(player.x, playerY, player.color, player.tilt, true);

    for (const s of sparks) {
      const p = s.t / s.life;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = p < 0.3 ? '#fff3b0' : p < 0.6 ? '#ffa62b' : '#777';
      const r = 3 + p * 6;
      ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
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

  window.addEventListener('resize', resize);
  resize();
  ui.menuBest.textContent = fmt(best);
  reset();
  requestAnimationFrame(frame);
})();

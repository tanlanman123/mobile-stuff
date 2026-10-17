(() => {
  'use strict';

  const { Body, World, shapes, vec } = Physics;
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const panel = $('panel');

  const world = new World();
  const MAX_BODIES = 80;
  const WALL = 400; // wall thickness

  let W = 0, H = 0, dpr = 1, floorY = 0;
  let roomW = 0, roomH = 0; // the walled room, in world units
  let walls = [];
  let wallsOn = true;
  let paused = false;
  let tool = 'ball';

  // ---- Camera: world -> screen is (p - cam) * zoom + view center ----
  const cam = { x: 0, y: 0, zoom: 1 };
  const MAX_ZOOM = 20;
  const viewCenter = () => vec(W / 2, floorY / 2);
  const toScreen = (p) => vec((p.x - cam.x) * cam.zoom + W / 2, (p.y - cam.y) * cam.zoom + floorY / 2);
  const toWorld = (p) => vec((p.x - W / 2) / cam.zoom + cam.x, (p.y - floorY / 2) / cam.zoom + cam.y);

  function zoomAt(screenP, factor) {
    const before = toWorld(screenP);
    cam.zoom = Math.min(MAX_ZOOM, cam.zoom * factor); // no lower limit: zoom out forever
    const after = toWorld(screenP);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  function resetView() {
    cam.x = roomW / 2;
    cam.y = roomH / 2;
    cam.zoom = 1;
  }

  // ---- Settings from the panel ----
  const MASS_MIN = 0.1, MASS_SLIDER_MAX = 50;
  const massFromSlider = (v) => MASS_MIN * Math.pow(MASS_SLIDER_MAX / MASS_MIN, v / 100);
  const sliderFromMass = (m) => (100 * Math.log(m / MASS_MIN)) / Math.log(MASS_SLIDER_MAX / MASS_MIN);
  const settings = { size: 30, mass: 1, bounce: 0.3 };

  function fmtNum(m) {
    if (m >= 1e9) return +(m / 1e9).toPrecision(3) + 'B';
    if (m >= 1e6) return +(m / 1e6).toPrecision(3) + 'M';
    if (m >= 1e4) return +(m / 1e3).toPrecision(3) + 'k';
    if (m >= 10) return String(Math.round(m));
    return String(+m.toPrecision(2));
  }
  const fmtMass = (m) => fmtNum(m) + ' kg';

  function bindSlider(id, apply) {
    const input = $(id), out = $(id + '-out');
    const update = () => { out.textContent = apply(Number(input.value)); };
    input.addEventListener('input', update);
    update();
  }
  // Size: the slider covers 10-80; the box takes any size you type.
  const sizeSlider = $('size'), sizeBox = $('size-num');
  sizeSlider.addEventListener('input', () => {
    settings.size = Number(sizeSlider.value);
    sizeBox.value = settings.size;
  });
  sizeBox.addEventListener('input', () => {
    const v = parseFloat(sizeBox.value);
    if (!(v >= 1) || !isFinite(v)) return;
    settings.size = v;
    sizeSlider.value = Math.max(10, Math.min(80, v));
  });
  bindSlider('bounce', (v) => { settings.bounce = v / 100; return v + '%'; });

  // Mass: the slider covers 0.1-50 kg; the box takes any number you type.
  const massSlider = $('mass'), massBox = $('mass-num');
  massSlider.addEventListener('input', () => {
    settings.mass = massFromSlider(Number(massSlider.value));
    massBox.value = +settings.mass.toPrecision(2);
    updateMassHint();
  });
  massBox.addEventListener('input', () => {
    const m = parseFloat(massBox.value);
    if (!(m > 0) || !isFinite(m)) return;
    settings.mass = m;
    massSlider.value = Math.max(0, Math.min(100, sliderFromMass(m)));
    updateMassHint();
  });
  for (const box of [massBox, sizeBox]) box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); });
  function updateMassHint() {
    $('mass-hint').classList.toggle('hidden', settings.mass < world.attractMass);
  }
  updateMassHint();

  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      tool = btn.dataset.tool;
    });
  });

  // ---- Gravity: strength slider, straight down or phone tilt ----
  const G = 1500; // 100% gravity, px/s^2
  let gravityScale = 1;
  let tiltOn = false;
  let tilt = null;
  let tiltSign = 0; // browsers disagree on the sensor's sign; learned on first reading

  bindSlider('gravity-strength', (v) => { gravityScale = v / 100; return v + '%'; });

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const raw = vec(a.x / 9.81, -a.y / 9.81);
    if (!tiltSign) {
      // Calibrate: when tilt is turned on the phone is held roughly upright,
      // so "down" must point toward the bottom of the screen. Wait until
      // it's clearly not lying flat.
      if (Math.abs(raw.y) < 0.4) return;
      tiltSign = raw.y > 0 ? 1 : -1;
    }
    // Up/down calibrates itself above; left/right is mirrored to match how
    // it behaves on real phones.
    tilt = vec(raw.x * tiltSign, raw.y * tiltSign);
  }

  async function enableTilt() {
    const DM = window.DeviceMotionEvent;
    if (!DM) return false;
    if (typeof DM.requestPermission === 'function') {
      // iOS asks for permission first.
      try { if ((await DM.requestPermission()) !== 'granted') return false; } catch { return false; }
    }
    tiltSign = 0;
    tilt = null;
    window.addEventListener('devicemotion', onMotion);
    return true;
  }

  $('tilt').addEventListener('click', async () => {
    tiltOn = !tiltOn && (await enableTilt());
    $('tilt').classList.toggle('on', tiltOn);
  });

  function updateGravity() {
    const dir = tiltOn && tilt ? tilt : vec(0, 1);
    const g = vec(dir.x * G * gravityScale, dir.y * G * gravityScale);
    // Resting objects need a nudge awake when "down" changes.
    if (Math.hypot(g.x - world.gravity.x, g.y - world.gravity.y) > 20) world.wakeAll();
    world.gravity = g;
  }

  $('pause').addEventListener('click', () => {
    paused = !paused;
    $('pause').innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
    $('pause').classList.toggle('on', paused);
  });

  $('clear').addEventListener('click', () => {
    for (const b of world.bodies.slice()) if (!b.isStatic) world.remove(b);
    grabs.clear();
  });

  $('walls').addEventListener('click', () => {
    wallsOn = !wallsOn;
    $('walls').classList.toggle('on', wallsOn);
    buildWalls();
    world.wakeAll();
  });

  $('zoom-in').addEventListener('click', () => zoomAt(viewCenter(), 1.6));
  $('zoom-out').addEventListener('click', () => zoomAt(viewCenter(), 1 / 1.6));
  $('zoom-reset').addEventListener('click', resetView);

  // ---- Layout ----
  function buildWalls() {
    for (const w of walls) world.remove(w);
    walls = [];
    if (!wallsOn) return;
    const make = (x, y, w, h) => world.add(new Body({
      shape: 'poly', x, y, verts: shapes.box(w, h), isStatic: true, restitution: 1, friction: 0.6,
    }));
    walls = [
      make(roomW / 2, roomH + WALL / 2, roomW + WALL * 2, WALL),          // floor
      make(roomW / 2, -WALL / 2, roomW + WALL * 2, WALL),                 // ceiling
      make(-WALL / 2, roomH / 2, WALL, roomH + WALL * 2),                 // left
      make(roomW + WALL / 2, roomH / 2, WALL, roomH + WALL * 2),          // right
    ];
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    floorY = panel.getBoundingClientRect().top;
    $('zoom').style.bottom = (H - floorY + 12) + 'px';
    // The on-screen keyboard (typing a mass) shrinks the window; don't
    // rebuild the room for that.
    if (document.activeElement === massBox || document.activeElement === sizeBox) return;
    const oldW = roomW, oldH = roomH;
    roomW = W;
    roomH = floorY;
    if (oldW === roomW && oldH === roomH) return;
    buildWalls();
    if (wallsOn) {
      // Pull anything that was inside the old room into the new one.
      for (const b of world.bodies) {
        if (b.isStatic) continue;
        if (b.pos.x < 0 || b.pos.x > oldW || b.pos.y < 0 || b.pos.y > oldH) continue;
        b.pos.x = Math.min(Math.max(b.pos.x, b.radius), roomW - b.radius);
        b.pos.y = Math.min(Math.max(b.pos.y, b.radius), roomH - b.radius);
        b.updateGeometry();
      }
    }
    if (!oldW) resetView();
    world.wakeAll();
  }
  window.addEventListener('resize', resize);

  // ---- Spawning ----
  function colorFor(mass) {
    // Light objects are pale, heavy ones are deep and dark.
    const t = Math.min(1, Math.max(0, Math.log(mass / MASS_MIN) / Math.log(MASS_SLIDER_MAX / MASS_MIN)));
    const hue = Math.floor(Math.random() * 360);
    return { hue, light: 72 - t * 40 };
  }

  function spawn(kind, x, y, size = settings.size, mass = settings.mass, bounce = settings.bounce) {
    const common = { x, y, mass, restitution: bounce, friction: 0.5, color: colorFor(mass), angle: 0 };
    let body;
    if (kind === 'ball') body = new Body({ ...common, shape: 'circle', radius: size });
    else if (kind === 'box') body = new Body({ ...common, shape: 'poly', verts: shapes.box(size * 1.7, size * 1.7) });
    else if (kind === 'plank') body = new Body({ ...common, shape: 'poly', verts: shapes.box(size * 4.5, size * 0.7) });
    else if (kind === 'triangle') body = new Body({ ...common, shape: 'poly', verts: shapes.regular(3, size * 1.25) });
    else if (kind === 'hexagon') body = new Body({ ...common, shape: 'poly', verts: shapes.regular(6, size) });
    else return null;

    // Tapping inside the room keeps the new shape inside the walls.
    const fits = body.radius * 2 < Math.min(roomW, roomH);
    if (wallsOn && fits && x >= 0 && x <= roomW && y >= 0 && y <= roomH) {
      body.pos.x = Math.min(Math.max(x, body.radius + 1), roomW - body.radius - 1);
      body.pos.y = Math.min(Math.max(y, body.radius + 1), roomH - body.radius - 1);
    }
    body.updateGeometry();
    world.add(body);

    const dynamic = world.bodies.filter((b) => !b.isStatic);
    if (dynamic.length > MAX_BODIES) world.remove(dynamic[0]);
    return body;
  }

  // Finds the shape under a screen point, with some slack for tiny shapes
  // when zoomed far out.
  function bodyAtScreen(sp) {
    const p = toWorld(sp);
    const hit = world.bodyAt(p);
    if (hit) return hit;
    const slack = 14 / cam.zoom;
    let best = null, bestD = Infinity;
    for (const b of world.bodies) {
      if (b.isStatic) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.y - p.y) - b.radius;
      if (d < slack && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  // ---- Touch ----
  // One finger: drag a shape, or tap empty space to add one (on release,
  // so a pinch doesn't also add shapes). Two fingers: pinch to zoom and
  // drag to move around.
  const grabs = new Map();   // pointerId -> joint
  const pointers = new Map(); // pointerId -> { x, y, startX, startY }
  let pinch = null;          // { dist, mid } from the last pinch frame
  let gestureWasPinch = false;

  function startPinch() {
    // A second finger cancels whatever the first one was doing.
    for (const joint of grabs.values()) world.joints = world.joints.filter((j) => j !== joint);
    grabs.clear();
    gestureWasPinch = true;
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: vec((a.x + b.x) / 2, (a.y + b.y) / 2) };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;
    gestureWasPinch = false;

    const sp = vec(e.clientX, e.clientY);
    const hit = bodyAtScreen(sp);
    if (tool === 'erase') {
      if (hit) world.remove(hit);
      return;
    }
    if (hit) {
      const p = toWorld(sp);
      // Light things fly; 50 kg lifts slowly; anything heavier is pushed
      // around like a heavy thing, but still moves.
      const maxForce = 100000 + Math.max(0, hit.mass - 50) * 3000;
      const joint = { body: hit, anchor: hit.worldToLocal(p), target: p, maxForce };
      world.joints.push(joint);
      grabs.set(e.pointerId, joint);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;

    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = vec((a.x + b.x) / 2, (a.y + b.y) / 2);
      cam.x -= (mid.x - pinch.mid.x) / cam.zoom;
      cam.y -= (mid.y - pinch.mid.y) / cam.zoom;
      if (pinch.dist > 0 && dist > 0) zoomAt(mid, dist / pinch.dist);
      pinch = { dist, mid };
      return;
    }

    const sp = vec(e.clientX, e.clientY);
    const joint = grabs.get(e.pointerId);
    if (joint) joint.target = toWorld(sp);
    else if (tool === 'erase' && e.buttons) {
      const hit = bodyAtScreen(sp);
      if (hit) world.remove(hit);
    }
  });

  const release = (e) => {
    const ptr = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    const joint = grabs.get(e.pointerId);
    if (joint) {
      world.joints = world.joints.filter((j) => j !== joint);
      grabs.delete(e.pointerId);
      return;
    }
    // A short tap on empty space adds a shape.
    if (e.type === 'pointerup' && ptr && !gestureWasPinch && tool !== 'erase' && pointers.size === 0) {
      const moved = Math.hypot(ptr.x - ptr.startX, ptr.y - ptr.startY);
      const sp = vec(ptr.startX, ptr.startY);
      if (moved < 12 && sp.y < floorY && !bodyAtScreen(sp)) {
        const p = toWorld(sp);
        spawn(tool, p.x, p.y);
      }
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Mouse wheel / trackpad zoom on computers.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(vec(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // ---- Drawing (in world units; line widths divided by zoom) ----
  function drawBody(b, px) {
    const { hue, light } = b.color;
    const fill = `hsl(${hue}, 70%, ${light}%)`;
    const attractor = b.mass >= world.attractMass;

    // Too small to see: draw a dot that stays visible.
    if (b.radius * cam.zoom < 1.5) {
      ctx.fillStyle = attractor ? '#ffb020' : fill;
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, (attractor ? 3 : 1.5) * px, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (attractor) {
      // Glow showing it pulls things in.
      const glow = ctx.createRadialGradient(b.pos.x, b.pos.y, b.radius, b.pos.x, b.pos.y, b.radius * 2.6);
      glow.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.35)`);
      glow.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, b.radius * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = fill;
    ctx.strokeStyle = `hsl(${hue}, 70%, ${Math.max(light - 22, 8)}%)`;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    if (b.shape === 'circle') {
      ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
    } else {
      ctx.moveTo(b.wv[0].x, b.wv[0].y);
      for (let i = 1; i < b.wv.length; i++) ctx.lineTo(b.wv[i].x, b.wv[i].y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    if (b.shape === 'circle') {
      // Spoke so you can see it roll.
      ctx.beginPath();
      ctx.moveTo(b.pos.x, b.pos.y);
      ctx.lineTo(b.pos.x + Math.cos(b.angle) * b.radius, b.pos.y + Math.sin(b.angle) * b.radius);
      ctx.stroke();
    }

    if (b.radius * cam.zoom >= 22) {
      ctx.fillStyle = light > 50 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
      ctx.font = `700 ${Math.min(14 * px, b.radius * 0.45)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtMass(b.mass), b.pos.x, b.pos.y);
    }
  }

  function drawGrid(px) {
    // Pick a spacing that looks about 40-200 px apart at any zoom.
    let step = 40;
    while (step * cam.zoom < 40) step *= 5;
    while (step * cam.zoom > 200) step /= 5;
    const tl = toWorld(vec(0, 0)), br = toWorld(vec(W, H));
    const x0 = Math.floor(tl.x / step) * step, y0 = Math.floor(tl.y / step) * step;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let x = x0; x <= br.x; x += step) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
    for (let y = y0; y <= br.y; y += step) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
    ctx.stroke();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#141f23';
    ctx.fillRect(0, 0, W, H);

    // Switch to world units.
    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (floorY / 2 - cam.y * z));
    const px = 1 / z; // one screen pixel, in world units

    drawGrid(px);

    if (wallsOn) {
      ctx.fillStyle = '#0b1316';
      for (const w of walls) {
        ctx.beginPath();
        ctx.moveTo(w.wv[0].x, w.wv[0].y);
        for (let i = 1; i < w.wv.length; i++) ctx.lineTo(w.wv[i].x, w.wv[i].y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,176,32,0.35)';
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(0, 0, roomW, roomH);
    }

    // Only draw what's on screen.
    const tl = toWorld(vec(0, 0)), br = toWorld(vec(W, H));
    for (const b of world.bodies) {
      if (b.isStatic) continue;
      const r = b.radius * 2.6 + 4 * px;
      if (b.pos.x + r < tl.x || b.pos.x - r > br.x || b.pos.y + r < tl.y || b.pos.y - r > br.y) continue;
      drawBody(b, px);
    }

    for (const j of world.joints) {
      const p = j.body.localToWorld(j.anchor);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(j.target.x, j.target.y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * px, 0, Math.PI * 2);
      ctx.fill();
    }

    $('zoom-level').textContent = fmtNum(cam.zoom < 1 ? cam.zoom : Math.round(cam.zoom * 10) / 10) + '×';
  }

  // ---- Loop (fixed physics step) ----
  const STEP = 1 / 120;
  let acc = 0, last = performance.now();
  function frame(now) {
    acc += Math.min(0.05, (now - last) / 1000);
    last = now;
    updateGravity();
    while (acc >= STEP) {
      if (!paused) world.step(STEP);
      acc -= STEP;
    }
    // Drop anything broken or unimaginably far away.
    for (const b of world.bodies.slice()) {
      if (b.isStatic) continue;
      if (!isFinite(b.pos.x) || !isFinite(b.pos.y) || Math.abs(b.pos.x) > 1e12 || Math.abs(b.pos.y) > 1e12) world.remove(b);
    }
    render();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  resize();

  // A few starter objects so there's something to play with.
  const cx = roomW / 2;
  spawn('box', cx - 60, roomH - 40, 22, 2, 0.1);
  spawn('box', cx - 60, roomH - 100, 22, 1, 0.1);
  spawn('box', cx - 60, roomH - 160, 22, 0.5, 0.1);
  spawn('ball', cx + 70, roomH - 250, 30, 20, 0.2);
  spawn('ball', cx + 40, roomH - 400, 16, 0.2, 0.8);
  spawn('hexagon', cx - 20, roomH - 320, 24, 5, 0.2);

  requestAnimationFrame(frame);
})();

(() => {
  'use strict';

  const { Body, World, shapes, vec } = Physics;
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const panel = $('panel');

  const world = new World();
  const MAX_BODIES = 80;
  const WALL = 400; // wall thickness, mostly off-screen

  let W = 0, H = 0, floorY = 0;
  let walls = [];
  let paused = false;
  let tool = 'ball';

  // ---- Settings from the panel ----
  const massFromSlider = (v) => 0.1 * Math.pow(500, v / 100); // 0.1 kg .. 50 kg
  const fmtMass = (m) => (m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + ' kg';
  const settings = { size: 30, mass: 1, bounce: 0.3 };

  function bindSlider(id, apply) {
    const input = $(id), out = $(id + '-out');
    const update = () => { out.textContent = apply(Number(input.value)); };
    input.addEventListener('input', update);
    update();
  }
  bindSlider('size', (v) => { settings.size = v; return String(v); });
  bindSlider('mass', (v) => { settings.mass = massFromSlider(v); return fmtMass(settings.mass); });
  bindSlider('bounce', (v) => { settings.bounce = v / 100; return v + '%'; });

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

  // ---- Layout ----
  function buildWalls() {
    for (const w of walls) world.remove(w);
    const make = (x, y, w, h) => world.add(new Body({
      shape: 'poly', x, y, verts: shapes.box(w, h), isStatic: true, restitution: 1, friction: 0.6,
    }));
    walls = [
      make(W / 2, floorY + WALL / 2, W + WALL * 2, WALL),                 // floor
      make(W / 2, -WALL / 2, W + WALL * 2, WALL),                         // ceiling at the top edge
      make(-WALL / 2, floorY / 2, WALL, floorY + WALL * 2),               // left
      make(W + WALL / 2, floorY / 2, WALL, floorY + WALL * 2),            // right
    ];
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    floorY = panel.getBoundingClientRect().top;
    buildWalls();
    // Pull anything that ended up outside back into view.
    for (const b of world.bodies) {
      if (b.isStatic) continue;
      b.pos.x = Math.min(Math.max(b.pos.x, b.radius), W - b.radius);
      b.pos.y = Math.min(Math.max(b.pos.y, b.radius), floorY - b.radius);
      b.updateGeometry();
    }
    world.wakeAll();
  }
  window.addEventListener('resize', resize);

  // ---- Spawning ----
  function colorFor(mass) {
    // Light objects are pale, heavy ones are deep and dark.
    const t = Math.log(mass / 0.1) / Math.log(500);
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

    // Keep it inside the walls and above the floor.
    body.pos.x = Math.min(Math.max(x, body.radius + 1), W - body.radius - 1);
    body.pos.y = Math.min(Math.max(y, body.radius + 1), floorY - body.radius - 1);
    body.updateGeometry();
    world.add(body);

    const dynamic = world.bodies.filter((b) => !b.isStatic);
    if (dynamic.length > MAX_BODIES) world.remove(dynamic[0]);
    return body;
  }

  // ---- Touch: tap empty space to add, drag a shape to throw it ----
  const grabs = new Map(); // pointerId -> joint

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = vec(e.clientX, e.clientY);
    const hit = world.bodyAt(p);

    if (tool === 'erase') {
      if (hit) world.remove(hit);
      return;
    }
    if (hit) {
      const joint = { body: hit, anchor: hit.worldToLocal(p), target: p, maxForce: 100000 }; // 50 kg lifts, but slowly
      world.joints.push(joint);
      grabs.set(e.pointerId, joint);
    } else if (p.y < floorY) {
      spawn(tool, p.x, p.y);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = vec(e.clientX, e.clientY);
    const joint = grabs.get(e.pointerId);
    if (joint) joint.target = p;
    else if (tool === 'erase' && e.buttons) {
      const hit = world.bodyAt(p);
      if (hit) world.remove(hit);
    }
  });

  const release = (e) => {
    const joint = grabs.get(e.pointerId);
    if (!joint) return;
    world.joints = world.joints.filter((j) => j !== joint);
    grabs.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // ---- Drawing ----
  function drawBody(b) {
    const { hue, light } = b.color;
    ctx.fillStyle = `hsl(${hue}, 70%, ${light}%)`;
    ctx.strokeStyle = `hsl(${hue}, 70%, ${Math.max(light - 22, 8)}%)`;
    ctx.lineWidth = 2;
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

    if (b.radius >= 22) {
      ctx.fillStyle = light > 50 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
      ctx.font = `700 ${Math.min(14, b.radius * 0.45)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtMass(b.mass), b.pos.x, b.pos.y);
    }
  }

  function render() {
    ctx.fillStyle = '#141f23';
    ctx.fillRect(0, 0, W, H);

    // Faint grid for a sense of scale.
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < W; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, floorY); }
    for (let y = floorY; y > 0; y -= 40) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    for (const b of world.bodies) if (!b.isStatic) drawBody(b);

    for (const j of world.joints) {
      const p = j.body.localToWorld(j.anchor);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(j.target.x, j.target.y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
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
    // Drop anything that escaped the box entirely.
    for (const b of world.bodies.slice()) {
      if (!b.isStatic && (b.pos.y > H + 500 || b.pos.x < -WALL || b.pos.x > W + WALL)) world.remove(b);
    }
    render();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  resize();

  // A few starter objects so there's something to play with.
  const cx = W / 2;
  spawn('box', cx - 60, floorY - 40, 22, 2, 0.1);
  spawn('box', cx - 60, floorY - 100, 22, 1, 0.1);
  spawn('box', cx - 60, floorY - 160, 22, 0.5, 0.1);
  spawn('ball', cx + 70, floorY - 250, 30, 20, 0.2);
  spawn('ball', cx + 40, floorY - 400, 16, 0.2, 0.8);
  spawn('hexagon', cx - 20, floorY - 320, 24, 5, 0.2);

  requestAnimationFrame(frame);
})();

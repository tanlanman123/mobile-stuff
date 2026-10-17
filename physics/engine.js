// Tiny 2D rigid-body engine: circles and convex polygons, impulse-based
// contacts with friction and restitution. Screen coordinates (y points down).
const Physics = (() => {
  'use strict';

  const vec = (x, y) => ({ x, y });
  const add = (a, b) => vec(a.x + b.x, a.y + b.y);
  const sub = (a, b) => vec(a.x - b.x, a.y - b.y);
  const scale = (a, s) => vec(a.x * s, a.y * s);
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = (a) => Math.hypot(a.x, a.y);
  const norm = (a) => { const l = len(a) || 1; return vec(a.x / l, a.y / l); };
  const rotate = (p, c, s) => vec(c * p.x - s * p.y, s * p.x + c * p.y);

  let nextId = 1;

  class Body {
    // opts: { shape: 'circle' | 'poly', x, y, radius?, verts?, mass?, angle?,
    //         restitution?, friction?, isStatic?, color? }
    constructor(opts) {
      this.id = nextId++;
      this.shape = opts.shape;
      this.pos = vec(opts.x, opts.y);
      this.vel = vec(0, 0);
      this.angle = opts.angle || 0;
      this.angVel = 0;
      this.restitution = opts.restitution ?? 0.3;
      this.friction = opts.friction ?? 0.4;
      this.isStatic = !!opts.isStatic;
      this.color = opts.color;
      this.sleeping = false; // resting bodies skip simulation until disturbed
      this.restTime = 0;

      if (this.shape === 'poly') {
        this.verts = opts.verts.map((p) => vec(p.x, p.y));
        // Outward edge normals, whatever the winding.
        this.normals = this.verts.map((a, i) => {
          const b = this.verts[(i + 1) % this.verts.length];
          let n = norm(vec(b.y - a.y, a.x - b.x));
          if (dot(n, scale(add(a, b), 0.5)) < 0) n = scale(n, -1);
          return n;
        });
        this.radius = Math.max(...this.verts.map(len));
      } else {
        this.radius = opts.radius;
      }

      this.setMass(opts.mass ?? 1);
      this.wv = [];
      this.wn = [];
      this.updateGeometry();
    }

    setMass(m) {
      if (this.isStatic) {
        this.mass = this.invMass = this.inertia = this.invInertia = 0;
        return;
      }
      this.mass = m;
      this.invMass = 1 / m;
      let k; // inertia per unit mass
      if (this.shape === 'circle') {
        k = (this.radius * this.radius) / 2;
      } else {
        let num = 0, den = 0;
        for (let i = 0; i < this.verts.length; i++) {
          const a = this.verts[i], b = this.verts[(i + 1) % this.verts.length];
          const c = Math.abs(cross(a, b));
          num += c * (dot(a, a) + dot(a, b) + dot(b, b));
          den += c;
        }
        k = num / (6 * den);
      }
      this.inertia = m * k;
      this.invInertia = 1 / this.inertia;
    }

    updateGeometry() {
      if (this.shape === 'poly') {
        const c = Math.cos(this.angle), s = Math.sin(this.angle);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < this.verts.length; i++) {
          const p = add(this.pos, rotate(this.verts[i], c, s));
          this.wv[i] = p;
          this.wn[i] = rotate(this.normals[i], c, s);
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        this.aabb = { minX, minY, maxX, maxY };
      } else {
        const r = this.radius;
        this.aabb = { minX: this.pos.x - r, minY: this.pos.y - r, maxX: this.pos.x + r, maxY: this.pos.y + r };
      }
    }

    containsPoint(p) {
      if (this.shape === 'circle') return len(sub(p, this.pos)) <= this.radius;
      for (let i = 0; i < this.wv.length; i++) {
        if (dot(this.wn[i], sub(p, this.wv[i])) > 0) return false;
      }
      return true;
    }

    localToWorld(p) {
      return add(this.pos, rotate(p, Math.cos(this.angle), Math.sin(this.angle)));
    }

    worldToLocal(p) {
      return rotate(sub(p, this.pos), Math.cos(-this.angle), Math.sin(-this.angle));
    }

    velocityAt(p) {
      const r = sub(p, this.pos);
      return vec(this.vel.x - this.angVel * r.y, this.vel.y + this.angVel * r.x);
    }

    applyImpulse(J, p) {
      const r = sub(p, this.pos);
      this.vel.x += J.x * this.invMass;
      this.vel.y += J.y * this.invMass;
      this.angVel += cross(r, J) * this.invInertia;
    }
  }

  // ---- Narrow phase ----
  // Each returns { a, b, normal (a -> b), contacts: [points], depth } or null.

  function circleCircle(a, b) {
    const d = sub(b.pos, a.pos);
    const dist = len(d);
    const r = a.radius + b.radius;
    if (dist >= r) return null;
    const n = dist > 1e-6 ? scale(d, 1 / dist) : vec(0, 1);
    return { a, b, normal: n, contacts: [add(a.pos, scale(n, a.radius))], depth: r - dist };
  }

  function polyCircle(p, c) {
    const r = c.radius;
    let best = -Infinity, idx = 0;
    for (let i = 0; i < p.wv.length; i++) {
      const s = dot(p.wn[i], sub(c.pos, p.wv[i]));
      if (s > r) return null;
      if (s > best) { best = s; idx = i; }
    }
    const v1 = p.wv[idx], v2 = p.wv[(idx + 1) % p.wv.length];
    const faceN = p.wn[idx];

    if (best < 1e-6) {
      return { a: p, b: c, normal: faceN, contacts: [sub(c.pos, scale(faceN, r))], depth: r - best };
    }
    const d1 = dot(sub(c.pos, v1), sub(v2, v1));
    const d2 = dot(sub(c.pos, v2), sub(v1, v2));
    if (d1 <= 0 || d2 <= 0) {
      const corner = d1 <= 0 ? v1 : v2;
      const d = sub(c.pos, corner);
      const dist = len(d);
      if (dist > r) return null;
      return { a: p, b: c, normal: scale(d, 1 / (dist || 1)), contacts: [corner], depth: r - dist };
    }
    return { a: p, b: c, normal: faceN, contacts: [sub(c.pos, scale(faceN, r))], depth: r - best };
  }

  function leastPenetrationAxis(A, B) {
    let best = -Infinity, idx = 0;
    for (let i = 0; i < A.wv.length; i++) {
      const n = A.wn[i];
      let min = Infinity;
      for (const v of B.wv) {
        const d = v.x * n.x + v.y * n.y;
        if (d < min) min = d;
      }
      const s = min - (A.wv[i].x * n.x + A.wv[i].y * n.y);
      if (s > best) { best = s; idx = i; }
    }
    return [best, idx];
  }

  function clip(n, c, face) {
    const out = [];
    const d1 = dot(n, face[0]) - c;
    const d2 = dot(n, face[1]) - c;
    if (d1 <= 0) out.push(face[0]);
    if (d2 <= 0) out.push(face[1]);
    if (d1 * d2 < 0) {
      const t = d1 / (d1 - d2);
      out.push(add(face[0], scale(sub(face[1], face[0]), t)));
    }
    return out;
  }

  function polyPoly(A, B) {
    const [penA, ia] = leastPenetrationAxis(A, B);
    if (penA >= 0) return null;
    const [penB, ib] = leastPenetrationAxis(B, A);
    if (penB >= 0) return null;

    // Prefer A as the reference shape unless B is clearly better.
    const flip = !(penA >= penB * 0.95 + penA * 0.01);
    const ref = flip ? B : A;
    const inc = flip ? A : B;
    const refIdx = flip ? ib : ia;
    const refN = ref.wn[refIdx];

    let incIdx = 0, min = Infinity;
    for (let i = 0; i < inc.wn.length; i++) {
      const d = dot(inc.wn[i], refN);
      if (d < min) { min = d; incIdx = i; }
    }
    let face = [inc.wv[incIdx], inc.wv[(incIdx + 1) % inc.wv.length]];

    const v1 = ref.wv[refIdx], v2 = ref.wv[(refIdx + 1) % ref.wv.length];
    const side = norm(sub(v2, v1));
    face = clip(scale(side, -1), -dot(side, v1), face);
    if (face.length < 2) return null;
    face = clip(side, dot(side, v2), face);
    if (face.length < 2) return null;

    const refC = dot(refN, v1);
    const contacts = [];
    let depth = 0;
    for (const p of face) {
      const sep = dot(refN, p) - refC;
      if (sep <= 0) { contacts.push(p); depth -= sep; }
    }
    if (!contacts.length) return null;
    return { a: A, b: B, normal: flip ? scale(refN, -1) : refN, contacts, depth: depth / contacts.length };
  }

  function collide(a, b) {
    if (a.shape === 'circle' && b.shape === 'circle') return circleCircle(a, b);
    if (a.shape === 'poly' && b.shape === 'circle') return polyCircle(a, b);
    if (a.shape === 'circle' && b.shape === 'poly') return polyCircle(b, a);
    return polyPoly(a, b);
  }

  // Apply impulse P (from a to b) at contact c, using the manifold's
  // (possibly ratio-limited) masses.
  function applyPairXY(m, c, px, py) {
    const { a, b } = m;
    a.vel.x -= px * m.imA;
    a.vel.y -= py * m.imA;
    a.angVel -= (c.ra.x * py - c.ra.y * px) * m.iiA;
    b.vel.x += px * m.imB;
    b.vel.y += py * m.imB;
    b.angVel += (c.rb.x * py - c.rb.y * px) * m.iiB;
  }
  const applyPair = (m, c, P) => applyPairXY(m, c, P.x, P.y);

  // Velocity of b relative to a at contact c.
  const relVelX = (a, b, c) => b.vel.x - b.angVel * c.rb.y - a.vel.x + a.angVel * c.ra.y;
  const relVelY = (a, b, c) => b.vel.y + b.angVel * c.rb.x - a.vel.y - a.angVel * c.ra.x;

  // ---- World ----
  class World {
    constructor() {
      this.bodies = [];
      this.gravity = vec(0, 1500);
      this.substeps = 2;
      this.iterations = 8;
      this.joints = []; // drag handles: { body, anchor (local), target (world), maxForce }
      this.cache = new Map(); // last step's contact impulses, for warm starting
      this.neighbors = new Map(); // body -> bodies it touched last substep
      // Bodies at least this heavy pull everything else toward them.
      this.attractMass = 10000;
      this.attractK = 1500;      // pull = K * mass / distance^2 (px/s^2)
      this.maxPull = 200000;     // cap so close passes don't explode
      this.maxSpeed = 100000;    // px/s
      this.correction = 0.25; // fraction of overlap fixed per substep
      this.slop = 0.3;        // overlap (px) allowed before correcting
    }

    add(body) { this.bodies.push(body); return body; }

    remove(body) {
      const i = this.bodies.indexOf(body);
      if (i >= 0) this.bodies.splice(i, 1);
      this.joints = this.joints.filter((j) => j.body !== body);
      // Anything it was holding up has to fall now.
      for (const o of this.neighbors.get(body) || []) this.wake(o);
    }

    // Wakes the body and everything touching it, transitively, since a
    // resting pile sleeps and wakes as one group.
    wake(body) {
      if (body.isStatic) return;
      const stack = [body];
      while (stack.length) {
        const b = stack.pop();
        const wasAsleep = b.sleeping;
        b.sleeping = false;
        b.restTime = 0;
        if (!wasAsleep) continue;
        for (const o of this.neighbors.get(b) || []) if (o.sleeping) stack.push(o);
      }
    }

    wakeAll() { for (const b of this.bodies) this.wake(b); }

    bodyAt(p) {
      for (let i = this.bodies.length - 1; i >= 0; i--) {
        const b = this.bodies[i];
        if (!b.isStatic && b.containsPoint(p)) return b;
      }
      return null;
    }

    step(dt) {
      const h = dt / this.substeps;
      for (let s = 0; s < this.substeps; s++) this.substep(h);
      this.updateSleep(dt);
    }

    attractors() {
      return this.bodies.filter((b) => !b.isStatic && b.mass >= this.attractMass);
    }

    // A body falls asleep once it and everything it touches has been nearly
    // still for a moment.
    updateSleep(dt) {
      // A moving attractor changes the pull on everything, so nothing rests.
      if (this.attractors().some((a) => !a.sleeping)) {
        for (const b of this.bodies) if (b.sleeping) this.wake(b);
        return;
      }
      const REST = 0.8;
      for (const b of this.bodies) {
        if (b.isStatic || b.sleeping) continue;
        const slow = b.vel.x * b.vel.x + b.vel.y * b.vel.y < 6 * 6 && Math.abs(b.angVel) < 0.08;
        b.restTime = slow ? b.restTime + dt : 0;
      }
      const grabbed = new Set(this.joints.map((j) => j.body));
      const seen = new Set();
      for (const start of this.bodies) {
        if (start.isStatic || start.sleeping || seen.has(start)) continue;
        // Collect the group of awake bodies touching each other.
        const island = [start];
        seen.add(start);
        let resting = true;
        for (let i = 0; i < island.length; i++) {
          const b = island[i];
          if (b.restTime < REST || grabbed.has(b)) resting = false;
          for (const o of this.neighbors.get(b) || []) {
            if (o.isStatic || o.sleeping || seen.has(o)) continue;
            seen.add(o);
            island.push(o);
          }
        }
        if (!resting) continue;
        for (const b of island) {
          b.sleeping = true;
          b.vel.x = b.vel.y = 0;
          b.angVel = 0;
        }
      }
    }

    substep(h) {
      const bodies = this.bodies;

      for (const j of this.joints) this.wake(j.body);

      for (const b of bodies) {
        if (b.isStatic || b.sleeping) continue;
        b.vel.x += this.gravity.x * h;
        b.vel.y += this.gravity.y * h;
        // Spin drag keeps balls from rolling forever. No linear drag, so
        // orbits last.
        b.angVel *= 1 - 0.6 * h;
      }

      // Heavy bodies attract everything else, like planets.
      const attractors = this.attractors();
      if (attractors.length) {
        for (const b of bodies) {
          if (b.isStatic || b.sleeping) continue;
          for (const a of attractors) {
            if (a === b) continue;
            const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y;
            const d2 = dx * dx + dy * dy;
            // Softened inside the attractor so the pull stays finite.
            const soft = Math.max(d2, a.radius * a.radius);
            const pull = Math.min(this.attractK * a.mass / soft, this.maxPull);
            const d = Math.sqrt(d2) || 1;
            b.vel.x += (dx / d) * pull * h;
            b.vel.y += (dy / d) * pull * h;
          }
        }
      }

      for (const j of this.joints) {
        const b = j.body;
        const p = b.localToWorld(j.anchor);
        const desired = scale(sub(j.target, p), 18);
        let J = scale(sub(desired, b.velocityAt(p)), b.mass * 0.25);
        const maxJ = j.maxForce * h;
        const m = len(J);
        if (m > maxJ) J = scale(J, maxJ / m);
        b.applyImpulse(J, p);
      }

      const manifolds = this.broadphase();
      // Getting hit by something moving wakes a sleeping body. Slow
      // neighbors just lean on it as if it were solid ground.
      const moving = (b) => !b.isStatic && !b.sleeping && b.restTime === 0;
      for (const m of manifolds) {
        if (m.a.sleeping && moving(m.b)) this.wake(m.a);
        if (m.b.sleeping && moving(m.a)) this.wake(m.b);
      }
      // Sleeping bodies keep who they were touching, so removing one of
      // them can wake the rest.
      const prevNeighbors = this.neighbors;
      this.neighbors = new Map();
      for (const b of bodies) if (b.sleeping && prevNeighbors.has(b)) this.neighbors.set(b, prevNeighbors.get(b).slice());
      for (const m of manifolds) {
        if (!this.neighbors.has(m.a)) this.neighbors.set(m.a, []);
        if (!this.neighbors.has(m.b)) this.neighbors.set(m.b, []);
        this.neighbors.get(m.a).push(m.b);
        this.neighbors.get(m.b).push(m.a);
      }
      const level = this.groundLevels();
      const lvl = (b) => level.get(b) ?? Infinity;
      // Solve from the ground up.
      for (const m of manifolds) m.order = Math.min(lvl(m.a), lvl(m.b));
      manifolds.sort((p, q) => p.order - q.order);

      for (const m of manifolds) {
        const { a, b, normal: n } = m;
        const la = lvl(a), lb = lvl(b);

        // Mass-ratio limit: a light body pinned under a heavy one is treated
        // as at most MAX_RATIO times lighter in this contact, or the solver
        // can't hold the stack together. Free collisions keep real masses.
        const MAX_RATIO = 10;
        m.imA = a.sleeping ? 0 : a.invMass; m.iiA = a.sleeping ? 0 : a.invInertia;
        m.imB = b.sleeping ? 0 : b.invMass; m.iiB = b.sleeping ? 0 : b.invInertia;
        if (la < lb && b.invMass > 0 && a.invMass > b.invMass * MAX_RATIO) {
          const f = (b.invMass * MAX_RATIO) / a.invMass;
          m.imA *= f; m.iiA *= f;
        } else if (lb < la && a.invMass > 0 && b.invMass > a.invMass * MAX_RATIO) {
          const f = (a.invMass * MAX_RATIO) / b.invMass;
          m.imB *= f; m.iiB *= f;
        }

        m.e = Math.min(a.restitution, b.restitution);
        m.mu = Math.sqrt(a.friction * b.friction);
        m.points = m.contacts.map((p) => {
          const ra = sub(p, a.pos), rb = sub(p, b.pos);
          const t = vec(-n.y, n.x);
          const rnA = cross(ra, n), rnB = cross(rb, n);
          const rtA = cross(ra, t), rtB = cross(rb, t);
          const kN = m.imA + m.imB + rnA * rnA * m.iiA + rnB * rnB * m.iiB;
          const kT = m.imA + m.imB + rtA * rtA * m.iiA + rtB * rtB * m.iiB;
          const vn = dot(sub(b.velocityAt(p), a.velocityAt(p)), n);
          return {
            p, ra, rb, t,
            massN: kN > 0 ? 1 / kN : 0,
            massT: kT > 0 ? 1 / kT : 0,
            bounce: vn < -80 ? -m.e * vn : 0,
            Pn: 0, Pt: 0,
          };
        });

      }

      // Warm start: begin from last step's impulses at the same spots, which
      // is what lets stacks stand still. Done after every bounce speed above
      // is measured, so resting contacts don't look like impacts.
      const nextCache = new Map();
      for (const m of manifolds) {
        const key = m.a.id + ':' + m.b.id;
        const prev = this.cache.get(key);
        if (prev) {
          for (const c of m.points) {
            const old = prev.find((o) => Math.abs(o.p.x - c.p.x) < 4 && Math.abs(o.p.y - c.p.y) < 4);
            if (!old) continue;
            c.Pn = old.Pn;
            c.Pt = old.Pt;
            applyPair(m, c, add(scale(m.normal, c.Pn), scale(c.t, c.Pt)));
          }
        }
        const { a, b } = m;
        m.points.asleep = () => (a.sleeping || a.isStatic) && (b.sleeping || b.isStatic) && this.bodies.includes(a) && this.bodies.includes(b);
        nextCache.set(key, m.points);
      }
      // Pairs skipped because both sides are asleep keep their impulses,
      // so waking up is smooth instead of a jolt.
      for (const [key, pts] of this.cache) {
        if (!nextCache.has(key) && pts.asleep()) nextCache.set(key, pts);
      }
      this.cache = nextCache;

      for (let it = 0; it < this.iterations; it++) {
        for (const m of manifolds) {
          const { a, b, normal: n } = m;
          for (const c of m.points) {
            const vn = relVelX(a, b, c) * n.x + relVelY(a, b, c) * n.y;
            const newPn = Math.max(c.Pn + c.massN * (-vn + c.bounce), 0);
            const dPn = newPn - c.Pn;
            c.Pn = newPn;
            applyPairXY(m, c, n.x * dPn, n.y * dPn);

            const vt = relVelX(a, b, c) * c.t.x + relVelY(a, b, c) * c.t.y;
            const maxPt = m.mu * c.Pn;
            const newPt = Math.max(-maxPt, Math.min(maxPt, c.Pt - c.massT * vt));
            const dPt = newPt - c.Pt;
            c.Pt = newPt;
            applyPairXY(m, c, c.t.x * dPt, c.t.y * dPt);
          }
        }
      }

      for (const b of bodies) {
        if (b.isStatic || b.sleeping) continue;
        const sp = Math.hypot(b.vel.x, b.vel.y);
        if (sp > this.maxSpeed) { b.vel.x *= this.maxSpeed / sp; b.vel.y *= this.maxSpeed / sp; }
        b.pos.x += b.vel.x * h;
        b.pos.y += b.vel.y * h;
        b.angle += b.angVel * h;
      }

      // Push overlapping bodies apart, ground up; the lower body stays put.
      for (const m of manifolds) {
        const { a, b, normal: n } = m;
        const la = lvl(a), lb = lvl(b);
        const imA = la < lb || a.sleeping ? 0 : a.invMass;
        const imB = lb < la || b.sleeping ? 0 : b.invMass;
        const total = imA + imB;
        if (total === 0) continue;
        const k = (Math.max(m.depth - this.slop, 0) / total) * this.correction;
        a.pos.x -= n.x * k * imA;
        a.pos.y -= n.y * k * imA;
        b.pos.x += n.x * k * imB;
        b.pos.y += n.y * k * imB;
      }

      for (const b of bodies) if (!b.isStatic && !b.sleeping) b.updateGeometry();
    }

    // How many contacts away from a static body each body is.
    groundLevels() {
      const level = new Map();
      const queue = [];
      for (const b of this.bodies) if (b.isStatic) { level.set(b, 0); queue.push(b); }
      for (let i = 0; i < queue.length; i++) {
        const b = queue[i];
        for (const o of this.neighbors.get(b) || []) {
          if (!level.has(o)) { level.set(o, level.get(b) + 1); queue.push(o); }
        }
      }
      return level;
    }

    // Sort-and-sweep on x, then exact tests.
    broadphase() {
      const list = this.bodies.slice().sort((p, q) => p.aabb.minX - q.aabb.minX);
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let k = i + 1; k < list.length; k++) {
          const b = list[k];
          if (b.aabb.minX > a.aabb.maxX) break;
          if ((a.isStatic || a.sleeping) && (b.isStatic || b.sleeping)) continue;
          if (b.aabb.minY > a.aabb.maxY || b.aabb.maxY < a.aabb.minY) continue;
          const m = a.id < b.id ? collide(a, b) : collide(b, a);
          if (m) out.push(m);
        }
      }
      return out;
    }
  }

  // ---- Shape helpers (local vertices centered on the centroid) ----
  const shapes = {
    box: (w, h) => [vec(-w / 2, -h / 2), vec(w / 2, -h / 2), vec(w / 2, h / 2), vec(-w / 2, h / 2)],
    regular: (sides, r) => Array.from({ length: sides }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
      return vec(Math.cos(a) * r, Math.sin(a) * r);
    }),
  };

  return { Body, World, shapes, vec };
})();

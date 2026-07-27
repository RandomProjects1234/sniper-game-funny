/* =========================================================================
   LONGSHOT — soldiers, ballistics and effects.
   ========================================================================= */
(function (global) {
  'use strict';

  const { clamp, lerp, m4, m4trs, m4mul } = global.E;
  const LAYOUT = global.World.LAYOUT;

  /* ------------------------- intersection tests ------------------------ */

  /* Segment p0->p1 against an axis-aligned box. Returns hit t in [0,1] or -1. */
  function segAABB(p0, p1, min, max) {
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 3; i++) {
      const d = p1[i] - p0[i];
      if (Math.abs(d) < 1e-8) {
        if (p0[i] < min[i] || p0[i] > max[i]) return -1;
        continue;
      }
      let a = (min[i] - p0[i]) / d;
      let b = (max[i] - p0[i]) / d;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return -1;
    }
    return t0;
  }

  function segSphere(p0, p1, c, r) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const ox = p0[0] - c[0], oy = p0[1] - c[1], oz = p0[2] - c[2];
    const a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-9) return -1;
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t = (-b - sq) / (2 * a);
    if (t < 0) t = (-b + sq) / (2 * a);
    if (t < 0 || t > 1) return -1;
    return t;
  }

  /* ---------------------------- soldier types --------------------------- */

  const TYPES = {
    grunt: {
      name: 'GRUNT', hp: 100, speed: 5.0, score: 100, color: [0.42, 0.46, 0.30],
      accent: [0.32, 0.34, 0.24], scale: 1.0, coverChance: 0.35,
    },
    runner: {
      name: 'RUNNER', hp: 65, speed: 9.4, score: 160, color: [0.56, 0.30, 0.24],
      accent: [0.40, 0.20, 0.18], scale: 0.94, coverChance: 0.08,
    },
    heavy: {
      name: 'HEAVY', hp: 340, speed: 3.2, score: 300, color: [0.30, 0.33, 0.38],
      accent: [0.20, 0.22, 0.26], scale: 1.16, coverChance: 0.2, shield: true,
    },
    marksman: {
      name: 'MARKSMAN', hp: 85, speed: 4.2, score: 260, color: [0.34, 0.30, 0.22],
      accent: [0.24, 0.22, 0.16], scale: 1.0, coverChance: 0.5, shooter: true,
    },
    bomber: {
      name: 'BOMBER', hp: 110, speed: 10.4, score: 240, color: [0.62, 0.48, 0.14],
      accent: [0.44, 0.32, 0.10], scale: 1.02, coverChance: 0.0, bomber: true,
    },
  };

  /* Beyond this line the town is out of comfortable range, so hostiles
     double-time through it instead of making the player wait. */
  const APPROACH_Z = -300;

  /* ------------------------------ soldier ------------------------------- */

  let NEXT_ID = 1;

  class Soldier {
    constructor(typeKey, lane, wave, rng) {
      const t = TYPES[typeKey];
      this.id = NEXT_ID++;
      this.type = typeKey;
      this.def = t;
      this.rng = rng;

      const hpScale = 1 + (wave - 1) * 0.13;
      this.maxHp = t.hp * hpScale;
      this.hp = this.maxHp;
      this.speed = t.speed * (1 + (wave - 1) * 0.022) * (0.9 + rng() * 0.2);
      this.scale = t.scale;

      this.x = lane + (rng() - 0.5) * 9;
      this.z = LAYOUT.spawnZ - rng() * 60;
      this.y = 0;
      this.lane = lane;
      this.yaw = 0;

      this.state = 'advance';
      this.stateTime = 0;
      this.crouch = 0;
      this.walkPhase = rng() * 10;
      this.weave = rng() * Math.PI * 2;
      this.dead = false;
      this.deadTime = 0;
      this.fall = 0;
      this.fallDir = 0;
      this.slideX = 0;
      this.slideZ = 0;
      this.hitFlash = 0;
      this.breached = false;
      this.removed = false;
      this.aimTime = 0;
      this.shotsFired = 0;
      this.nextCoverCheck = 1 + rng() * 3;
      this.limp = 1;
      this.marked = 0;

      // marksmen halt at a stand-off distance and start working on you
      this.holdZ = t.shooter ? -170 - rng() * 150 : null;
    }

    get headPos() {
      return [this.x, (1.72 - this.crouch * 0.45) * this.scale, this.z];
    }

    get centerPos() {
      return [this.x, (1.25 - this.crouch * 0.35) * this.scale, this.z];
    }

    distanceTo(p) {
      return Math.hypot(this.x - p[0], this.centerPos[1] - p[1], this.z - p[2]);
    }

    /* --------------------------- simulation --------------------------- */

    update(dt, ctx) {
      if (this.dead) {
        this.deadTime += dt;
        this.fall = Math.min(1, this.fall + dt * 3.4);
        this.slideX *= Math.exp(-dt * 4);
        this.slideZ *= Math.exp(-dt * 4);
        this.x += this.slideX * dt;
        this.z += this.slideZ * dt;
        if (this.deadTime > 9) this.removed = true;
        return;
      }

      this.stateTime += dt;
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      this.marked = Math.max(0, this.marked - dt);

      const px = ctx.player[0], pz = ctx.player[2];

      if (this.state === 'cover') {
        this.crouch = Math.min(1, this.crouch + dt * 4);
        if (this.stateTime > this.coverDuration) this.setState('advance');
        this.faceTowards(px, pz, dt, 4);
        return;
      }

      if (this.state === 'aim') {
        this.crouch = Math.min(1, this.crouch + dt * 3);
        this.faceTowards(px, pz, dt, 3);
        this.aimTime += dt;
        if (this.aimTime >= this.aimDuration) {
          ctx.onEnemyFire(this);
          this.shotsFired++;
          this.aimTime = 0;
          this.aimDuration = 2.6 + this.rng() * 2.2;
          if (this.rng() < 0.55) {
            // reposition after firing so they do not become a fixed turret
            this.setState('advance');
            this.holdZ = this.z + 40 + this.rng() * 55;
          }
        }
        return;
      }

      // advancing
      this.crouch = Math.max(0, this.crouch - dt * 4);

      if (this.def.shooter && this.holdZ !== null && this.z >= this.holdZ) {
        this.setState('aim');
        this.aimDuration = 2.4 + this.rng() * 2.0;
        this.aimTime = 0;
        return;
      }

      // Steer: run the lane until close, then converge on the gate.
      let tx, tz;
      if (this.z > -200) { tx = 0; tz = LAYOUT.gate.z; }
      else { tx = this.lane; tz = this.z + 60; }

      this.weave += dt * 1.5;
      tx += Math.sin(this.weave) * (this.def.bomber ? 1.5 : 4.5);

      let dx = tx - this.x, dz = tz - this.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;

      const spd = this.speed * this.limp * (this.z < APPROACH_Z ? 1.7 : 1);
      this.x += dx * spd * dt;
      this.z += dz * spd * dt;
      this.yaw = Math.atan2(dx, dz);
      this.walkPhase += dt * spd * 1.55;

      // duck behind cover occasionally — makes clean shots a skill check
      this.nextCoverCheck -= dt;
      if (this.nextCoverCheck <= 0) {
        this.nextCoverCheck = 1.6 + this.rng() * 3.2;
        if (this.rng() < this.def.coverChance && this.z < -100) {
          this.setState('cover');
          this.coverDuration = 0.7 + this.rng() * 1.6;
        }
      }

      if (this.z >= LAYOUT.gate.z - 1.5) {
        this.breached = true;
      }
    }

    setState(s) { this.state = s; this.stateTime = 0; }

    faceTowards(px, pz, dt, rate) {
      const want = Math.atan2(px - this.x, pz - this.z);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * rate);
    }

    /* ----------------------------- damage ----------------------------- */

    /* Returns a hit descriptor, or null when the segment misses. */
    raycast(p0, p1) {
      const s = this.scale, c = this.crouch;
      const cs = Math.cos(-this.yaw), sn = Math.sin(-this.yaw);
      const toLocal = (p) => {
        const dx = p[0] - this.x, dy = p[1] - this.y, dz = p[2] - this.z;
        return [dx * cs - dz * sn, dy, dx * sn + dz * cs];
      };
      const a = toLocal(p0), b = toLocal(p1);

      const lean = this.dead ? 1 : 1;
      const yTop = (v) => (v - c * 0.45) * s * lean;

      let best = null;
      const consider = (t, zone) => {
        if (t < 0) return;
        if (!best || t < best.t) best = { t, zone };
      };

      // head
      consider(segSphere(a, b, [0, yTop(1.72), 0], 0.185 * s), 'head');
      // torso
      consider(segAABB(a, b,
        [-0.31 * s, yTop(0.92), -0.24 * s],
        [0.31 * s, yTop(1.66), 0.24 * s]), 'body');
      // legs
      consider(segAABB(a, b,
        [-0.27 * s, 0, -0.20 * s],
        [0.27 * s, yTop(0.92), 0.20 * s]), 'legs');

      if (!best) return null;

      // heavies carry a plate in front: frontal torso hits skip off it.
      // Local +Z is the soldier's facing, so a frontal round travels -Z.
      if (this.def.shield && best.zone === 'body') {
        if (b[2] - a[2] < 0) best.shield = true;
      }
      return best;
    }

    applyHit(hit, damage, opts) {
      const o = opts || {};
      let dmg = damage;
      let lethal = false;
      let kind = hit.zone;

      if (hit.shield && !o.armorPiercing) {
        this.hitFlash = 1;
        return { kind: 'shield', damage: 0, killed: false };
      }
      if (hit.zone === 'head') {
        dmg = this.def.shield ? damage * 2.2 : damage * 12;
      } else if (hit.zone === 'legs') {
        dmg = damage * 0.55;
        this.limp = 0.45;
      }
      if (hit.shield && o.armorPiercing) dmg *= 0.6;

      this.hp -= dmg;
      this.hitFlash = 1;
      if (this.hp <= 0) {
        lethal = true;
        this.kill(o.dirX || 0, o.dirZ || 0, hit.zone === 'head');
      }
      return { kind, damage: dmg, killed: lethal };
    }

    kill(dirX, dirZ, headshot) {
      if (this.dead) return;
      this.dead = true;
      this.deadTime = 0;
      this.fall = 0;
      this.headshot = headshot;
      const push = headshot ? 5.5 : 3.2;
      this.slideX = dirX * push;
      this.slideZ = dirZ * push;
      // topple away from the shooter
      const local = Math.cos(this.yaw) * dirZ + Math.sin(this.yaw) * dirX;
      this.fallDir = local > 0 ? 1 : -1;
    }

    /* ------------------------------ draw ------------------------------- */

    draw(rnd, M, tintScale) {
      const s = this.scale;
      const def = this.def;
      const flash = this.hitFlash;
      const root = M.root, tmp = M.tmp, out = M.out;

      const fallPitch = this.dead ? this.fallDir * this.fall * 1.48 : 0;
      const sink = this.dead ? -0.02 : 0;
      const crouchDrop = -this.crouch * 0.34 * s;

      m4trs(root, this.yaw, fallPitch, 0, this.x, this.y + sink, this.z, s, s, s);

      const walking = !this.dead && this.state === 'advance';
      const ph = this.walkPhase;
      const swing = walking ? Math.sin(ph) * 0.62 : 0;
      const swing2 = walking ? Math.sin(ph + Math.PI) * 0.62 : 0;
      const bob = walking ? Math.abs(Math.sin(ph)) * 0.045 : 0;

      const hipY = 0.92 + crouchDrop / s + bob;
      const base = [def.color[0], def.color[1], def.color[2]];
      const accent = def.accent;

      const put = (mesh, yaw, pitch, roll, x, y, z, col, emissive) => {
        m4trs(tmp, yaw, pitch, roll, x, y, z, 1, 1, 1);
        m4mul(out, root, tmp);
        const f = flash * 0.9;
        rnd.setMaterial(
          (col[0] + f) * tintScale, (col[1] + f * 0.35) * tintScale,
          (col[2] + f * 0.3) * tintScale, emissive || 0, 1);
        rnd.draw(mesh, out);
      };

      const meshes = M.meshes;
      put(meshes.hips, 0, 0, 0, 0, hipY, 0, accent);
      put(meshes.torso, 0, walking ? Math.sin(ph) * 0.05 : 0, 0, 0, hipY, 0, base);
      const headPitch = this.dead ? 0.4 : (this.state === 'aim' ? -0.08 : 0);
      put(meshes.head, walking ? Math.sin(ph * 0.5) * 0.12 : 0, headPitch, 0, 0, hipY + 0.7, 0,
        [base[0] * 0.85 + 0.12, base[1] * 0.85 + 0.10, base[2] * 0.85 + 0.08]);

      // legs
      put(meshes.leg, 0, swing, 0, -0.13, hipY, 0, accent);
      put(meshes.leg, 0, swing2, 0, 0.13, hipY, 0, accent);

      // arms — carrying the rifle across the chest, or shouldered when aiming
      const aiming = this.state === 'aim';
      const armY = hipY + 0.56;
      if (aiming) {
        put(meshes.arm, 0.3, -1.35, 0.2, -0.30, armY, 0.02, base);
        put(meshes.arm, -0.3, -1.5, -0.25, 0.30, armY, 0.02, base);
        put(meshes.rifle, 0, -0.05, 0, 0.02, armY - 0.06, 0.34, [1, 1, 1]);
        // scope glint, telegraphing the incoming shot
        const g = 0.55 + 0.45 * Math.sin(this.stateTime * 12);
        rnd.setMaterial(1.6 * g, 0.35 * g, 0.25 * g, 1, 1);
        m4trs(tmp, 0, 0, 0, 0.02, armY + 0.06, 0.42, 1, 1, 1);
        m4mul(out, root, tmp);
        rnd.draw(meshes.glint, out);
      } else {
        put(meshes.arm, 0.35, -0.9 + swing2 * 0.25, 0.35, -0.31, armY, 0.05, base);
        put(meshes.arm, -0.35, -1.05 + swing * 0.25, -0.35, 0.31, armY, 0.05, base);
        put(meshes.rifle, 0.45, -0.15, 0, 0.06, armY - 0.18, 0.30, [1, 1, 1]);
      }

      if (def.shield) {
        put(meshes.shield, 0, 0, 0, 0, hipY + 0.42, 0.30, [1, 1, 1]);
      }
      if (def.bomber) {
        // strapped charge with a blinking detonator
        const blink = 0.5 + 0.5 * Math.sin(this.stateTime * 9);
        put(meshes.cube, 0, 0, 0, 0, hipY + 0.42, -0.28, [0.5, 0.4, 0.15]);
        rnd.setMaterial(1.8 * blink, 0.25, 0.15, 1, 1);
        m4trs(tmp, 0, 0, 0, 0, hipY + 0.62, -0.30, 0.10, 0.10, 0.10);
        m4mul(out, root, tmp);
        rnd.draw(meshes.cube, out);
      }
    }
  }

  /* ------------------------------ bullet -------------------------------- */

  const GRAVITY = 9.81;

  class Bullet {
    constructor(px, py, pz, dx, dy, dz, cfg) {
      this.x = px; this.y = py; this.z = pz;
      const v = cfg.speed;
      this.vx = dx * v; this.vy = dy * v; this.vz = dz * v;
      this.px = px; this.py = py; this.pz = pz;
      this.alive = true;
      this.dist = 0;
      this.time = 0;
      this.damage = cfg.damage;
      this.pierce = cfg.pierce || 0;
      this.armorPiercing = !!cfg.armorPiercing;
      this.windScale = cfg.windScale != null ? cfg.windScale : 1;
      this.tracked = !!cfg.tracked;
      this.hitIds = new Set();
      this.trail = [];
      this.impact = null;
    }

    get dir() {
      const l = Math.hypot(this.vx, this.vy, this.vz) || 1;
      return [this.vx / l, this.vy / l, this.vz / l];
    }

    update(dt, ctx) {
      if (!this.alive) return;
      const speed = Math.hypot(this.vx, this.vy, this.vz);
      const steps = clamp(Math.ceil((speed * dt) / 1.4), 1, 48);
      const h = dt / steps;

      for (let i = 0; i < steps && this.alive; i++) {
        const p0 = [this.x, this.y, this.z];
        this.vy -= GRAVITY * h;
        this.vx += ctx.wind[0] * this.windScale * h;
        this.vz += ctx.wind[1] * this.windScale * h;
        this.x += this.vx * h;
        this.y += this.vy * h;
        this.z += this.vz * h;
        this.time += h;
        const p1 = [this.x, this.y, this.z];
        this.dist += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);

        // soldiers first — they are the interesting collision
        let bestT = 2, bestEnemy = null, bestHit = null;
        for (const e of ctx.enemies) {
          if (e.dead || e.removed || this.hitIds.has(e.id)) continue;
          if (Math.abs(e.x - this.x) > 40 && Math.abs(e.z - this.z) > 40) continue;
          const hit = e.raycast(p0, p1);
          if (hit && hit.t < bestT) { bestT = hit.t; bestEnemy = e; bestHit = hit; }
        }

        // world geometry
        let blockT = 2, blockNormalY = 0;
        for (const bl of ctx.blockers) {
          if (p0[1] > bl.top && p1[1] > bl.top) continue;
          if (Math.min(p0[0], p1[0]) > bl.max[0] || Math.max(p0[0], p1[0]) < bl.min[0]) continue;
          if (Math.min(p0[2], p1[2]) > bl.max[2] || Math.max(p0[2], p1[2]) < bl.min[2]) continue;
          const t = segAABB(p0, p1, bl.min, bl.max);
          if (t >= 0 && t < blockT) { blockT = t; blockNormalY = 0; }
        }
        if (p1[1] <= 0) {
          const t = p0[1] === p1[1] ? 0 : p0[1] / (p0[1] - p1[1]);
          if (t < blockT) { blockT = t; blockNormalY = 1; }
        }

        if (bestEnemy && bestT <= blockT) {
          const at = [lerp(p0[0], p1[0], bestT), lerp(p0[1], p1[1], bestT), lerp(p0[2], p1[2], bestT)];
          const d = this.dir;
          const res = bestEnemy.applyHit(bestHit, this.damage, {
            armorPiercing: this.armorPiercing, dirX: d[0], dirZ: d[2],
          });
          this.hitIds.add(bestEnemy.id);
          ctx.onHitEnemy(this, bestEnemy, bestHit, res, at);
          if (res.kind === 'shield') {
            this.alive = false;
            this.impact = { at, kind: 'shield' };
          } else if (this.pierce > 0 && res.killed) {
            this.pierce--;
            this.damage *= 0.75;
          } else {
            this.alive = false;
            this.impact = { at, kind: 'flesh' };
          }
          continue;
        }

        if (blockT <= 1) {
          const at = [lerp(p0[0], p1[0], blockT), lerp(p0[1], p1[1], blockT), lerp(p0[2], p1[2], blockT)];
          this.alive = false;
          this.impact = { at, kind: blockNormalY ? 'dirt' : 'wall' };
          ctx.onHitWorld(this, at, blockNormalY ? 'dirt' : 'wall');
          continue;
        }

        if (this.dist > 2400 || this.y < -60) this.alive = false;
      }

      this.trail.push([this.x, this.y, this.z, 0]);
      if (this.trail.length > 26) this.trail.shift();
    }
  }

  /* ---------------------------- particles ------------------------------- */

  class Particles {
    constructor(max) {
      this.max = max || 520;
      this.list = [];
    }

    spawn(x, y, z, opts) {
      if (this.list.length >= this.max) this.list.shift();
      this.list.push({
        x, y, z,
        vx: opts.vx, vy: opts.vy, vz: opts.vz,
        life: opts.life, maxLife: opts.life,
        size: opts.size, color: opts.color,
        gravity: opts.gravity != null ? opts.gravity : 12,
        drag: opts.drag != null ? opts.drag : 1.2,
        emissive: opts.emissive || 0,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * 6.28,
      });
    }

    burst(x, y, z, kind, dir, power) {
      const P = (n, cfg) => {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const e = Math.random() * Math.PI * 0.5;
          const sp = cfg.speed * (0.35 + Math.random());
          this.spawn(x, y, z, {
            vx: (Math.cos(a) * Math.cos(e) + (dir ? dir[0] * 0.9 : 0)) * sp,
            vy: (Math.sin(e) + 0.4) * sp,
            vz: (Math.sin(a) * Math.cos(e) + (dir ? dir[2] * 0.9 : 0)) * sp,
            life: cfg.life * (0.6 + Math.random() * 0.8),
            size: cfg.size * (0.5 + Math.random()),
            color: cfg.color(),
            gravity: cfg.gravity,
            emissive: cfg.emissive,
          });
        }
      };
      const p = power || 1;
      if (kind === 'flesh') {
        P(Math.round(16 * p), {
          speed: 6 * p, life: 0.9, size: 0.13, gravity: 16, emissive: 0,
          color: () => [0.45 + Math.random() * 0.25, 0.05, 0.06],
        });
        P(Math.round(6 * p), {
          speed: 3 * p, life: 1.4, size: 0.09, gravity: 5, emissive: 0,
          color: () => [0.30, 0.03, 0.04],
        });
      } else if (kind === 'dirt') {
        P(18, {
          speed: 7, life: 1.0, size: 0.16, gravity: 20, emissive: 0,
          color: () => [0.62 + Math.random() * 0.2, 0.55 + Math.random() * 0.18, 0.40],
        });
      } else if (kind === 'wall') {
        P(16, {
          speed: 8, life: 0.8, size: 0.13, gravity: 22, emissive: 0,
          color: () => [0.70 + Math.random() * 0.2, 0.66, 0.58],
        });
        P(5, {
          speed: 11, life: 0.25, size: 0.07, gravity: 6, emissive: 1,
          color: () => [1.6, 1.1, 0.5],
        });
      } else if (kind === 'shield') {
        P(14, {
          speed: 12, life: 0.35, size: 0.08, gravity: 10, emissive: 1,
          color: () => [1.8, 1.4, 0.6],
        });
      } else if (kind === 'boom') {
        P(46, {
          speed: 16, life: 1.3, size: 0.3, gravity: 14, emissive: 0,
          color: () => [0.35, 0.32, 0.30],
        });
        P(26, {
          speed: 22, life: 0.5, size: 0.22, gravity: 4, emissive: 1,
          color: () => [1.8, 0.8 + Math.random() * 0.6, 0.25],
        });
      } else if (kind === 'muzzle') {
        P(10, {
          speed: 9, life: 0.16, size: 0.07, gravity: 2, emissive: 1,
          color: () => [1.8, 1.2, 0.5],
        });
      }
    }

    update(dt) {
      const l = this.list;
      for (let i = l.length - 1; i >= 0; i--) {
        const p = l[i];
        p.life -= dt;
        if (p.life <= 0) { l.splice(i, 1); continue; }
        p.vy -= p.gravity * dt;
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vz *= d;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += p.spin * dt;
        if (p.y < 0.03) {
          p.y = 0.03;
          p.vy *= -0.28;
          p.vx *= 0.6; p.vz *= 0.6;
          if (p.life > 0.35) p.life = 0.35;
        }
      }
    }

    draw(rnd, cube) {
      for (const p of this.list) {
        const t = clamp(p.life / p.maxLife, 0, 1);
        const s = p.size * (0.35 + t * 0.65);
        rnd.setMaterial(p.color[0], p.color[1], p.color[2], p.emissive, 1);
        rnd.drawAt(cube, p.rot, p.rot * 0.7, 0, p.x, p.y, p.z, s, s, s);
      }
    }
  }

  global.Ent = { TYPES, Soldier, Bullet, Particles, segAABB, segSphere, GRAVITY };
})(window);

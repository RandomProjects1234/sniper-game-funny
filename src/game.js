/* =========================================================================
   LONGSHOT — game rules, input, camera, HUD.
   ========================================================================= */
(function (global) {
  'use strict';

  const { clamp, lerp, damp, m4, m4trs } = global.E;
  const LAYOUT = global.World.LAYOUT;
  const AUD = global.AUD;

  const $ = (id) => document.getElementById(id);

  /* --------------------------- configuration --------------------------- */

  const BASE = {
    magSize: 5,
    damage: 100,
    muzzle: 480,
    boltTime: 1.15,
    reloadTime: 2.55,
    swayAmp: 0.0026,
    breathMax: 4.2,
    focusTime: 5.0,
    focusGain: 1,
    maxHealth: 100,
    zoomStops: [4, 8],
    windScale: 1,
    pierce: 0,
    armorPiercing: false,
    integrityShield: 0,
  };

  const HIP_FOV = 78;
  const EYE_STAND = LAYOUT.nest.y + 1.0;   // just clears the sandbag rest
  const EYE_DUCK = LAYOUT.nest.y - 0.4;    // below the parapet, out of the glass
  const HOME_Z = LAYOUT.nest.z - 5.5;

  const BREACH_COST = { grunt: 12, runner: 10, heavy: 20, marksman: 10, bomber: 28 };

  const UPGRADES = [
    { id: 'steady', name: 'STEADY HANDS', max: 3, desc: 'Scope sway reduced 30%.', apply: (s) => { s.swayAmp *= 0.7; } },
    { id: 'match', name: 'MATCH AMMO', max: 3, desc: 'Muzzle velocity +22%. Flatter arc, less lead.', apply: (s) => { s.muzzle *= 1.22; } },
    { id: 'bolt', name: 'QUICK BOLT', max: 3, desc: 'Bolt cycle 25% faster.', apply: (s) => { s.boltTime *= 0.75; } },
    { id: 'mag', name: 'EXTENDED MAG', max: 4, desc: '+2 rounds in the magazine.', apply: (s) => { s.magSize += 2; } },
    { id: 'hands', name: 'FAST HANDS', max: 2, desc: 'Reload 32% faster.', apply: (s) => { s.reloadTime *= 0.68; } },
    { id: 'lungs', name: 'DEEP LUNGS', max: 3, desc: 'Breath hold +55%.', apply: (s) => { s.breathMax *= 1.55; } },
    { id: 'adrenaline', name: 'ADRENALINE', max: 3, desc: 'FOCUS charges 45% faster.', apply: (s) => { s.focusGain *= 1.45; } },
    { id: 'calibre', name: 'HIGH CALIBRE', max: 3, desc: 'Damage +40%.', apply: (s) => { s.damage *= 1.4; } },
    { id: 'ap', name: 'AP ROUNDS', max: 1, desc: 'Rounds punch through HEAVY shields.', apply: (s) => { s.armorPiercing = true; } },
    { id: 'pierce', name: 'OVERPENETRATION', max: 2, desc: 'Kills let the round carry on to the next body.', apply: (s) => { s.pierce += 1; } },
    { id: 'ghost', name: 'GHOST LOAD', max: 2, desc: 'Wind pushes your round 50% less.', apply: (s) => { s.windScale *= 0.5; } },
    { id: 'eagle', name: 'EAGLE EYE', max: 1, desc: 'Adds a 16x zoom stop.', apply: (s) => { s.zoomStops = [4, 8, 16]; } },
    { id: 'medic', name: 'FIELD MEDIC', max: 2, desc: '+35 max health, and patch up now.', apply: (s) => { s.maxHealth += 35; } },
    { id: 'reinforce', name: 'REINFORCE GATE', max: 3, desc: 'Repair 35 integrity, breaches cost 20% less.', apply: (s) => { s.integrityShield += 0.2; } },
    { id: 'discipline', name: 'TRIGGER DISCIPLINE', max: 1, desc: 'Headshots refund the round.', apply: () => {} },
    { id: 'computer', name: 'BALLISTIC COMPUTER', max: 1, desc: 'Scope predicts your point of impact.', apply: () => {} },
    { id: 'heart', name: 'SLOW HEART', max: 2, desc: 'FOCUS lasts 2.5s longer.', apply: (s) => { s.focusTime += 2.5; } },
  ];

  /* ------------------------------- game -------------------------------- */

  const G = {
    state: 'menu',
    rnd: null,
    meshes: null,
    world: null,

    // shot / camera
    yaw: 0, pitch: -0.055,
    swayX: 0, swayY: 0, swayT: 0,
    recoilPitch: 0, recoilYaw: 0,
    shakeMag: 0, shakeT: 0,
    fov: HIP_FOV,
    px: 0, pz: HOME_Z, eye: EYE_STAND,
    duck: 0,

    scoped: false, zoomIndex: 0,
    holdingBreath: false, breath: 1,
    exhausted: 0,
    heartT: 0,

    mag: 5, bolt: 0, reloading: 0,
    shotsFired: 0, shotsHit: 0,

    enemies: [], bullets: [], particles: null,
    wind: [0, 0], windTarget: [0, 0],

    wave: 0, spawnQueue: [], spawnTimer: 0, waveActive: false,
    score: 0, combo: 0, comboTimer: 0, best: 0,
    integrity: 100, health: 100,
    damageFlash: 0, hurtTimer: 0,

    focus: 0, focusActive: 0, trackedBullet: null,
    camMode: 'player', camHold: 0,
    camPos: [0, EYE_STAND, HOME_Z], camTarget: [0, 0, 0],
    bulletCamPos: null,

    timeScale: 1,
    session: 0,
    stats: null,
    taken: {},
    waveKills: 0, waveBreaches: 0, waveShots: 0, waveHits: 0,
  };

  /* ---------------------------- stat helpers --------------------------- */

  function freshStats() {
    const s = Object.assign({}, BASE);
    s.zoomStops = BASE.zoomStops.slice();
    return s;
  }

  function has(id) { return (G.taken[id] || 0) > 0; }

  /* ------------------------------ helpers ------------------------------ */

  function forwardVec(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }

  function orientTo(dx, dy, dz) {
    const l = Math.hypot(dx, dy, dz) || 1;
    return [Math.atan2(dx / l, dz / l), Math.asin(clamp(-dy / l, -1, 1))];
  }

  function project(p) {
    const vp = G.rnd.viewProj;
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (w <= 0.001) return null;
    const c = G.rnd.canvas;
    return {
      x: (x / w * 0.5 + 0.5) * c.clientWidth,
      y: (1 - (y / w * 0.5 + 0.5)) * c.clientHeight,
    };
  }

  /* --------------------------- world queries --------------------------- */

  /* Straight-line range to whatever is under the reticle. */
  function rangefind(origin, dir) {
    const far = 1600;
    const p1 = [origin[0] + dir[0] * far, origin[1] + dir[1] * far, origin[2] + dir[2] * far];
    let best = far, kind = 'none';

    for (const e of G.enemies) {
      if (e.dead || e.removed) continue;
      const h = e.raycast(origin, p1);
      if (h && h.t * far < best) { best = h.t * far; kind = 'target'; }
    }
    for (const b of G.world.blockers) {
      const t = global.Ent.segAABB(origin, p1, b.min, b.max);
      if (t >= 0 && t * far < best) { best = t * far; kind = 'hard'; }
    }
    if (dir[1] < -0.0001) {
      const t = -origin[1] / (dir[1] * far);
      if (t > 0 && t * far < best) { best = t * far; kind = 'ground'; }
    }
    return { dist: best, kind };
  }

  /* Integrate the round forward to find where it will actually land. */
  function predictImpact(origin, dir) {
    const s = G.stats;
    let x = origin[0], y = origin[1], z = origin[2];
    let vx = dir[0] * s.muzzle, vy = dir[1] * s.muzzle, vz = dir[2] * s.muzzle;
    const h = 0.012;
    for (let i = 0; i < 260; i++) {
      const p0 = [x, y, z];
      vy -= global.Ent.GRAVITY * h;
      vx += G.wind[0] * s.windScale * h;
      vz += G.wind[1] * s.windScale * h;
      x += vx * h; y += vy * h; z += vz * h;
      const p1 = [x, y, z];
      if (y <= 0) return p1;
      for (const b of G.world.blockers) {
        if (p0[1] > b.top && p1[1] > b.top) continue;
        if (Math.min(p0[0], p1[0]) > b.max[0] || Math.max(p0[0], p1[0]) < b.min[0]) continue;
        if (Math.min(p0[2], p1[2]) > b.max[2] || Math.max(p0[2], p1[2]) < b.min[2]) continue;
        const t = global.Ent.segAABB(p0, p1, b.min, b.max);
        if (t >= 0) return [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t), lerp(p0[2], p1[2], t)];
      }
      for (const e of G.enemies) {
        if (e.dead || e.removed) continue;
        if (Math.abs(e.x - x) > 30 && Math.abs(e.z - z) > 30) continue;
        const hh = e.raycast(p0, p1);
        if (hh) return [lerp(p0[0], p1[0], hh.t), lerp(p0[1], p1[1], hh.t), lerp(p0[2], p1[2], hh.t)];
      }
    }
    return null;
  }

  /* ------------------------------- input ------------------------------- */

  const keys = {};
  let mouseDX = 0, mouseDY = 0;
  let sensitivity = 0.0022;

  function bindInput(canvas) {
    canvas.addEventListener('click', () => {
      if (G.state === 'playing' && !document.pointerLockElement) canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && G.state === 'playing') setPaused(true);
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      mouseDX += e.movementX;
      mouseDY += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (G.state !== 'playing' || document.pointerLockElement !== canvas) return;
      if (e.button === 0) fire();
      if (e.button === 2) setScoped(true);
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) setScoped(false);
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (G.state !== 'playing' || !G.scoped) return;
      e.preventDefault();
      const n = G.stats.zoomStops.length;
      G.zoomIndex = clamp(G.zoomIndex + (e.deltaY > 0 ? -1 : 1), 0, n - 1);
      AUD.ui();
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (e.code === 'Escape') {
        if (G.state === 'playing') setPaused(true);
        else if (G.state === 'paused') setPaused(false);
      }
      if (G.state !== 'playing') return;
      if (e.code === 'KeyR') startReload();
      if (e.code === 'KeyF') tryFocus();
      if (e.code === 'KeyM') { AUD.setMuted(!AUD.muted); toast(AUD.muted ? 'AUDIO OFF' : 'AUDIO ON'); }
      if (e.code === 'Space') { e.preventDefault(); setScoped(!G.scoped); }
    });

    document.addEventListener('keyup', (e) => { keys[e.code] = false; });

    global.addEventListener('blur', () => {
      for (const k in keys) keys[k] = false;
      if (G.state === 'playing') setPaused(true);
    });
  }

  function setScoped(on) {
    if (G.scoped === on) return;
    G.scoped = on;
    if (on) AUD.tone(520, 0.08, { gain: 0.06, type: 'sine', to: 760 });
    document.body.classList.toggle('scoped', on);
  }

  /* ------------------------------ shooting ----------------------------- */

  function startReload() {
    if (G.reloading > 0 || G.mag >= G.stats.magSize) return;
    G.reloading = G.stats.reloadTime;
    AUD.reload();
  }

  function fire() {
    if (G.reloading > 0 || G.bolt > 0) return;
    if (G.mag <= 0) { AUD.empty(); startReload(); return; }

    G.mag--;
    G.shotsFired++; G.waveShots++;
    G.bolt = G.stats.boltTime;

    const aimYaw = G.yaw + G.swayX + G.recoilYaw;
    const aimPitch = G.pitch + G.swayY + G.recoilPitch;
    let d = forwardVec(aimYaw, aimPitch);

    // unscoped fire is a wild guess; scoped fire is honest
    const spread = G.scoped ? 0.00035 : 0.016;
    d = [
      d[0] + (Math.random() - 0.5) * spread,
      d[1] + (Math.random() - 0.5) * spread,
      d[2] + (Math.random() - 0.5) * spread,
    ];
    const l = Math.hypot(d[0], d[1], d[2]);
    d = [d[0] / l, d[1] / l, d[2] / l];

    const origin = [G.px + d[0] * 0.6, G.eye - 0.12 + d[1] * 0.6, G.pz + d[2] * 0.6];
    const s = G.stats;
    const b = new global.Ent.Bullet(origin[0], origin[1], origin[2], d[0], d[1], d[2], {
      speed: s.muzzle,
      damage: s.damage,
      pierce: s.pierce,
      armorPiercing: s.armorPiercing,
      windScale: s.windScale,
      tracked: G.focusActive > 0 && !G.trackedBullet,
    });
    G.bullets.push(b);
    if (b.tracked) {
      G.trackedBullet = b;
      G.camMode = 'bullet';
    }

    G.particles.burst(origin[0], origin[1], origin[2], 'muzzle', d, 1);
    AUD.shot();
    AUD.bolt();

    G.recoilPitch += 0.020 + Math.random() * 0.006;
    G.recoilYaw += (Math.random() - 0.5) * 0.006;
    addShake(0.5);
    flashMuzzle();
    G.breath = Math.max(0, G.breath - 0.06);
  }

  function tryFocus() {
    if (G.focus < 100 || G.focusActive > 0) return;
    G.focus = 0;
    G.focusActive = G.stats.focusTime;
    AUD.focusIn();
    document.body.classList.add('focus');
  }

  function addShake(m) { G.shakeMag = Math.min(1.4, G.shakeMag + m); }

  /* ------------------------------- waves ------------------------------- */

  function buildWave(n) {
    const q = [];
    const count = Math.min(26, 5 + Math.round(n * 1.9));
    const push = (type, t) => q.push({ type, t });

    let t = 0;
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      let type = 'grunt';
      if (n >= 2 && r < 0.22) type = 'runner';
      else if (n >= 3 && r < 0.34) type = 'marksman';
      else if (n >= 4 && r < 0.44) type = 'heavy';
      else if (n >= 6 && r < 0.54) type = 'bomber';
      push(type, t);
      t += Math.max(0.45, 1.7 - n * 0.07) * (0.6 + Math.random() * 0.85);
    }
    // every fifth wave is a pressure spike
    if (n % 5 === 0) {
      for (let i = 0; i < 3 + Math.floor(n / 5); i++) push('heavy', t + i * 1.4);
      for (let i = 0; i < 2 + Math.floor(n / 5); i++) push('bomber', t + 3 + i * 1.1);
    }
    return q.sort((a, b) => a.t - b.t);
  }

  function startWave(n) {
    G.wave = n;
    G.spawnQueue = buildWave(n);
    G.spawnTimer = 0;
    G.waveActive = true;
    G.waveKills = 0; G.waveBreaches = 0; G.waveShots = 0; G.waveHits = 0;
    const w = 1.2 + Math.min(4.5, n * 0.3);
    const a = Math.random() * Math.PI * 2;
    G.windTarget = [Math.cos(a) * w, Math.sin(a) * w * 0.35];
    AUD.waveStart(n);
    banner(`WAVE ${n}`, `${G.spawnQueue.length} HOSTILES INBOUND`);
  }

  function spawnFromQueue(dt) {
    G.spawnTimer += dt;
    while (G.spawnQueue.length && G.spawnQueue[0].t <= G.spawnTimer) {
      const item = G.spawnQueue.shift();
      const lane = LAYOUT.lanes[Math.floor(Math.random() * LAYOUT.lanes.length)];
      G.enemies.push(new global.Ent.Soldier(item.type, lane, G.wave, Math.random));
    }
  }

  function endWave() {
    G.waveActive = false;
    const acc = G.waveShots ? G.waveHits / G.waveShots : 0;
    let bonus = 500 + G.wave * 150;
    let lines = [`WAVE ${G.wave} CLEARED  +${bonus}`];
    if (G.waveBreaches === 0) { bonus += 750; lines.push('PERIMETER HELD  +750'); }
    if (acc >= 0.9 && G.waveShots >= 4) { bonus += 600; lines.push('SURGICAL  +600'); }
    G.score += bonus;
    AUD.waveClear();
    banner('AREA CLEAR', lines.join('   •   '));
    setTimeout(() => { if (G.state === 'playing') showUpgrades(); }, 1500);
  }

  /* ---------------------------- scoring / fx --------------------------- */

  function addScore(v, worldPos, label, cls) {
    G.score += Math.round(v);
    if (worldPos) {
      const p = project(worldPos);
      if (p) floater(p.x, p.y, label, cls);
    }
  }

  function onKill(enemy, hit, at) {
    const dist = Math.hypot(enemy.x - G.px, enemy.z - G.pz);
    const head = hit.zone === 'head';
    G.combo++;
    G.comboTimer = 6.5;
    G.waveKills++;

    const mult = 1 + Math.min(G.combo - 1, 11) * 0.25;
    let pts = enemy.def.score * (head ? 2.6 : 1) + dist * 0.7;
    if (enemy.state === 'advance' && enemy.speed > 5) pts += 120;   // moving fast
    pts *= mult;

    let label = head ? 'HEADSHOT' : 'KILL';
    if (dist > 450) label = head ? 'LONG-RANGE HEADSHOT' : 'LONG SHOT';
    addScore(pts, [enemy.x, 1.6, enemy.z], `${label}  +${Math.round(pts)}`,
      head ? 'head' : 'kill');

    G.focus = Math.min(100, G.focus + (head ? 26 : 15) * G.stats.focusGain);

    // sound travels ~340 m/s, so distant hits thump a beat after the crack
    const echo = Math.min(1.6, dist / 340);
    if (head) AUD.hitHead(echo); else AUD.hitBody(echo);
    G.particles.burst(at[0], at[1], at[2], 'flesh', null, head ? 1.7 : 1);

    if (enemy.def.bomber) {
      // bombers cook off, taking nearby friends with them
      G.particles.burst(enemy.x, 1.0, enemy.z, 'boom', null, 1);
      AUD.breach();
      for (const o of G.enemies) {
        if (o === enemy || o.dead || o.removed) continue;
        if (Math.hypot(o.x - enemy.x, o.z - enemy.z) < 9) {
          o.kill(0, 0, false);
          G.combo++;
          G.comboTimer = 6.5;
          addScore(o.def.score * 0.7, [o.x, 1.6, o.z], 'CHAIN  +' + Math.round(o.def.score * 0.7), 'kill');
        }
      }
      addShake(0.35);
    }

    hitmarker(head);
    if (head && has('discipline')) {
      G.mag = Math.min(G.stats.magSize, G.mag + 1);
    }
  }

  /* ---------------------------- enemy attacks -------------------------- */

  function enemyFire(enemy) {
    const dist = Math.hypot(enemy.x - G.px, enemy.z - G.pz);
    AUD.enemyShot(Math.min(1.4, dist / 340));
    if (G.duck > 0.6) {
      // ducked below the parapet — the round cracks off the wall
      const session = G.session;
      setTimeout(() => {
        if (G.state !== 'playing' || G.session !== session) return;
        G.particles.burst(G.px + (Math.random() - 0.5) * 3, EYE_STAND - 0.4, G.pz - 6.4, 'wall', null, 1);
        addShake(0.25);
      }, Math.min(1400, (dist / 380) * 1000));
      return;
    }
    const hitChance = clamp(0.82 - dist / 1600, 0.3, 0.85);
    if (Math.random() > hitChance) { addShake(0.2); return; }
    const dmg = 11 + Math.random() * 9 + G.wave * 0.5;
    const session = G.session;
    setTimeout(() => {
      if (G.state !== 'playing' || G.session !== session) return;
      damagePlayer(dmg);
    }, Math.min(1400, (dist / 380) * 1000));
  }

  function damagePlayer(d) {
    G.health -= d;
    G.hurtTimer = 7;
    G.damageFlash = 1;
    addShake(0.8);
    AUD.incoming();
    G.combo = 0;
    if (G.health <= 0) { G.health = 0; gameOver('KILLED IN THE NEST'); }
  }

  function breach(enemy) {
    const cost = (BREACH_COST[enemy.type] || 12) * (1 - Math.min(0.6, G.stats.integrityShield));
    G.integrity -= cost;
    G.waveBreaches++;
    G.combo = 0;
    G.damageFlash = 0.7;
    addShake(0.6);
    AUD.breach();
    enemy.removed = true;
    const p = project([enemy.x, 2, enemy.z]);
    if (p) floater(p.x, p.y, `BREACH  -${Math.round(cost)}`, 'bad');
    toast('PERIMETER BREACH');
    if (G.integrity <= 0) { G.integrity = 0; gameOver('THE GATE FELL'); }
  }

  /* ------------------------------ lifecycle ---------------------------- */

  function newGame() {
    G.session++;
    G.stats = freshStats();
    G.taken = {};
    G.enemies.length = 0;
    G.bullets.length = 0;
    G.particles = new global.Ent.Particles(520);
    G.yaw = 0; G.pitch = -0.20;
    G.px = 0; G.pz = HOME_Z;
    G.recoilPitch = 0; G.recoilYaw = 0;
    G.mag = G.stats.magSize;
    G.bolt = 0; G.reloading = 0;
    G.score = 0; G.combo = 0; G.comboTimer = 0;
    G.integrity = 100;
    G.health = G.stats.maxHealth;
    G.breath = 1; G.exhausted = 0;
    G.focus = 0; G.focusActive = 0; G.trackedBullet = null;
    G.camMode = 'player';
    G.shotsFired = 0; G.shotsHit = 0;
    G.timeScale = 1;
    G.wind = [0, 0];
    G.duck = 0;
    G.zoomIndex = 0;
    document.body.classList.remove('focus');
    hideAll();
    G.state = 'playing';
    G.rnd.canvas.requestPointerLock();
    AUD.resume();
    startWave(1);
    renderUpgradeChips();
  }

  function gameOver(reason) {
    if (G.state === 'gameover') return;
    G.state = 'gameover';
    setScoped(false);
    document.exitPointerLock();
    AUD.gameOver();
    G.best = Math.max(G.best, G.score);
    try { localStorage.setItem('longshot.best', String(G.best)); } catch (e) { /* private mode */ }
    $('go-reason').textContent = reason;
    $('go-score').textContent = G.score.toLocaleString();
    $('go-wave').textContent = String(G.wave);
    $('go-best').textContent = G.best.toLocaleString();
    const acc = G.shotsFired ? Math.round((G.shotsHit / G.shotsFired) * 100) : 0;
    $('go-acc').textContent = acc + '%';
    show('gameover');
  }

  function setPaused(p) {
    if (p && G.state === 'playing') {
      G.state = 'paused';
      setScoped(false);
      document.exitPointerLock();
      show('pause');
    } else if (!p && G.state === 'paused') {
      hideAll();
      G.state = 'playing';
      G.rnd.canvas.requestPointerLock();
    }
  }

  /* ----------------------------- upgrades ------------------------------ */

  function showUpgrades() {
    G.state = 'upgrade';
    setScoped(false);
    document.exitPointerLock();

    const pool = UPGRADES.filter((u) => (G.taken[u.id] || 0) < u.max);
    const picks = [];
    while (picks.length < Math.min(3, pool.length)) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      if (!picks.includes(c)) picks.push(c);
    }

    const host = $('cards');
    host.innerHTML = '';
    picks.forEach((u) => {
      const lvl = G.taken[u.id] || 0;
      const el = document.createElement('button');
      el.className = 'card';
      el.innerHTML =
        `<div class="card-lvl">${lvl > 0 ? `LV ${lvl} → ${lvl + 1}` : 'NEW'}</div>` +
        `<div class="card-name">${u.name}</div>` +
        `<div class="card-desc">${u.desc}</div>`;
      el.onclick = () => takeUpgrade(u);
      host.appendChild(el);
    });
    $('upgrade-wave').textContent = String(G.wave + 1);
    show('upgrade');
  }

  function takeUpgrade(u) {
    G.taken[u.id] = (G.taken[u.id] || 0) + 1;
    u.apply(G.stats);
    if (u.id === 'medic') G.health = G.stats.maxHealth;
    if (u.id === 'reinforce') G.integrity = Math.min(100, G.integrity + 35);
    if (u.id === 'mag' || u.id === 'hands') G.mag = G.stats.magSize;
    G.zoomIndex = clamp(G.zoomIndex, 0, G.stats.zoomStops.length - 1);
    AUD.upgrade();
    renderUpgradeChips();
    hideAll();
    G.state = 'playing';
    G.rnd.canvas.requestPointerLock();
    G.mag = G.stats.magSize;
    startWave(G.wave + 1);
  }

  function renderUpgradeChips() {
    const host = $('perks');
    host.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = G.taken[u.id] || 0;
      if (!lvl) continue;
      const el = document.createElement('div');
      el.className = 'perk';
      el.textContent = u.name + (u.max > 1 ? ` ${lvl}` : '');
      host.appendChild(el);
    }
  }

  /* -------------------------------- UI --------------------------------- */

  function show(id) {
    hideAll();
    $(id).classList.add('on');
    document.body.classList.add('overlayed');
  }

  function hideAll() {
    for (const id of ['menu', 'pause', 'upgrade', 'gameover']) $(id).classList.remove('on');
    document.body.classList.remove('overlayed');
  }

  let bannerTimer = null;
  function banner(title, sub) {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub || '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function floater(x, y, text, cls) {
    const el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    $('floaters').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function hitmarker(head) {
    const el = $('hitmarker');
    el.classList.toggle('head', !!head);
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  function flashMuzzle() {
    const el = $('muzzle');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  /* ------------------------------ update ------------------------------- */

  function updateAim(dt) {
    const zoom = G.scoped ? G.stats.zoomStops[G.zoomIndex] : 1;
    const scale = G.scoped ? (HIP_FOV / (HIP_FOV / zoom)) : 1;
    const sens = sensitivity / (G.scoped ? scale * 0.85 : 1);
    G.yaw += mouseDX * sens;
    G.pitch -= mouseDY * sens;
    mouseDX = 0; mouseDY = 0;
    G.pitch = clamp(G.pitch, -0.95, 0.30);
    G.yaw = clamp(G.yaw, -1.25, 1.25);

    // recoil settles back down
    G.recoilPitch = damp(G.recoilPitch, 0, 5.5, dt);
    G.recoilYaw = damp(G.recoilYaw, 0, 5.5, dt);

    // breathing / sway
    const wantHold = !!(keys.ShiftLeft || keys.ShiftRight) && G.scoped;
    G.holdingBreath = wantHold && G.breath > 0 && G.exhausted <= 0;
    if (G.holdingBreath) {
      G.breath = Math.max(0, G.breath - dt / G.stats.breathMax);
      G.heartT += dt;
      if (G.heartT > lerp(1.05, 0.5, 1 - G.breath)) { G.heartT = 0; AUD.heartbeat(); }
      if (G.breath <= 0) { G.exhausted = 1.6; AUD.gasp(); }
    } else {
      G.breath = Math.min(1, G.breath + dt * (0.42 / G.stats.breathMax) * 3.2);
      G.heartT = 0;
    }
    G.exhausted = Math.max(0, G.exhausted - dt);

    G.swayT += dt;
    const t = G.swayT;
    let amp = G.stats.swayAmp * (G.scoped ? 1 : 2.2);
    if (G.holdingBreath) amp *= 0.11;
    if (G.exhausted > 0) amp *= 2.6;
    amp *= 1 + (1 - G.health / G.stats.maxHealth) * 0.8;

    G.swayX = (Math.sin(t * 1.13) * 0.62 + Math.sin(t * 2.37 + 1.1) * 0.28) * amp;
    G.swayY = (Math.sin(t * 0.91 + 1.7) * 0.55 + Math.sin(t * 1.79) * 0.24) * amp;

    // lateral shuffle along the nest platform
    let mx = 0, mz = 0;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
    if (keys.KeyW) mz -= 1;
    if (keys.KeyS) mz += 1;
    const spd = G.scoped ? 1.1 : 3.4;
    G.px = clamp(G.px + mx * spd * dt, -4.4, 4.4);
    G.pz = clamp(G.pz + mz * spd * dt, HOME_Z - 1.2, HOME_Z + 9.0);

    const wantDuck = !!(keys.KeyC || keys.ControlLeft || keys.ControlRight);
    G.duck = damp(G.duck, wantDuck ? 1 : 0, 9, dt);
    G.eye = lerp(EYE_STAND, EYE_DUCK, G.duck);

    // field of view
    const targetFov = G.scoped ? HIP_FOV / G.stats.zoomStops[G.zoomIndex] : HIP_FOV;
    G.fov = damp(G.fov, targetFov, 14, dt);
  }

  function updateWorld(dt) {
    // wind eases toward its target so long shots stay learnable
    G.wind[0] = damp(G.wind[0], G.windTarget[0], 0.5, dt);
    G.wind[1] = damp(G.wind[1], G.windTarget[1], 0.5, dt);

    if (G.bolt > 0) G.bolt = Math.max(0, G.bolt - dt);
    if (G.reloading > 0) {
      G.reloading -= dt;
      if (G.reloading <= 0) { G.reloading = 0; G.mag = G.stats.magSize; }
    }

    if (G.comboTimer > 0) {
      G.comboTimer -= dt;
      if (G.comboTimer <= 0) G.combo = 0;
    }

    if (G.hurtTimer > 0) G.hurtTimer -= dt;
    else if (G.health < G.stats.maxHealth) {
      G.health = Math.min(G.stats.maxHealth, G.health + dt * 4.5);
    }
    G.damageFlash = Math.max(0, G.damageFlash - dt * 1.6);

    if (G.waveActive) spawnFromQueue(dt);

    const ctx = {
      player: [G.px, G.eye, G.pz],
      onEnemyFire: enemyFire,
    };

    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      e.update(dt, ctx);
      if (e.breached && !e.removed) breach(e);
      if (e.removed) G.enemies.splice(i, 1);
    }

    const bctx = {
      enemies: G.enemies,
      blockers: G.world.blockers,
      wind: G.wind,
      onHitEnemy: (bullet, enemy, hit, res, at) => {
        if (bullet === G.trackedBullet) G.camHold = 0.75;
        if (res.kind === 'shield') {
          G.particles.burst(at[0], at[1], at[2], 'shield', null, 1);
          AUD.hitArmor(Math.min(1.6, Math.hypot(at[0] - G.px, at[2] - G.pz) / 340));
          const p = project(at);
          if (p) floater(p.x, p.y, 'RICOCHET', 'bad');
          hitmarker(false);
          return;
        }
        G.shotsHit++; G.waveHits++;
        if (res.killed) {
          onKill(enemy, hit, at);
        } else {
          G.particles.burst(at[0], at[1], at[2], 'flesh', null, 0.7);
          AUD.hitBody(Math.min(1.6, Math.hypot(at[0] - G.px, at[2] - G.pz) / 340));
          hitmarker(false);
          G.focus = Math.min(100, G.focus + 5 * G.stats.focusGain);
          const p = project(at);
          if (p) floater(p.x, p.y, hit.zone === 'legs' ? 'CRIPPLED' : 'HIT', '');
        }
      },
      onHitWorld: (bullet, at, kind) => {
        if (bullet === G.trackedBullet) G.camHold = 0.4;
        G.particles.burst(at[0], at[1], at[2], kind, null, 1);
        const dist = Math.hypot(at[0] - G.px, at[1] - G.eye, at[2] - G.pz);
        AUD.hitDirt(Math.min(1.6, dist / 340));
      },
    };

    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.update(dt, bctx);
      if (!b.alive && b.trail.length === 0) G.bullets.splice(i, 1);
      else if (!b.alive) {
        b.deadTime = (b.deadTime || 0) + dt;
        if (b.deadTime > 0.35) G.bullets.splice(i, 1);
      }
    }

    G.particles.update(dt);

    if (G.waveActive && G.spawnQueue.length === 0 &&
      !G.enemies.some((e) => !e.dead)) {
      endWave();
    }
  }

  function updateCamera(dt, realDt) {
    G.shakeMag = Math.max(0, G.shakeMag - realDt * 2.4);
    G.shakeT += realDt * 34;

    if (G.camMode === 'bullet' && G.trackedBullet) {
      const b = G.trackedBullet;
      if (b.alive) {
        const d = b.dir;
        const back = 7.5, up = 1.6;
        const want = [b.x - d[0] * back, b.y - d[1] * back + up, b.z - d[2] * back];
        if (!G.bulletCamPos) G.bulletCamPos = want.slice();
        for (let i = 0; i < 3; i++) G.bulletCamPos[i] = damp(G.bulletCamPos[i], want[i], 26, realDt);
        G.camPos = G.bulletCamPos.slice();
        G.camTarget = [b.x + d[0] * 24, b.y + d[1] * 24, b.z + d[2] * 24];
        G.camFov = 42;
        return;
      }
      G.camHold -= realDt;
      if (G.camHold > 0 && b.impact) {
        const at = b.impact.at;
        const d = b.dir;
        G.camPos = [at[0] - d[0] * 5.5, at[1] - d[1] * 5.5 + 1.5, at[2] - d[2] * 5.5];
        G.camTarget = at;
        G.camFov = lerp(38, 22, clamp(1 - G.camHold / 0.75, 0, 1));
        return;
      }
      G.camMode = 'player';
      G.trackedBullet = null;
      G.bulletCamPos = null;
    }

    const aimYaw = G.yaw + G.swayX + G.recoilYaw;
    const aimPitch = G.pitch + G.swayY + G.recoilPitch;
    const f = forwardVec(aimYaw, aimPitch);
    const sh = G.shakeMag * G.shakeMag * 0.09;
    const ox = Math.sin(G.shakeT * 1.7) * sh;
    const oy = Math.sin(G.shakeT * 2.3 + 1.1) * sh;
    G.camPos = [G.px, G.eye, G.pz];
    G.camTarget = [
      G.px + f[0] * 10 + ox,
      G.eye + f[1] * 10 + oy,
      G.pz + f[2] * 10,
    ];
    G.camFov = G.fov;
  }

  /* ------------------------------ rendering ---------------------------- */

  const MTX = { root: m4(), tmp: m4(), out: m4(), meshes: null };
  const tmpM = m4();

  function render() {
    const R = G.rnd;
    const gl = R.gl;
    document.body.classList.toggle('bulletcam', G.camMode === 'bullet');
    const roll = G.camMode === 'bullet' ? 0 : G.swayX * 3;
    R.beginFrame(G.camPos, G.camTarget, G.camFov, roll);

    // static town
    R.setMaterial(1, 1, 1, 0, 1);
    R.drawAt(G.world.mesh, 0, 0, 0, 0, 0, 0, 1, 1, 1);

    // contact shadows
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const e of G.enemies) {
      const a = e.dead ? clamp(1 - e.deadTime / 9, 0, 1) * 0.35 : 0.42;
      const s = (e.dead ? 2.1 : 1.25) * e.scale;
      R.setMaterial(0.05, 0.04, 0.04, 0, a);
      R.drawAt(G.meshes.quad, e.yaw, 0, 0, e.x, 0.05, e.z, s, 1, s);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // soldiers
    MTX.meshes = G.meshes;
    for (const e of G.enemies) {
      const tint = G.focusActive > 0 && !e.dead ? 1.35 : 1;
      e.draw(R, MTX, tint);
    }

    // beacon pulse at the gate
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.004);
    R.setMaterial(0.4 + pulse, 1.1 * pulse, 0.35 * pulse, 1, 1);
    R.drawAt(G.meshes.cube, 0, 0, 0, 0, 4.2, LAYOUT.gate.z + 4, 0.5, 0.5, 0.5);

    G.particles.draw(R, G.meshes.cube);

    // tracers
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    for (const b of G.bullets) {
      for (let i = 1; i < b.trail.length; i++) {
        const p = b.trail[i - 1], q = b.trail[i];
        const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.01) continue;
        const [yaw, pitch] = orientTo(dx, dy, dz);
        const a = (i / b.trail.length) * (b.alive ? 0.55 : 0.25);
        const w = 0.035 + 0.05 * (i / b.trail.length);
        R.setMaterial(1.6, 1.25, 0.7, 1, a);
        m4trs(tmpM, yaw, pitch, 0,
          (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, w, w, len);
        R.draw(G.meshes.cube, tmpM);
      }
      if (b.alive) {
        R.setMaterial(2.2, 1.7, 0.9, 1, 0.9);
        R.drawAt(G.meshes.cube, 0, 0, 0, b.x, b.y, b.z, 0.16, 0.16, 0.16);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /* -------------------------------- HUD -------------------------------- */

  const hudEls = {};
  function cacheHud() {
    ['score', 'wave', 'combo', 'combo-bar', 'ammo', 'ammo-pips', 'integrity-bar',
      'health-bar', 'focus-bar', 'breath-bar', 'wind-arrow', 'wind-text', 'range',
      'zoom', 'enemies-left', 'reload-ring', 'duck-hint'].forEach((k) => { hudEls[k] = $(k); });
  }

  function updateHud() {
    hudEls.score.textContent = G.score.toLocaleString();
    hudEls.wave.textContent = String(G.wave);
    hudEls.combo.textContent = G.combo > 1 ? `x${(1 + Math.min(G.combo - 1, 11) * 0.25).toFixed(2)}` : '—';
    hudEls['combo-bar'].style.width = clamp(G.comboTimer / 6.5, 0, 1) * 100 + '%';

    let pips = '';
    for (let i = 0; i < G.stats.magSize; i++) pips += `<i class="${i < G.mag ? 'live' : ''}"></i>`;
    if (hudEls['ammo-pips'].dataset.n !== `${G.mag}/${G.stats.magSize}`) {
      hudEls['ammo-pips'].innerHTML = pips;
      hudEls['ammo-pips'].dataset.n = `${G.mag}/${G.stats.magSize}`;
    }
    hudEls.ammo.textContent = G.reloading > 0 ? 'RELOADING' : `${G.mag} / ${G.stats.magSize}`;
    hudEls['reload-ring'].style.width =
      (G.reloading > 0 ? (1 - G.reloading / G.stats.reloadTime) : (G.bolt > 0 ? 1 - G.bolt / G.stats.boltTime : 0)) * 100 + '%';

    hudEls['integrity-bar'].style.width = clamp(G.integrity / 100, 0, 1) * 100 + '%';
    hudEls['health-bar'].style.width = clamp(G.health / G.stats.maxHealth, 0, 1) * 100 + '%';
    hudEls['focus-bar'].style.width =
      (G.focusActive > 0 ? G.focusActive / G.stats.focusTime : G.focus / 100) * 100 + '%';
    hudEls['focus-bar'].classList.toggle('ready', G.focus >= 100 || G.focusActive > 0);
    hudEls['breath-bar'].style.width = clamp(G.breath, 0, 1) * 100 + '%';
    hudEls['breath-bar'].classList.toggle('low', G.breath < 0.3);

    const spd = Math.hypot(G.wind[0], G.wind[1]);
    hudEls['wind-text'].textContent = spd.toFixed(1) + ' m/s';
    hudEls['wind-arrow'].style.transform =
      `rotate(${Math.atan2(G.wind[0], -G.wind[1]) * 57.2958}deg)`;

    hudEls.zoom.textContent = G.scoped ? G.stats.zoomStops[G.zoomIndex] + 'x' : 'IRON';
    const left = G.enemies.filter((e) => !e.dead).length + G.spawnQueue.length;
    hudEls['enemies-left'].textContent = String(left);

    // rangefinder + impact prediction
    const aimYaw = G.yaw + G.swayX + G.recoilYaw;
    const aimPitch = G.pitch + G.swayY + G.recoilPitch;
    const d = forwardVec(aimYaw, aimPitch);
    const origin = [G.px, G.eye, G.pz];
    const rf = rangefind(origin, d);
    hudEls.range.textContent = rf.dist >= 1590 ? '----' : Math.round(rf.dist) + ' m';
    hudEls.range.classList.toggle('target', rf.kind === 'target');

    const marker = $('impact');
    if (has('computer') && G.scoped) {
      const at = predictImpact(origin, d);
      const p = at && project(at);
      if (p) {
        marker.style.display = 'block';
        marker.style.left = p.x + 'px';
        marker.style.top = p.y + 'px';
      } else marker.style.display = 'none';
    } else marker.style.display = 'none';

    hudEls['duck-hint'].classList.toggle('on',
      G.enemies.some((e) => e.state === 'aim' && !e.dead));

    $('vignette').style.opacity = String(clamp(G.damageFlash, 0, 1) * 0.85);
    document.body.classList.toggle('ducked', G.duck > 0.5);
  }

  /* ------------------------------- loop -------------------------------- */

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;

    if (G.state === 'playing') {
      // FOCUS dilates time; the bullet cam slows things further
      if (G.focusActive > 0) {
        G.focusActive -= realDt;
        if (G.focusActive <= 0) {
          G.focusActive = 0;
          document.body.classList.remove('focus');
          AUD.focusOut();
        }
      }
      let scale = G.focusActive > 0 ? 0.26 : 1;
      if (G.camMode === 'bullet') scale = Math.min(scale, 0.18);
      G.timeScale = damp(G.timeScale, scale, 12, realDt);
      const dt = realDt * G.timeScale;

      updateAim(realDt);
      updateWorld(dt);
      updateCamera(dt, realDt);
      updateHud();
    } else {
      updateCamera(realDt, realDt);
      if (G.state === 'menu') {
        // slow drift over the town behind the menu
        G.yaw = Math.sin(now * 0.00008) * 0.5;
        G.pitch = -0.16 + Math.sin(now * 0.00013) * 0.035;
        G.camFov = 55;
      }
      if (G.particles) G.particles.update(realDt * 0.4);
    }

    render();
  }

  /* -------------------------------- boot ------------------------------- */

  function boot() {
    const canvas = $('view');
    let rnd;
    try {
      rnd = new global.E.Renderer(canvas);
    } catch (err) {
      $('fatal').style.display = 'flex';
      $('fatal-msg').textContent = err.message;
      return;
    }
    G.rnd = rnd;

    const seed = Math.floor(Math.random() * 1e9);
    G.world = global.World.buildStatic(rnd.gl, seed);
    G.meshes = global.World.buildCharacter(rnd.gl);
    MTX.meshes = G.meshes;
    G.particles = new global.Ent.Particles(520);
    G.stats = freshStats();

    try { G.best = parseInt(localStorage.getItem('longshot.best') || '0', 10) || 0; } catch (e) { G.best = 0; }
    $('menu-best').textContent = G.best.toLocaleString();

    cacheHud();
    bindInput(canvas);

    $('btn-start').onclick = () => { AUD.resume(); newGame(); };
    $('btn-resume').onclick = () => setPaused(false);
    $('btn-quit').onclick = () => { G.state = 'menu'; show('menu'); };
    $('btn-again').onclick = () => { AUD.resume(); newGame(); };
    $('btn-menu').onclick = () => { G.state = 'menu'; show('menu'); };

    G.camPos = [0, EYE_STAND, HOME_Z];
    show('menu');
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  global.GAME = G;
})(window);

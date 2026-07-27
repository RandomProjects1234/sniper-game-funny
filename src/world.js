/* =========================================================================
   LONGSHOT — world generation.
   Builds the valley town as one merged static mesh plus the reusable
   meshes used by dynamic objects (soldiers, props, effects).
   ========================================================================= */
(function (global) {
  'use strict';

  const { MeshBuilder, Mesh, TAU } = global.E;

  /* Everything is metres. The nest looks down the boulevard toward -Z. */
  const LAYOUT = {
    nest: { x: 0, y: 48, z: 60 },
    gate: { z: -62, halfWidth: 34 },
    lanes: [0, -70, 70, -140, 140, -210, 210],
    rowsFrom: -120,
    rowsTo: -410,
    rowStep: 70,
    spawnZ: -440,
  };

  const SAND = [0.80, 0.68, 0.45];
  const SAND_DARK = [0.62, 0.51, 0.34];
  const ROAD = [0.34, 0.32, 0.30];

  function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

  const WALL_COLORS = [
    [0.74, 0.66, 0.50], [0.66, 0.58, 0.44], [0.78, 0.70, 0.55],
    [0.60, 0.54, 0.42], [0.70, 0.60, 0.45], [0.64, 0.60, 0.52],
  ];

  /* ------------------------------ props -------------------------------- */

  function addCrate(b, x, z, yaw, r) {
    const h = 0.7 + r() * 0.5;
    b.box(x, h, z, 0.75, h, 0.75, [0.44, 0.38, 0.26], yaw);
    b.box(x, h * 2 + 0.04, z, 0.78, 0.05, 0.78, [0.34, 0.30, 0.22], yaw);
  }

  function addBarrel(b, x, z, r) {
    const col = r() < 0.4 ? [0.62, 0.24, 0.18] : [0.35, 0.42, 0.34];
    b.cylinder(x, 0.55, z, 0.34, 1.1, 10, col);
    b.cylinder(x, 0.75, z, 0.36, 0.08, 10, shade(col, 0.7));
    b.cylinder(x, 0.35, z, 0.36, 0.08, 10, shade(col, 0.7));
  }

  function addSandbags(b, x, z, yaw, len) {
    for (let i = 0; i < len; i++) {
      const t = (i - (len - 1) / 2) * 0.95;
      const px = x + Math.cos(yaw) * t, pz = z - Math.sin(yaw) * t;
      b.box(px, 0.28, pz, 0.5, 0.28, 0.34, [0.60, 0.56, 0.42], yaw);
      b.box(px + Math.cos(yaw) * 0.25, 0.78, pz - Math.sin(yaw) * 0.25,
        0.5, 0.26, 0.32, [0.55, 0.51, 0.38], yaw + 0.1);
    }
  }

  function addCar(b, x, z, yaw, r) {
    const hue = [[0.55, 0.20, 0.16], [0.20, 0.30, 0.42], [0.55, 0.52, 0.45], [0.28, 0.34, 0.26]][
      Math.floor(r() * 4)];
    b.box(x, 0.72, z, 0.92, 0.34, 2.15, hue, yaw);
    b.box(x, 1.28, z - 0.15 * Math.cos(yaw), 0.80, 0.32, 1.05, shade(hue, 0.82), yaw);
    b.box(x, 1.30, z - 0.15 * Math.cos(yaw), 0.72, 0.22, 1.10, [0.14, 0.17, 0.20], yaw);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const ox = sx * 0.88, oz = sz * 1.45;
        b.cylinder(x + ox * Math.cos(yaw) + oz * Math.sin(yaw), 0.36,
          z - ox * Math.sin(yaw) + oz * Math.cos(yaw), 0.36, 0.28, 8, [0.11, 0.11, 0.12]);
      }
    }
  }

  function addPalm(b, x, z, r) {
    const h = 5 + r() * 4;
    b.cylinder(x, h / 2, z, 0.24, h, 7, [0.42, 0.34, 0.24], 0.7);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + r();
      b.box(x + Math.cos(a) * 1.5, h + 0.1 - Math.abs(Math.sin(i)) * 0.3, z + Math.sin(a) * 1.5,
        1.7, 0.09, 0.35, [0.24, 0.40, 0.20], -a);
    }
  }

  function addAntennaMast(b, x, z, r) {
    const h = 14 + r() * 10;
    b.cylinder(x, h / 2, z, 0.22, h, 6, [0.42, 0.42, 0.44], 0.5);
    for (let i = 0; i < 3; i++) {
      b.box(x, h * (0.45 + i * 0.2), z, 1.4, 0.07, 0.07, [0.5, 0.5, 0.52], i * 0.6);
    }
    b.box(x, h + 0.5, z, 0.16, 0.5, 0.16, [0.8, 0.25, 0.20]);
  }

  /* --------------------------- buildings ------------------------------- */

  function addBuilding(b, cx, cz, w, d, h, r) {
    const col = WALL_COLORS[Math.floor(r() * WALL_COLORS.length)];
    const yaw = (r() - 0.5) * 0.06;
    b.box(cx, h / 2, cz, w / 2, h / 2, d / 2, col, yaw);

    // parapet
    b.box(cx, h + 0.45, cz, w / 2 + 0.22, 0.45, d / 2 + 0.22, shade(col, 0.86), yaw);
    b.box(cx, h + 0.5, cz, w / 2 - 0.35, 0.5, d / 2 - 0.35, shade(col, 0.6), yaw);

    // Window bands. Offsets are rotated with the building so the strips sit
    // flush in the facade instead of poking out at the corners.
    const cw = Math.cos(yaw), sw = Math.sin(yaw);
    const at = (lx, lz) => [cx + lx * cw + lz * sw, cz - lx * sw + lz * cw];
    const floors = Math.max(1, Math.floor(h / 4.4));
    const glass = [0.13, 0.15, 0.17];
    for (let f = 1; f <= floors; f++) {
      const y = (f / (floors + 1)) * h;
      let p = at(0, d / 2);
      b.box(p[0], y, p[1], w / 2 - 2.2, 0.42, 0.1, glass, yaw);
      p = at(0, -d / 2);
      b.box(p[0], y, p[1], w / 2 - 2.2, 0.42, 0.1, glass, yaw);
      p = at(w / 2, 0);
      b.box(p[0], y, p[1], 0.1, 0.42, d / 2 - 2.2, glass, yaw);
      p = at(-w / 2, 0);
      b.box(p[0], y, p[1], 0.1, 0.42, d / 2 - 2.2, glass, yaw);
    }

    // rooftop clutter
    const clutter = Math.floor(r() * 3);
    for (let i = 0; i < clutter; i++) {
      const ox = (r() - 0.5) * (w - 3), oz = (r() - 0.5) * (d - 3);
      if (r() < 0.4) {
        b.cylinder(cx + ox, h + 1.4, cz + oz, 1.1, 1.9, 10, [0.55, 0.55, 0.58]);
      } else {
        b.box(cx + ox, h + 1.0, cz + oz, 1.2, 1.0, 1.0, shade(col, 0.75));
      }
    }
    if (r() < 0.25) addAntennaMast(b, cx + (r() - 0.5) * (w - 4), cz + (r() - 0.5) * (d - 4), r);
    // awnings give the fronts some depth
    if (r() < 0.5) {
      const p = at(0, d / 2 + 0.7);
      b.box(p[0], 3.2, p[1], w / 2 - 0.6, 0.08, 0.8, [0.50, 0.28, 0.24], yaw);
    }
  }

  /* --------------------------- sniper nest ----------------------------- */

  function addNest(b) {
    const { x, y, z } = LAYOUT.nest;
    const base = [0.58, 0.54, 0.48];
    // tower shaft
    b.box(x, y / 2 - 1, z, 5.5, y / 2, 5.5, base);
    b.box(x, y / 2 - 1, z, 5.9, 0.5, 5.9, shade(base, 0.8));
    for (let i = 1; i < 5; i++) {
      b.box(x, (y / 5) * i, z, 6.0, 0.35, 6.0, shade(base, 0.72));
    }
    // platform
    b.box(x, y - 1.2, z, 7.0, 0.5, 7.0, [0.42, 0.40, 0.36]);
    // low walls with a firing notch toward the town
    b.box(x, y - 0.2, z + 6.6, 7.0, 1.0, 0.4, [0.50, 0.47, 0.42]);
    b.box(x - 5.4, y - 0.2, z, 1.6, 1.0, 7.0, [0.50, 0.47, 0.42]);
    b.box(x + 5.4, y - 0.2, z, 1.6, 1.0, 7.0, [0.50, 0.47, 0.42]);
    b.box(x - 4.6, y - 0.45, z - 6.6, 2.4, 0.75, 0.4, [0.50, 0.47, 0.42]);
    b.box(x + 4.6, y - 0.45, z - 6.6, 2.4, 0.75, 0.4, [0.50, 0.47, 0.42]);
    // sandbag rest at the notch
    for (let i = -1; i <= 1; i++) {
      b.box(x + i * 0.95, y - 0.35, z - 6.4, 0.5, 0.3, 0.36, [0.60, 0.56, 0.42], i * 0.12);
    }
    // camo netting posts
    for (const sx of [-1, 1]) {
      b.box(x + sx * 6.4, y + 0.9, z + 6.4, 0.12, 1.4, 0.12, [0.34, 0.32, 0.26]);
      b.box(x + sx * 6.4, y + 0.9, z - 6.4, 0.12, 1.4, 0.12, [0.34, 0.32, 0.26]);
    }
    b.box(x, y + 2.2, z + 1.5, 6.6, 0.06, 5.2, [0.36, 0.38, 0.28]);
    // ammo crate + gear so the nest feels lived in
    b.box(x + 4.2, y - 0.25, z + 4.2, 0.75, 0.7, 0.75, [0.44, 0.38, 0.26], 0.4);
    b.box(x + 4.2, y + 0.5, z + 4.2, 0.78, 0.05, 0.78, [0.34, 0.30, 0.22], 0.4);
    b.box(x - 4.2, y - 0.5, z + 3.8, 0.9, 0.2, 0.6, [0.30, 0.32, 0.26], 0.3);
  }

  /* ------------------------------ gate --------------------------------- */

  function addGate(b) {
    const gz = LAYOUT.gate.z, hw = LAYOUT.gate.halfWidth;
    // barrier line the enemies are trying to reach
    for (let i = -1; i <= 1; i += 2) {
      b.box(i * (hw - 6), 2.2, gz, 6.5, 2.2, 1.2, [0.52, 0.50, 0.46]);
      b.box(i * (hw - 6), 4.6, gz, 6.9, 0.3, 1.5, [0.44, 0.42, 0.38]);
    }
    addSandbags(b, -12, gz, 0, 10);
    addSandbags(b, 12, gz, 0, 10);
    // hesco walls flanking outward
    for (let i = 0; i < 5; i++) {
      b.box(-hw - 3 - i * 5, 1.4, gz + 1, 2.4, 1.4, 1.4, [0.62, 0.58, 0.44], 0.02);
      b.box(hw + 3 + i * 5, 1.4, gz + 1, 2.4, 1.4, 1.4, [0.62, 0.58, 0.44], -0.02);
    }
    // beacon: the thing you are defending
    b.cylinder(0, 1.2, gz + 4, 1.0, 2.4, 8, [0.40, 0.42, 0.45]);
    b.cylinder(0, 3.0, gz + 4, 0.55, 1.6, 8, [0.30, 0.32, 0.36]);
  }

  /* ------------------------- approach / killzone ------------------------ */
  /* The open ground between the nest and the gate. Nothing spawns here, so
     it exists purely to give the near field something to look at. */

  function addApproach(b, r) {
    const gz = LAYOUT.gate.z, nz = LAYOUT.nest.z;

    // supply road running back from the gate to the tower
    b.plane(0, 0.08, (gz + nz) / 2, 7, (nz - gz) / 2, ROAD);
    b.plane(0, 0.12, (gz + nz) / 2, 0.16, (nz - gz) / 2, [0.52, 0.47, 0.32]);

    // razor wire belts
    for (const wz of [gz + 16, gz + 34]) {
      for (let x = -120; x <= 120; x += 4) {
        b.box(x, 0.62, wz + Math.sin(x * 0.3) * 0.5, 0.06, 0.62, 0.06, [0.34, 0.33, 0.30]);
      }
      for (let x = -120; x <= 120; x += 24) {
        b.box(x, 1.22, wz, 0.09, 0.09, 0.09, [0.40, 0.39, 0.36]);
      }
      b.box(0, 1.15, wz, 120, 0.03, 0.03, [0.46, 0.45, 0.42]);
      b.box(0, 0.75, wz, 120, 0.03, 0.03, [0.46, 0.45, 0.42]);
    }

    // craters, wrecks and rubble
    for (let i = 0; i < 26; i++) {
      const x = (r() - 0.5) * 300;
      const z = gz + 6 + r() * (nz - gz - 20);
      if (Math.abs(x) < 9) continue;
      const pick = r();
      if (pick < 0.32) {
        b.plane(x, 0.06, z, 2 + r() * 3, 2 + r() * 3, shade(SAND_DARK, 0.7));
      } else if (pick < 0.55) {
        addCar(b, x, z, r() * TAU, r);
      } else if (pick < 0.75) {
        const s = 0.6 + r() * 1.8;
        b.box(x, s * 0.45, z, s, s * 0.45, s * 0.8, shade(SAND_DARK, 0.85 + r() * 0.3), r() * TAU);
      } else {
        addBarrel(b, x, z, r);
      }
    }

    // concrete barriers angled toward the gate, plus a couple of palms
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      b.box(side * (26 + i * 7), 1.1, gz + 24 + i * 5, 3.0, 1.1, 0.8,
        [0.58, 0.56, 0.52], side * 0.35);
    }
    addPalm(b, -22, nz - 26, r);
    addPalm(b, 25, nz - 34, r);
  }

  /* ---------------------------- terrain -------------------------------- */

  function addGround(b, r) {
    const half = 760, step = 40;
    for (let x = -half; x < half; x += step) {
      for (let z = -half; z < half; z += step) {
        const k = 0.93 + r() * 0.13;
        b.plane(x + step / 2, 0, z + step / 2, step / 2, step / 2, shade(SAND, k));
      }
    }
    // coarse desert beyond the playable valley so the horizon stays solid
    const outer = 3000, ostep = 190;
    for (let x = -outer; x < outer; x += ostep) {
      for (let z = -outer; z < outer; z += ostep) {
        if (Math.abs(x + ostep / 2) < half && Math.abs(z + ostep / 2) < half) continue;
        const k = 0.80 + r() * 0.26;
        b.plane(x + ostep / 2, -0.05, z + ostep / 2, ostep / 2, ostep / 2, shade(SAND, k));
      }
    }
    // roads along every lane (lifted clear of the sand to avoid z-fighting)
    for (const lx of LAYOUT.lanes) {
      b.plane(lx, 0.10, -230, 9, 230, ROAD);
      b.plane(lx, 0.14, -230, 0.16, 230, [0.52, 0.47, 0.32]);
    }
    // cross streets
    for (let z = LAYOUT.rowsFrom - 35; z >= LAYOUT.rowsTo; z -= LAYOUT.rowStep) {
      b.plane(0, 0.08, z, 250, 8, ROAD);
    }
    // scattered rocks + scrub for parallax near the nest
    for (let i = 0; i < 90; i++) {
      const a = r() * TAU, d = 60 + r() * 620;
      const x = Math.sin(a) * d, z = Math.cos(a) * d * -0.6 - 60;
      if (Math.abs(x) < 250 && z > -440) continue;
      const s = 0.5 + r() * 2.2;
      b.box(x, s * 0.4, z, s, s * 0.4, s * 0.8, shade(SAND_DARK, 0.8 + r() * 0.4), r() * TAU);
    }
    // ridge line: distant mesas that frame the valley
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 + r() * 0.1;
      const d = 1500 + r() * 900;
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 200;
      const h = 55 + r() * 110;
      const col = shade([0.60, 0.51, 0.42], 0.78 + r() * 0.3);
      b.box(x, h / 2 - 12, z, 150 + r() * 240, h / 2, 130 + r() * 180, col, r() * 0.6);
      // a smaller shoulder so the silhouette is not one clean slab
      b.box(x + (r() - 0.5) * 220, h * 0.32 - 12, z + (r() - 0.5) * 180,
        90 + r() * 130, h * 0.32, 80 + r() * 110, shade(col, 0.92), r() * 0.6);
    }
  }

  /* ---------------------------- assembly ------------------------------- */

  /* Bullets are tested against these coarse boxes, so cover really covers. */
  function blocker(list, cx, cy, cz, hx, hy, hz) {
    list.push({
      min: [cx - hx, cy - hy, cz - hz],
      max: [cx + hx, cy + hy, cz + hz],
      top: cy + hy,
    });
  }

  function buildStatic(gl, seed) {
    const r = global.E.mulberry32(seed);
    const b = new MeshBuilder();
    const cover = [];
    const blockers = [];

    addGround(b, r);
    addNest(b);
    addGate(b);
    addApproach(b, r);

    // gate barriers and hesco line
    blocker(blockers, -28, 2.2, LAYOUT.gate.z, 6.5, 2.2, 1.4);
    blocker(blockers, 28, 2.2, LAYOUT.gate.z, 6.5, 2.2, 1.4);
    blocker(blockers, -12, 0.8, LAYOUT.gate.z, 5, 0.8, 0.5);
    blocker(blockers, 12, 0.8, LAYOUT.gate.z, 5, 0.8, 0.5);

    const blockCenters = [-35, 35, -105, 105, -175, 175, -245, 245];
    for (let z = LAYOUT.rowsFrom; z >= LAYOUT.rowsTo; z -= LAYOUT.rowStep) {
      for (const bx of blockCenters) {
        const roll = r();
        if (roll < 0.14) {
          // empty lot: props and cover
          const n = 2 + Math.floor(r() * 4);
          for (let i = 0; i < n; i++) {
            const px = bx + (r() - 0.5) * 40, pz = z + (r() - 0.5) * 40;
            const pick = r();
            if (pick < 0.35) addCrate(b, px, pz, r() * TAU, r);
            else if (pick < 0.6) addBarrel(b, px, pz, r);
            else if (pick < 0.8) addPalm(b, px, pz, r);
            else addCar(b, px, pz, r() * TAU, r);
          }
          continue;
        }
        const splits = roll < 0.5 ? 1 : 2;
        for (let s = 0; s < splits; s++) {
          const w = splits === 1 ? 30 + r() * 20 : 18 + r() * 12;
          const d = 26 + r() * 22;
          // kept below the nest so the streets stay covered from above,
          // with the odd tower to break up the skyline and eat sightlines
          const h = r() < 0.12 ? 28 + r() * 14 : 5 + Math.pow(r(), 2.0) * 22;
          const ox = splits === 1 ? (r() - 0.5) * 8 : (s === 0 ? -14 : 14) + (r() - 0.5) * 5;
          const oz = (r() - 0.5) * 14;
          addBuilding(b, bx + ox, z + oz, w, d, h, r);
          blocker(blockers, bx + ox, h / 2, z + oz, w / 2, h / 2, d / 2);
        }
      }
      // street furniture: this is what the soldiers hide behind
      for (const lx of LAYOUT.lanes) {
        if (r() < 0.55) {
          const px = lx + (r() - 0.5) * 12, pz = z + (r() - 0.5) * 46;
          const pick = r();
          if (pick < 0.3) { addCar(b, px, pz, r() * TAU, r); blocker(blockers, px, 0.8, pz, 1.6, 0.8, 2.4); }
          else if (pick < 0.55) { addCrate(b, px, pz, r() * TAU, r); blocker(blockers, px, 0.7, pz, 1.0, 0.7, 1.0); }
          else if (pick < 0.75) { addBarrel(b, px, pz, r); blocker(blockers, px, 0.55, pz, 0.4, 0.55, 0.4); }
          else { addSandbags(b, px, pz, r() * TAU, 3 + Math.floor(r() * 3)); blocker(blockers, px, 0.5, pz, 1.6, 0.5, 1.6); }
          cover.push({ x: px, z: pz });
        }
      }
    }

    return { mesh: new Mesh(gl, b), cover, blockers, tris: b.count / 3 };
  }

  /* ------------------------- character meshes --------------------------- */
  /* Built white so a single set can be tinted per soldier type at draw
     time. Pivots sit at the joint so limbs swing correctly. */

  function buildCharacter(gl) {
    const W = [1, 1, 1];
    const mk = (fn) => { const b = new MeshBuilder(); fn(b); return new Mesh(gl, b); };

    return {
      // pivot: hip (y = 0.92)
      hips: mk((b) => b.box(0, 0.04, 0, 0.20, 0.15, 0.15, W)),
      torso: mk((b) => {
        b.box(0, 0.42, 0, 0.28, 0.32, 0.17, W);
        b.box(0, 0.70, 0, 0.30, 0.06, 0.19, W);       // collar
        b.box(0, 0.34, 0.19, 0.22, 0.20, 0.05, W);    // chest rig
        b.box(0, 0.40, -0.21, 0.20, 0.24, 0.08, W);   // pack
      }),
      // pivot: neck (y = 1.62)
      head: mk((b) => {
        b.box(0, 0.11, 0, 0.115, 0.135, 0.115, W);
        b.box(0, 0.20, 0, 0.135, 0.075, 0.135, W);    // helmet
        b.box(0, 0.11, 0.12, 0.09, 0.05, 0.03, W);    // goggles
      }),
      // pivot: shoulder (y = 1.48, x = ±0.33)
      arm: mk((b) => {
        b.box(0, -0.20, 0, 0.085, 0.22, 0.095, W);
        b.box(0, -0.52, 0.02, 0.075, 0.16, 0.085, W);
        b.box(0, -0.70, 0.04, 0.065, 0.06, 0.075, W); // glove
      }),
      // pivot: hip (y = 0.92)
      leg: mk((b) => {
        b.box(0, -0.28, 0, 0.105, 0.28, 0.13, W);
        b.box(0, -0.72, 0, 0.095, 0.20, 0.115, W);
        b.box(0, -0.90, 0.05, 0.10, 0.055, 0.17, W);  // boot
      }),
      // pivot: hands, +Z is the barrel
      rifle: mk((b) => {
        b.box(0, 0, 0.28, 0.035, 0.045, 0.42, [0.30, 0.30, 0.32]);
        b.box(0, -0.02, -0.14, 0.045, 0.075, 0.22, [0.36, 0.28, 0.20]);
        b.box(0, -0.13, 0.02, 0.035, 0.09, 0.05, [0.30, 0.30, 0.32]);
        b.box(0, 0.07, 0.05, 0.025, 0.035, 0.16, [0.24, 0.24, 0.26]);
      }),
      // 1x1 unit cube, used for debris and tracers
      cube: mk((b) => b.box(0, 0, 0, 0.5, 0.5, 0.5, W)),
      // ground decal quad
      quad: mk((b) => b.plane(0, 0, 0, 0.5, 0.5, W)),
      // shield carried by heavies
      shield: mk((b) => {
        b.box(0, 0, 0, 0.42, 0.60, 0.05, [0.42, 0.44, 0.46]);
        b.box(0, 0.22, 0.05, 0.24, 0.16, 0.02, [0.16, 0.20, 0.24]);
      }),
      // scope glint for enemy marksmen
      glint: mk((b) => b.box(0, 0, 0, 0.09, 0.09, 0.09, W)),
    };
  }

  global.World = { LAYOUT, buildStatic, buildCharacter, SAND };
})(window);

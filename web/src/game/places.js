// Camps and landmarks along the Long Water: where they stand, their models,
// their lights at night, discovery, and the camp menu (rest, boats, jobs,
// shuttle).
import { MeshBuilder } from "../render/meshes.js";
import { boatMatrix } from "../render/boats.js";
import { heightAt, waterAt } from "../world/terrain.js";
import { clamp, lerp, smoothstep } from "../world/noise.js";
import { mulberry32 } from "../world/rng.js";
import { POINT_SOFT } from "../render/bridge.js";

// river, fraction along it, side (+1 river-right, -1 river-left)
export const CAMPS = [
  { id: "fork", name: "Meadow Fork", river: "long", f: 0.335, side: -1, flag: [0.95, 0.45, 0.1], blurb: "Where the Brightwater meets the Long Water. Everyone starts here." },
  { id: "tarn", name: "Tarn Hut", river: "long", f: 0.03, side: 1, flag: [0.4, 0.7, 1], blurb: "A stone hut by the spring at the top of the world." },
  { id: "lodge", name: "Brightwater Lodge", river: "bright", f: 0.4, side: 1, flag: [1, 0.85, 0.2], blurb: "Log lodge, warm stove, cold creek." },
  { id: "lookout", name: "Gorge Lookout", river: "long", f: 0.5, side: 1, flag: [0.9, 0.2, 0.2], blurb: "Last flat water before the gorge. Scout it from here." },
  { id: "dock", name: "Mirror Dock", river: "lake", f: 0, side: 1, flag: [0.3, 0.9, 0.8], blurb: "A long dock on the east shore of Mirror Lake." },
  { id: "mill", name: "Coldwater Mill", river: "cold", f: 0.52, side: -1, flag: [0.7, 0.5, 0.9], blurb: "The old mill still turns. The miller trades in cargo." },
  { id: "ferry", name: "Ferry Landing", river: "long", f: 0.84, side: -1, flag: [0.2, 0.5, 0.95], blurb: "The ferry crossing below the lake." },
  { id: "town", name: "Saltmouth", river: "long", f: 0.93, side: 1, flag: [1, 1, 1], blurb: "The town at the river's mouth, and the sea beyond." },
];

export const LANDMARKS = [
  { id: "spring", name: "Tarn Spring", river: "long", f: 0.004, side: 0, kind: "spring", blurb: "The Long Water begins as a trickle from under a stone." },
  { id: "falls", name: "The High Falls", river: "long", f: 0, side: 0, kind: "falls", blurb: "Sixteen metres of white water. Some run it. Most carry round." },
  { id: "arch", name: "Stone Arch", river: "bright", f: 0.62, side: 0, kind: "arch", blurb: "The Brightwater runs under a natural arch of grey stone." },
  { id: "hotspring", name: "Hot Spring", river: "cold", f: 0.22, side: 1, kind: "hotspring", blurb: "Steam in the cold valley. Paddlers rest here on the way down." },
  { id: "bridge", name: "Sunken Bridge", river: "long", f: 0.42, side: 0, kind: "bridge", blurb: "Stone piers of a bridge the river took long ago." },
  { id: "throat", name: "The Throat", river: "long", f: 0, side: 0, kind: "throat", blurb: "The narrowest, fastest water in the valley. Class V." },
  { id: "isle", name: "Lone Pine Isle", river: "lake", f: 0, side: 0, kind: "isle", blurb: "One pine on one rock in the middle of Mirror Lake." },
  { id: "wheel", name: "The Mill Wheel", river: "cold", f: 0.52, side: 1, kind: "wheel", blurb: "Turned by the Coldwater for a hundred years." },
  { id: "rookery", name: "Heron Rookery", river: "long", f: 0.93, side: -1, kind: "rookery", blurb: "Grey herons nest in the dead trees of the delta." },
  { id: "lighthouse", name: "Saltmouth Light", river: "long", f: 0.975, side: -1, kind: "lighthouse", blurb: "The end of the river. The light turns all night." },
];

const WOOD = [0.42, 0.28, 0.16], WOOD_D = [0.28, 0.18, 0.1], STONE = [0.55, 0.53, 0.5], CANVAS = [0.86, 0.8, 0.66], ROOF = [0.45, 0.2, 0.15];

export class Places {
  constructor(game) {
    this.game = game;
    this.camps = []; this.landmarks = []; this.lights = []; this.anim = [];
    this.layout();
  }

  // Where every place stands. Camps flatten their ground (before upload).
  layout() {
    const w = this.game.world;
    const riverById = Object.fromEntries(w.rivers.map((r) => [r.id, r]));
    const at = (def) => {
      if (def.river === "lake") {
        const L = w.lake;
        if (def.kind === "isle") return { x: L.cx - L.R * 0.15, z: L.cz + L.R * 0.1, level: L.level, tx: 1, tz: 0, half: 0, sample: null };
        const ang = 0.15, r = L.radiusAt(ang) + 4;
        return { x: L.cx + Math.cos(ang) * r, z: L.cz + Math.sin(ang) * r, level: L.level, tx: 0, tz: 1, half: 0, shore: true, sample: null, nx: -Math.cos(ang), nz: -Math.sin(ang) };
      }
      const r = riverById[def.river], S = r.samples;
      let p;
      if (def.kind === "falls") p = S.reduce((a, q, i) => (i && S[i - 1].level - q.level > (a.drop || 0) ? { ...q, drop: S[i - 1].level - q.level } : a), {});
      else if (def.kind === "throat") p = S.find((q) => q.cls === 5 && q.s / r.length > 0.45) || S[Math.floor(S.length * 0.6)];
      else p = S[Math.min(S.length - 1, Math.max(0, Math.round(def.f * (S.length - 1))))];
      return { x: p.x, z: p.z, level: p.level, tx: p.tx, tz: p.tz, half: p.width / 2, sample: p };
    };
    for (const def of CAMPS) {
      const p = at(def);
      let x, z, nx, nz;
      if (p.shore) { x = p.x; z = p.z; nx = p.nx; nz = p.nz; }
      else { const off = p.half + 9; x = p.x - p.tz * off * def.side; z = p.z + p.tx * off * def.side; nx = p.tz * def.side; nz = -p.tx * def.side; }
      // Never in the water: step away from it until the ground is dry and above the river.
      for (let k = 0; k < 60 && !this.dry(x, z, p.level + 0.4); k++) { x -= nx * 2; z -= nz * 2; }
      // nx, nz: from the camp toward the water.
      const camp = { ...def, x, z, y: p.level + 1.3, level: p.level, nx, nz, rx: p.x, rz: p.z, sample: p.sample };
      this.flatten(x, z, 13, camp.y);
      this.camps.push(camp);
    }
    for (const def of LANDMARKS) {
      const p = at(def);
      const off = def.side ? p.half + 7 : 0;
      const x = p.x - p.tz * off * def.side, z = p.z + p.tx * off * def.side;
      let lx = x, lz = z;
      if (def.side) {
        // Built things stand on dry land: walk away from the river (and the sea, to the north-west).
        const ax = p.tz * def.side, az = -p.tx * def.side;
        for (let k = 0; k < 80 && !this.dry(lx, lz, Math.max(p.level, 0) + 0.8); k++) { lx -= ax * 1.5 + 0.7; lz -= az * 1.5 + 0.7; }
      }
      const lm = { ...def, x: lx, z: lz, level: p.level, tx: p.tx, tz: p.tz, half: p.half };
      if (def.kind === "hotspring" || def.kind === "rookery" || def.kind === "lighthouse" || def.kind === "wheel") this.flatten(x, z, 8, p.level + 1.0);
      this.landmarks.push(lm);
    }
  }

  dry(x, z, minH) {
    const w = this.game.world;
    return Number.isNaN(waterAt(w, x, z)) && heightAt(w, x, z) > minH;
  }

  // Blend the ground under (x, z) to height y within radius r (and repaint it).
  flatten(x, z, r, y) {
    const w = this.game.world, { n, cell, heights, colors, water } = w;
    const R = r + 6;
    for (let j = Math.floor((z - R) / cell); j <= Math.ceil((z + R) / cell); j++) for (let i = Math.floor((x - R) / cell); i <= Math.ceil((x + R) / cell); i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const c = j * n + i, d = Math.hypot(i * cell - x, j * cell - z);
      if (!Number.isNaN(water[c])) continue;
      const k = 1 - smoothstep(r, R, d);
      if (k <= 0) continue;
      heights[c] = lerp(heights[c], y, k);
      const t = k * 0.6;
      colors[c * 3] = lerp(colors[c * 3], 0.36, t); colors[c * 3 + 1] = lerp(colors[c * 3 + 1], 0.31, t); colors[c * 3 + 2] = lerp(colors[c * 3 + 2], 0.2, t);
    }
  }

  build() {
    const g = this.game, b = new MeshBuilder();
    const rnd = mulberry32(g.world.seed + 404);
    for (const c of this.camps) this.buildCamp(b, c, rnd);
    for (const l of this.landmarks) this.buildLandmark(b, l, rnd);
    g.bridge.mesh(b.build());
    // Animated parts.
    for (const a of this.anim) a.slot = g.bridge.mesh(a.mesh);
  }

  buildCamp(b, c, rnd) {
    const { x, z, y, nx, nz } = c;
    const yaw = Math.atan2(nz, nx);   // local +x faces the water
    const P = (lx, lz) => [x + Math.cos(yaw) * lx - Math.sin(yaw) * lz, z + Math.sin(yaw) * lx + Math.cos(yaw) * lz];
    // Dock: planks from the bank out over the water.
    for (let k = 0; k < 7; k++) {
      const [px, pz] = P(5 + k * 1.2, 0);
      const wl = waterAt(this.game.world, px, pz);
      b.box(px, Math.max(c.level + 0.35, Number.isNaN(wl) ? y - 0.2 : wl + 0.35), pz, 0.55, 0.06, 1.3, k % 2 ? WOOD : [0.47, 0.32, 0.19], yaw);
    }
    for (const s of [-1, 1]) { const [px, pz] = P(11.5, s * 1.25); b.box(px, c.level, pz, 0.12, 1.1, 0.12, WOOD_D, yaw); }
    // Tents or a lodge.
    c.obstacles = [];
    c.P = P; c.yaw = yaw;
    const big = c.id === "lodge" || c.id === "mill" || c.id === "town" || c.id === "tarn";
    if (big) {
      const [hx, hz] = P(-5, 0);
      const wall = c.id === "tarn" ? STONE : c.id === "town" ? [0.85, 0.82, 0.74] : WOOD;
      b.box(hx, y + 1.4, hz, 3.2, 1.6, 2.6, wall, yaw);
      c.obstacles.push({ x: hx, z: hz, r: 3.4 });
      this.roof(b, hx, y + 3.0, hz, 3.5, 2.9, 1.8, c.id === "town" ? [0.3, 0.32, 0.4] : ROOF, yaw);
      const [dx, dz] = P(-1.75, 0); b.box(dx, y + 0.9, dz, 0.06, 0.9, 0.55, WOOD_D, yaw);
      const [wx, wz] = P(-1.75, 1.6); b.box(wx, y + 1.7, wz, 0.07, 0.35, 0.4, [1, 0.85, 0.45], yaw);
      this.lights.push({ x: wx + Math.cos(yaw) * 0.6, y: y + 1.8, z: wz + Math.sin(yaw) * 0.6, r: 9, c: [1, 0.75, 0.4], i: 1.1, window: true });
      if (c.id === "town") {
        for (let k = 0; k < 6; k++) {
          const [tx, tz] = P(-12 - (k % 3) * 8, (k < 3 ? -1 : 1) * (7 + rnd() * 3));
          const ty = heightAt(this.game.world, tx, tz);
          if (ty < c.level + 0.5) continue;
          b.box(tx, ty + 1.3, tz, 2.4, 1.6, 2.0, [0.8 + rnd() * 0.15, 0.75 + rnd() * 0.15, 0.65], yaw + rnd() * 0.3);
          this.roof(b, tx, ty + 2.9, tz, 2.7, 2.3, 1.4, [0.35 + rnd() * 0.3, 0.2, 0.18], yaw);
        }
      }
    } else {
      for (const [lx, lz, col] of [[-4, -3.5, [0.95, 0.55, 0.15]], [-5.5, 2.5, [0.25, 0.55, 0.85]], [-1.5, 4.5, [0.3, 0.7, 0.35]]]) {
        const [tx, tz] = P(lx, lz);
        this.tent(b, tx, y, tz, 1.4, 2.0, 1.3, col, yaw + rnd() * 0.8);
        c.obstacles.push({ x: tx, z: tz, r: 1.8 });
      }
    }
    // Fire ring.
    const [fx, fz] = P(-0.5, -1);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; b.box(fx + Math.cos(a) * 0.8, y + 0.12, fz + Math.sin(a) * 0.8, 0.22, 0.14, 0.18, STONE, a); }
    b.box(fx, y + 0.15, fz, 0.6, 0.08, 0.1, WOOD_D, 0.5); b.box(fx, y + 0.18, fz, 0.6, 0.08, 0.1, WOOD_D, -0.7);
    for (const [lx, lz] of [[-0.5, 1.4], [1.2, -1.6]]) { const [sx, sz] = P(lx, lz); b.box(sx, y + 0.25, sz, 0.9, 0.2, 0.25, WOOD, yaw + 0.3); }
    c.fire = { x: fx, y: y + 0.4, z: fz };
    c.obstacles.push({ x: fx, z: fz, r: 0.9 });
    // Notice board (jobs) and boat rack (boats), for paddlers ashore.
    const [nx2, nz2] = P(1.0, -4.6);
    b.box(nx2, y + 0.8, nz2, 0.08, 0.8, 0.08, WOOD_D, yaw); const [nx3, nz3] = P(1.0, -3.0); b.box(nx3, y + 0.8, nz3, 0.08, 0.8, 0.08, WOOD_D, yaw);
    const [nbx, nbz] = P(1.0, -3.8);
    b.box(nbx, y + 1.55, nbz, 0.06, 0.5, 1.0, WOOD, yaw);
    for (let k = 0; k < 3; k++) { const [px2, pz2] = P(1.07, -4.3 + k * 0.45); b.box(px2, y + 1.55 + (k % 2) * 0.12, pz2, 0.01, 0.16, 0.14, [0.95, 0.92, 0.8], yaw); }
    const [rx, rz] = P(-2.5, 6.5);
    b.box(rx, y + 0.5, rz, 0.1, 0.5, 1.6, WOOD_D, yaw); const [rx2, rz2] = P(-4.5, 6.5); b.box(rx2, y + 0.5, rz2, 0.1, 0.5, 1.6, WOOD_D, yaw);
    const [kbx, kbz] = P(-3.5, 6.5);
    b.box(kbx, y + 0.95, kbz, 1.6, 0.12, 0.3, [0.95, 0.72, 0.1], yaw);   // a kayak on the rack
    b.box(kbx, y + 0.65, kbz + 0.0, 1.9, 0.12, 0.35, [0.2, 0.5, 0.35], yaw); // and a canoe
    c.obstacles.push({ x: kbx, z: kbz, r: 1.6 }, { x: nbx, z: nbz, r: 0.6 });
    this.lights.push({ x: fx, y: y + 1.0, z: fz, r: 14, c: [1, 0.55, 0.2], i: 1.6, fire: true });
    // Flag pole.
    const [px, pz] = P(2.5, 3.5);
    b.frustum(px, y, pz, 0.08, 0.06, 7, 5, [0.85, 0.85, 0.85]);
    c.flagAt = { x: px, y: y + 6.3, z: pz };
    const flag = new MeshBuilder();
    flag.poly2([[0, 0.6, 0], [0, -0.6, 0], [2.0, -0.4, 0], [2.0, 0.4, 0]], c.flag);
    this.anim.push({ kind: "flag", camp: c, mesh: flag.build(), x: px, y: y + 6.3, z: pz, phase: rnd() * 6 });
    // Shuttle truck at the camps that have a road (all of them, for now).
    const [kx, kz] = P(-9, -6.5);
    c.obstacles.push({ x: kx, z: kz, r: 2.4 });
    c.spots = [
      { id: "fire", x: fx, z: fz, r: 2.6, label: "Rest by the fire", tab: "camp" },
      { id: "board", x: nbx, z: nbz, r: 2.2, label: "Read the job board", tab: "jobs" },
      { id: "rack", x: kbx, z: kbz, r: 2.8, label: "Look over the boats", tab: "boats" },
      { id: "truck", x: kx, z: kz, r: 3.6, label: "Ride the shuttle truck", tab: "shuttle" },
      { id: "dock", ...(([ax, az]) => ({ x: ax, z: az }))(P(5.2, 0)), r: 2.4, label: "Get back in the boat", embark: true },
    ];
    const ky = heightAt(this.game.world, kx, kz);
    b.box(kx, ky + 0.8, kz, 2.2, 0.5, 1.0, [0.65, 0.18, 0.12], yaw);
    b.box(kx + Math.cos(yaw) * 1.3, ky + 1.55, kz + Math.sin(yaw) * 1.3, 0.8, 0.45, 0.95, [0.65, 0.18, 0.12], yaw);
    b.box(kx - Math.cos(yaw) * 0.9, ky + 1.45, kz - Math.sin(yaw) * 0.9, 1.4, 0.18, 0.9, [0.95, 0.75, 0.2], yaw);
    for (const [a, s] of [[1.4, 1], [1.4, -1], [-1.4, 1], [-1.4, -1]]) b.box(kx + Math.cos(yaw) * a - Math.sin(yaw) * s, ky + 0.35, kz + Math.sin(yaw) * a + Math.cos(yaw) * s, 0.35, 0.35, 0.15, [0.08, 0.08, 0.08], yaw);
  }

  tent(b, x, y, z, hw, hd, h, col, yaw) {
    const P = (lx, ly, lz) => [x + Math.cos(yaw) * lx - Math.sin(yaw) * lz, y + ly, z + Math.sin(yaw) * lx + Math.cos(yaw) * lz];
    const A = P(-hw, 0, -hd), B = P(hw, 0, -hd), C = P(hw, 0, hd), D = P(-hw, 0, hd), T0 = P(0, h, -hd), T1 = P(0, h, hd);
    b.poly([A, T0, T1, D], col); b.poly([C, T1, T0, B], [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]);
    b.poly([B, T0, A], CANVAS); b.poly([D, T1, C], [0.15, 0.12, 0.1]);
  }

  roof(b, x, y, z, hw, hd, h, col, yaw) {
    const P = (lx, ly, lz) => [x + Math.cos(yaw) * lx - Math.sin(yaw) * lz, y + ly, z + Math.sin(yaw) * lx + Math.cos(yaw) * lz];
    const A = P(-hw, 0, -hd), B = P(hw, 0, -hd), C = P(hw, 0, hd), D = P(-hw, 0, hd), T0 = P(-hw, h, 0), T1 = P(hw, h, 0);
    b.poly([A, T0, T1, B], col); b.poly([C, T1, T0, D], [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85]);
    b.poly([D, T0, A], col); b.poly([B, T1, C], col);
  }

  buildLandmark(b, l, rnd) {
    const g = this.game, W = g.world;
    const yawR = Math.atan2(l.tz, l.tx);
    const side = (k) => [l.x - l.tz * k, l.z + l.tx * k];
    if (l.kind === "arch") {
      const span = l.half + 3;
      for (const s of [-1, 1]) {
        const [px, pz] = side(s * span);
        const gy = heightAt(W, px, pz);
        for (let k = 0; k < 4; k++) b.rock(px, gy + k * 2.6, pz, 2.6 - k * 0.2, [0.52, 0.5, 0.47], rnd);
      }
      const N = 9;
      for (let k = 0; k <= N; k++) {
        const t = k / N, lat = lerp(-span, span, t), [px, pz] = side(lat);
        b.rock(px, l.level + 9 + Math.sin(t * Math.PI) * 3, pz, 2.1, [0.55, 0.53, 0.5], rnd);
      }
    } else if (l.kind === "bridge") {
      for (const s of [-0.6, 0.15, 0.85]) {
        const [px, pz] = side(s * l.half * 1.3);
        b.box(px, l.level + 1.2, pz, 1.2, 2.6, 1.6, [0.5, 0.49, 0.46], yawR);
      }
      const [ax, az] = side(-l.half - 4), ay = heightAt(W, ax, az);
      b.box(ax, ay + 2.2, az, 2.5, 0.4, 2.0, [0.5, 0.49, 0.46], yawR + Math.PI / 2);
      const [cx, cz] = side(l.half * 0.5);
      b.box(cx, l.level + 4.0, cz, 3.5, 0.35, 1.9, [0.48, 0.47, 0.44], yawR + Math.PI / 2 + 0.06);
    } else if (l.kind === "hotspring") {
      b.frustum(l.x, l.level + 0.95, l.z, 3.4, 3.2, 0.2, 10, [0.75, 0.72, 0.62]);
      b.frustum(l.x, l.level + 1.0, l.z, 2.8, 2.8, 0.18, 10, [0.35, 0.75, 0.8]);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.rock(l.x + Math.cos(a) * 3.6, l.level + 1.1, l.z + Math.sin(a) * 3.6, 0.7, STONE, rnd); }
    } else if (l.kind === "isle") {
      b.rock(l.x, l.level - 1, l.z, 6, [0.45, 0.43, 0.4], rnd);
      b.rock(l.x + 2, l.level - 1.5, l.z + 1, 4.5, [0.4, 0.38, 0.35], rnd);
      b.frustum(l.x, l.level + 2, l.z, 0.4, 0.3, 4, 5, [0.3, 0.2, 0.12]);
      for (let k = 0; k < 4; k++) b.frustum(l.x, l.level + 4 + k * 2.2, l.z, 3.2 - k * 0.6, 0, 3.4, 7, [0.07, 0.22 + k * 0.02, 0.09], null, k);
    } else if (l.kind === "wheel") {
      const [hx, hz] = side(l.half + 7);
      const hy = heightAt(W, hx, hz);
      b.box(hx, hy + 2.2, hz, 3.6, 2.6, 3.0, [0.5, 0.48, 0.44], yawR);
      this.roof(b, hx, hy + 4.8, hz, 3.9, 3.3, 2.2, ROOF, yawR);
      const wheel = new MeshBuilder();
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * Math.PI * 2;
        wheel.box(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0, 0.8, 0.08, 0.6, WOOD, 0);
        wheel.box(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0, 1.0, 0.05, 0.05, WOOD_D, 0);
      }
      const [wx, wz] = side(l.half + 2.6);
      this.anim.push({ kind: "wheel", mesh: wheel.build(), x: wx, y: l.level + 1.2, z: wz, yaw: yawR });
    } else if (l.kind === "rookery") {
      for (let k = 0; k < 6; k++) {
        const tx = l.x + (rnd() - 0.5) * 16, tz = l.z + (rnd() - 0.5) * 16, ty = heightAt(W, tx, tz);
        b.frustum(tx, ty, tz, 0.35, 0.15, 7, 5, [0.55, 0.52, 0.48]);
        for (let m = 0; m < 3; m++) b.box(tx, ty + 4 + m * 1.2, tz, 1.5, 0.08, 0.08, [0.5, 0.47, 0.43], rnd() * 3);
        b.frustum(tx, ty + 7, tz, 0.8, 0.9, 0.35, 6, [0.4, 0.32, 0.22]);
        b.box(tx, ty + 7.6, tz, 0.15, 0.3, 0.12, [0.75, 0.77, 0.8]);
      }
    } else if (l.kind === "lighthouse") {
      const gy = heightAt(W, l.x, l.z);
      for (let k = 0; k < 6; k++) b.frustum(l.x, gy + k * 2.2, l.z, 2.1 - k * 0.15, 2.0 - k * 0.15, 2.2, 10, k % 2 ? [0.85, 0.15, 0.12] : [0.95, 0.95, 0.92]);
      b.frustum(l.x, gy + 13.2, l.z, 1.3, 1.3, 1.6, 8, [1, 0.95, 0.7]);
      b.frustum(l.x, gy + 14.8, l.z, 1.6, 0, 1.4, 8, [0.15, 0.15, 0.18]);
      l.lamp = { x: l.x, y: gy + 14, z: l.z };
      this.lights.push({ x: l.x, y: gy + 14, z: l.z, r: 40, c: [1, 0.9, 0.6], i: 2.2, lighthouse: true });
    } else if (l.kind === "spring") {
      b.rock(l.x, l.level, l.z - 3, 3.5, [0.5, 0.5, 0.52], rnd);
    }
  }

  spawn() {
    const c = this.camps[0];
    const x = c.x + c.nx * 15, z = c.z + c.nz * 15;
    const s = c.sample;
    return { x, z, heading: s ? Math.atan2(s.tz, s.tx) : 0 };
  }

  campNear(x, z, r = 28) {
    let best = null, bd = r;
    for (const c of this.camps) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  regionName(x, z) {
    const w = this.game.world;
    if (w.lake.inside(x, z)) return "Mirror Lake";
    const wl = waterAt(w, x, z);
    if (wl === 0 && heightAt(w, x, z) < -1) return "The Sea";
    const b = this.game.boat, hit = b && b.current && b.current.hit;
    if (!hit) return null;
    const r = hit.river, f = hit.sample.s / r.length;
    if (r.id === "long") return f < 0.17 ? "The Headwaters" : f < 0.24 ? "The High Falls" : f < 0.47 ? "The Meadows" : f < 0.62 ? "The Gorge" : f < 0.72 ? "Mirror Lake" : f < 0.9 ? "The Lower River" : "The Delta";
    return r.name;
  }

  // E at a camp: step ashore (or, ashore, use what's in reach).
  interact() {
    const g = this.game;
    if (g.walker?.active) return g.walker.interact();
    const b = g.boat, c = this.campNear(b.x, b.z);
    if (!c) return false;
    if (!g.walker?.disembark(c)) g.hud.panels.camp?.openAt(c);
    return true;
  }

  tick(dt) {
    const g = this.game, b = g.pos();
    // Discoveries.
    for (const p of [...this.camps, ...this.landmarks]) {
      if (Math.hypot(p.x - b.x, p.z - b.z) < (p.kind ? 60 : 45)) g.journal?.discover(p);
    }
    const c = this.campNear(b.x, b.z);
    if (c !== this.near) {
      this.near = c;
      if (c) { g.journal?.visitCamp(c); g.audio?.bark?.("camp"); }
    }
    const sp = Math.hypot(b.vx, b.vz);
    if (g.walker?.active) return;
    g.hud.prompt(c && !g.hud.anyOpen() ? `<b>${c.name}</b> · ${g.input.touch ? `<button class="btn" id="p-camp">Go ashore</button>` : "<kbd>E</kbd> go ashore and walk around"}` : g.races?.promptHtml?.() || null);
    const pb = document.getElementById("p-camp");
    if (pb && !pb.onclick) pb.onclick = () => this.interact();
    void sp;
  }

  draw(R, labels) {
    const g = this.game, b = g.boat, t = g.time, night = g.night || 0;
    // Animated meshes.
    const m = this.mat || (this.mat = new Float32Array(16));
    for (const a of this.anim) {
      if (a.kind === "flag") {
        const wave = Math.sin(t * 2.2 + a.phase) * 0.25;
        boatMatrix(a.x, a.y, a.z, 0.6 + wave, 0, 0, 1, m);
      } else if (a.kind === "wheel") {
        boatMatrix(a.x, a.y, a.z, a.yaw, -t * 0.8, 0, 1, m);
      }
      g.bridge.transform(a.slot, m);
    }
    // Lights: fires always glow a little; windows and the lighthouse at night.
    for (const l of this.lights) {
      const d = Math.hypot(l.x - b.x, l.z - b.z);
      if (d > (l.lighthouse ? 1600 : 420)) continue;
      if (l.fire) {
        const flick = 0.85 + Math.sin(t * 13 + l.x) * 0.08 + Math.sin(t * 7.3) * 0.07;
        R.lights.push(l.x, l.y, l.z, l.r, l.c[0], l.c[1], l.c[2], l.i * flick * (0.35 + night), d < 120 ? 3 : 1, 0, 0, 0);
        for (let k = 0; k < 3; k++) {
          const u = ((t * 0.7 + k / 3 + l.x) % 1);
          R.points.push(l.x + Math.sin(t * 3 + k) * 0.2, l.y - 0.3 + u * 2.2, l.z + Math.cos(t * 2 + k) * 0.2, 7 * (1 - u) + 2, 0.25, 1, 0.6, 0.2, 1 - u, POINT_SOFT);
        }
        R.points.push(l.x, l.y - 0.2, l.z, 26, 1.2, 1, 0.5, 0.15, 0.8, POINT_SOFT);
      } else if (night > 0.2) {
        R.lights.push(l.x, l.y, l.z, l.r, l.c[0], l.c[1], l.c[2], l.i * night, l.lighthouse ? 2 : 1, 0, 0, 0);
        if (l.lighthouse) {
          const a = t * 1.2;
          // A long sweeping beam, readable from up the river.
          for (let k = 1; k < 36; k++) R.points.push(l.x + Math.cos(a) * k * 6, l.y - k * 0.08, l.z + Math.sin(a) * k * 6, 26 - k * 0.5, 2.5 + k * 0.35, 1, 0.92, 0.65, 0.42 * night * (1 - k / 36), POINT_SOFT);
          R.points.push(l.x, l.y, l.z, 40, 2, 1, 0.95, 0.7, night, POINT_SOFT);
        } else R.points.push(l.x, l.y, l.z, 14, 0.6, 1, 0.8, 0.45, 0.6 * night, POINT_SOFT);
      }
    }
    // Landmark effects: mist at the falls, steam at the spring.
    for (const l of this.landmarks) {
      const d = Math.hypot(l.x - b.x, l.z - b.z);
      if (d > 300) continue;
      if (l.kind === "falls") for (let k = 0; k < 10; k++) {
        const u = (t * 0.3 + k / 10) % 1;
        R.points.push(l.x + Math.sin(k * 2.1) * 6 * u, l.level - 14 + u * 8, l.z + Math.cos(k * 1.7) * 6 * u, 60, 5, 0.95, 0.97, 1, 0.35 * (1 - u), POINT_SOFT);
      }
      if (l.kind === "hotspring") for (let k = 0; k < 6; k++) {
        const u = (t * 0.25 + k / 6) % 1;
        R.points.push(l.x + Math.sin(k * 2 + t * 0.3) * 1.5, l.level + 1.3 + u * 5, l.z + Math.cos(k * 3) * 1.5, 40, 2.5, 0.92, 0.94, 0.96, 0.4 * (1 - u), POINT_SOFT);
      }
      if (l.kind === "rookery" && night < 0.5) for (let k = 0; k < 4; k++) {
        const a = t * 0.4 + k * 1.7;
        R.points.push(l.x + Math.cos(a) * (12 + k * 3), heightAt(g.world, l.x, l.z) + 12 + Math.sin(t + k) * 2, l.z + Math.sin(a) * (12 + k * 3), 6, 0.8, 0.85, 0.87, 0.9, 1, 0);
      }
    }
    // Names over places within range.
    for (const p of [...this.camps, ...this.landmarks]) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d > 260 || d < 6) continue;
      const known = g.journal?.has(p.id);
      const a = clamp((260 - d) / 80, 0, 1);
      const y = (p.y || p.level) + (p.kind === "lighthouse" ? 20 : p.kind === "arch" ? 16 : 9);
      R.labels.push(p.x, y, p.z, d < 80 ? 16 : 13, 1, p.kind ? 0.86 : 0.95, p.kind ? 0.55 : 0.8, a);
      labels.push(known ? p.name : "?");
    }
    // Fireflies over the meadows at night.
    if (night > 0.4) {
      for (let k = 0; k < 24; k++) {
        const a = k * 2.399, r = 8 + (k * 7.3) % 40;
        const x = b.x + Math.cos(a + t * 0.05) * r, z = b.z + Math.sin(a + t * 0.05) * r;
        const blink = Math.max(0, Math.sin(t * (1.3 + k % 5 * 0.3) + k));
        if (blink < 0.3) continue;
        R.points.push(x, heightAt(g.world, x, z) + 1 + Math.sin(t + k) * 0.5, z, 5, 0.12, 0.85, 1, 0.4, blink * night, POINT_SOFT);
      }
    }
  }
}

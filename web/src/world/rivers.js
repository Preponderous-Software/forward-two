// The Long Water's river network. Rivers are designed, not simulated: each is
// a list of control points (fractions of the world size) carrying a water
// level, a width and a whitewater class; a seeded meander bends the line
// between them. The terrain is then carved around the result (terrain.js), so
// the water always sits in its channel and always runs downhill.
import { fbm, lerp } from "./noise.js";
import { mulberry32 } from "./rng.js";

// [u, v, level (m), width (m), class (0 flat .. 5), meander (m)]
export const NETWORK = [
  {
    id: "long", name: "The Long Water", points: [
      [0.105, 0.075, 122, 7, 2, 6],    // Tarn Spring
      [0.15, 0.13, 116, 8, 3, 8],
      [0.205, 0.195, 109, 9, 3, 8],
      [0.25, 0.265, 104, 10, 4, 6],
      [0.285, 0.322, 100, 11, 4, 3],   // lip of the High Falls
      [0.295, 0.338, 84, 13, 3, 1],    // the plunge pool
      [0.33, 0.38, 83, 15, 2, 6],
      [0.365, 0.415, 82, 18, 1, 14],   // Meadow Fork (Brightwater joins)
      [0.42, 0.44, 81, 20, 1, 26],
      [0.475, 0.465, 80, 21, 1, 30],
      [0.53, 0.49, 79, 20, 2, 18],
      [0.575, 0.535, 76, 14, 3, 6],    // gorge mouth
      [0.605, 0.58, 70, 11, 4, 4],
      [0.625, 0.625, 62, 10, 5, 3],    // the Throat
      [0.645, 0.668, 53, 12, 4, 4],
      [0.665, 0.70, 48, 16, 2, 5],
      [0.69, 0.725, 46, 30, 0, 0],     // into Mirror Lake
      [0.735, 0.765, 46, 30, 0, 0],
      [0.775, 0.795, 46, 22, 1, 4],    // the outlet
      [0.81, 0.82, 42, 22, 2, 14],
      [0.845, 0.85, 34, 20, 3, 10],    // Ferry Rapids
      [0.87, 0.875, 24, 24, 2, 18],
      [0.895, 0.9, 12, 32, 1, 24],
      [0.925, 0.925, 4, 40, 0, 26],    // the Delta
      [0.96, 0.955, 0.6, 52, 0, 10],
      [0.995, 0.985, 0, 70, 0, 0],     // the sea
    ],
  },
  {
    id: "bright", name: "Brightwater", joins: "long", points: [
      [0.43, 0.035, 150, 6, 2, 4],
      [0.445, 0.11, 138, 7, 3, 7],
      [0.43, 0.19, 122, 8, 3, 9],
      [0.415, 0.265, 104, 9, 4, 6],
      [0.395, 0.33, 90, 11, 2, 10],
      [0.38, 0.38, 84, 13, 1, 10],
      [0.365, 0.415, 82, 18, 1, 0],
    ],
  },
  {
    id: "cold", name: "Coldwater", joins: "lake", points: [
      [0.035, 0.52, 132, 6, 2, 5],
      [0.09, 0.545, 118, 7, 3, 8],
      [0.16, 0.57, 104, 9, 2, 12],
      [0.24, 0.6, 90, 11, 3, 10],
      [0.32, 0.625, 78, 12, 2, 16],
      [0.41, 0.66, 66, 13, 3, 12],
      [0.5, 0.69, 56, 14, 2, 16],
      [0.585, 0.715, 49, 16, 1, 12],
      [0.655, 0.738, 46, 22, 0, 0],
    ],
  },
];

export const LAKE = { name: "Mirror Lake", u: 0.712, v: 0.745, r: 0.066, level: 46, depth: 9 };
export const SEA_LEVEL = 0;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Build every river as dense samples about `step` metres apart.
// Each sample: {x, z, level, width, cls, s, tx, tz, river}
export function buildRivers(size, seed, step = 3) {
  const rivers = [];
  for (const [ri, def] of NETWORK.entries()) {
    const rnd = mulberry32(seed + ri * 977);
    const P = def.points.map((p, i) => {
      // Keep junctions and ends exact; jitter the rest a little.
      const fixed = i === 0 || i === def.points.length - 1;
      const j = fixed ? 0 : 0.008;
      return { x: (p[0] + (rnd() - 0.5) * j) * size, z: (p[1] + (rnd() - 0.5) * j) * size, level: p[2], width: p[3], cls: p[4], meander: p[5] };
    });
    // Dense spline first (fine param), then meander, then resample by arc length.
    const fine = [];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(P.length - 1, i + 2)];
      const seg = Math.hypot(c.x - b.x, c.z - b.z);
      const n = Math.max(4, Math.ceil(seg / 1.5));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        fine.push({
          x: catmull(a.x, b.x, c.x, d.x, t), z: catmull(a.z, b.z, c.z, d.z, t),
          level: lerp(b.level, c.level, t), width: lerp(b.width, c.width, t),
          cls: t < 0.5 ? b.cls : c.cls, meander: lerp(b.meander, c.meander, t), ctl: i + t,
        });
      }
    }
    const last = P[P.length - 1];
    fine.push({ x: last.x, z: last.z, level: last.level, width: last.width, cls: last.cls, meander: 0, ctl: P.length - 1 });
    // Meander: push sideways by smooth noise of the running length.
    let s = 0;
    const bent = fine.map((p, i) => {
      if (i > 0) s += Math.hypot(p.x - fine[i - 1].x, p.z - fine[i - 1].z);
      const q = fine[Math.min(fine.length - 1, i + 1)], o = fine[Math.max(0, i - 1)];
      let tx = q.x - o.x, tz = q.z - o.z;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const off = fbm(s / 140, ri * 13.7, seed + 401, 3) * p.meander * 1.6;
      return { x: p.x - tz * off, z: p.z + tx * off, level: p.level, width: p.width, cls: p.cls, ctl: p.ctl };
    });
    // Resample by arc length.
    const out = [];
    let acc = 0, want = 0;
    out.push({ ...bent[0], s: 0 });
    for (let i = 1; i < bent.length; i++) {
      const a = bent[i - 1], b = bent[i];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      while (want + step <= acc + l) {
        want += step;
        const t = (want - acc) / l;
        out.push({
          x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), level: lerp(a.level, b.level, t),
          width: lerp(a.width, b.width, t), cls: t < 0.5 ? a.cls : b.cls, ctl: lerp(a.ctl, b.ctl, t), s: want,
        });
      }
      acc += l;
    }
    const end = bent[bent.length - 1];
    out.push({ ...end, s: acc });
    // Tangents, and make the level never rise downstream.
    for (let i = 0; i < out.length; i++) {
      const q = out[Math.min(out.length - 1, i + 1)], o = out[Math.max(0, i - 1)];
      const tx = q.x - o.x, tz = q.z - o.z, l = Math.hypot(tx, tz) || 1;
      out[i].tx = tx / l; out[i].tz = tz / l;
      if (i > 0 && out[i].level > out[i - 1].level) out[i].level = out[i - 1].level;
      out[i].river = ri;
      out[i].i = i;
    }
    rivers.push({ id: def.id, name: def.name, joins: def.joins || null, samples: out, length: acc });
  }
  return rivers;
}

// Gradient-based speed (m/s) for a river sample: steeper and narrower is faster.
// 0.2.1: whitewater runs faster (class III 2.5 -> 4.0 m/s before the width
// factor): Gorge Gate (320 m) takes about 1:25, not 2:07. Flat water
// (class 0-1) is unchanged. Medal paces in game/courses.js were rescaled to match.
export const FLOW_BASE = [0.45, 1.0, 2.5, 4.0, 4.8, 5.4];
export function flowSpeed(sample) {
  const base = FLOW_BASE[sample.cls] || 0.4;
  return base * Math.min(1.35, Math.max(0.75, 14 / Math.max(6, sample.width)) ** 0.35);
}

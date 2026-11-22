// The Long Water's ground and water. Everything here is deterministic for a
// seed and runs in node (tests/world.test.js) as well as in the page.
//
// Coordinates: metres, x east, z south, y up; the world spans [0, size] on x
// and z, the sea is y = 0 in the south-east corner.
import { fbm, ridged, smoothstep, lerp, clamp } from "./noise.js";
import { buildRivers, LAKE, SEA_LEVEL } from "./rivers.js";

export const PRESETS = {
  full: { n: 1025, cell: 3 },
  small: { n: 513, cell: 6 },
  tiny: { n: 257, cell: 12 }, // tests
};

function baseHeight(x, z, size, seed) {
  const u = x / size, v = z / size;
  const m = clamp(1 - (u * 0.55 + v * 0.45) * 1.05, 0, 1);       // 1 in the north-west, 0 in the south-east
  const edge = Math.max(smoothstep(0.12, 0.0, u), smoothstep(0.1, 0.0, v)) * 0.6; // rims at the north and west edges
  const mount = Math.pow(m, 1.35) + edge;
  const r = ridged(x / 520, z / 520, seed, 5);
  const hills = fbm(x / 260, z / 260, seed + 11, 5);
  let h = 52 + 150 * mount + r * 150 * (0.25 + mount) + hills * 18;
  // The coast: south-east of the line u + v = 1.68 the land slopes into the sea.
  const coast = u + v + fbm(x / 400, z / 400, seed + 23, 3) * 0.08;
  h = lerp(h, -14, smoothstep(1.6, 1.82, coast));
  return h;
}

// The cheap, deterministic part of a world: rivers, the lake, the seeds.
export function buildSkeleton(seed = 1, preset = "full") {
  const { n, cell } = PRESETS[preset] || PRESETS.full;
  const size = (n - 1) * cell;
  const rivers = buildRivers(size, seed, Math.min(3, cell));
  // Seeds: every river sample, then the lake's interior.
  const sx = [], sz = [], sLevel = [], sHalf = [], sRiver = [], sIndex = [];
  rivers.forEach((r, ri) => r.samples.forEach((p, i) => {
    sx.push(p.x); sz.push(p.z); sLevel.push(p.level); sHalf.push(p.width / 2); sRiver.push(ri); sIndex.push(i);
  }));
  const lake = { ...LAKE, cx: LAKE.u * size, cz: LAKE.v * size, R: LAKE.r * size };
  lake.radiusAt = (ang) => lake.R * (1 + 0.2 * fbm(Math.cos(ang) * 1.7 + 5, Math.sin(ang) * 1.7 + 5, seed + 91, 3));
  lake.inside = (x, z) => Math.hypot(x - lake.cx, z - lake.cz) < lake.radiusAt(Math.atan2(z - lake.cz, x - lake.cx));
  for (let z = lake.cz - lake.R * 1.4; z <= lake.cz + lake.R * 1.4; z += cell) {
    for (let x = lake.cx - lake.R * 1.4; x <= lake.cx + lake.R * 1.4; x += cell) {
      if (lake.inside(x, z)) { sx.push(x); sz.push(z); sLevel.push(lake.level); sHalf.push(cell); sRiver.push(-1); sIndex.push(-1); }
    }
  }
  const seeds = { x: Float32Array.from(sx), z: Float32Array.from(sz), level: Float32Array.from(sLevel),
    half: Float32Array.from(sHalf), river: Int16Array.from(sRiver), index: Int32Array.from(sIndex), count: sx.length };
  return { seed, preset, n, cell, size, rivers, lake, seeds };
}

// Build the world: {n, cell, size, heights, colors, water, nearest, nearDist, seeds, rivers, lake}
export function generateWorld(seed = 1, preset = "full", onProgress = null) {
  const skel = buildSkeleton(seed, preset);
  return { ...skel, ...buildGrids(skel, onProgress) };
}

// Attach grids made elsewhere (a worker) to a skeleton.
export function assembleWorld(seed, preset, grids) {
  return { ...buildSkeleton(seed, preset), ...grids };
}

// The heavy part: nearest-water field, heights, water levels, colours.
export function buildGrids(skel, onProgress = null) {
  const { seed, n, cell, size, rivers, lake, seeds } = skel;
  const N = n * n;
  const report = (f, label) => onProgress && onProgress(f, label);
  report(0.08, "Valleys");
  const nearest = new Int32Array(N).fill(-1);
  const best = new Float32Array(N).fill(Infinity);
  for (let k = 0; k < seeds.count; k++) {
    const i = Math.round(seeds.x[k] / cell), j = Math.round(seeds.z[k] / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const c = j * n + i, d = Math.hypot(i * cell - seeds.x[k], j * cell - seeds.z[k]);
    if (d < best[c]) { best[c] = d; nearest[c] = k; }
  }
  const relax = (c, i, j, o) => {
    const k = nearest[o];
    if (k < 0) return;
    const d = Math.hypot(i * cell - seeds.x[k], j * cell - seeds.z[k]);
    if (d < best[c]) { best[c] = d; nearest[c] = k; }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if (i > 0) relax(c, i, j, c - 1);
      if (j > 0) { relax(c, i, j, c - n); if (i > 0) relax(c, i, j, c - n - 1); if (i < n - 1) relax(c, i, j, c - n + 1); }
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const c = j * n + i;
      if (i < n - 1) relax(c, i, j, c + 1);
      if (j < n - 1) { relax(c, i, j, c + n); if (i < n - 1) relax(c, i, j, c + n + 1); if (i > 0) relax(c, i, j, c + n - 1); }
    }
  }

  // Heights: the base land, raised to sit above the nearest water, then carved.
  report(0.2, "Mountains");
  const heights = new Float32Array(N);
  const water = new Float32Array(N).fill(NaN);
  for (let j = 0; j < n; j++) {
    if ((j & 63) === 0) report(0.2 + 0.5 * j / n, "Mountains");
    for (let i = 0; i < n; i++) {
      const c = j * n + i, x = i * cell, z = j * cell;
      let h = baseHeight(x, z, size, seed);
      const k = nearest[c], d = best[c];
      const w = seeds.level[k], half = seeds.half[k], isLake = seeds.river[k] < 0;
      const cls = isLake ? 0 : rivers[seeds.river[k]].samples[seeds.index[k]].cls;
      // Gorges get steep walls; meadows get wide, soft floors.
      const wall = cls >= 4 ? 1.4 : cls === 3 ? 0.55 : 0.12 + 0.05 * cls;
      const floorW = cls >= 4 ? 4 : cls === 3 ? 12 : 26;
      const isSea = w <= 0.7 && h < 2;
      if (!isSea) {
        const above = w + 2.5 + d * 0.035;
        if (h < above && d < 600) h = lerp(above, h, smoothstep(300, 600, d));
        const bank = d - half;
        const valley = w + 0.9 + Math.max(0, bank - floorW) * wall + Math.min(bank, floorW) * 0.04;
        if (bank > 0) h = Math.min(h, valley);
        else {
          if (isLake) {
            const rho = Math.hypot(x - lake.cx, z - lake.cz) / lake.radiusAt(Math.atan2(z - lake.cz, x - lake.cx));
            h = w - Math.max(0.5, LAKE.depth * (1 - Math.min(1, rho) ** 2));
          } else {
            const depth = 1.2 + 0.08 * half;
            h = w - depth * (1 - (d / Math.max(half, 0.01)) ** 2) - 0.25;
          }
        }
      }
      heights[c] = h;
      if (isLake ? lake.inside(x, z) : d <= half + 0.6) water[c] = w;
      if (Number.isNaN(water[c]) && h < SEA_LEVEL) water[c] = SEA_LEVEL;
    }
  }

  report(0.75, "Colour");
  const colors = paintGround(heights, water, nearest, seeds, rivers, n, cell, size, seed);
  report(0.95, "Done");
  return { heights, colors, water, nearest, nearDist: best };
}

// Linear RGB per sample from height, slope, water and region.
function paintGround(heights, water, nearest, seeds, rivers, n, cell, size, seed) {
  const colors = new Float32Array(n * n * 3);
  const C = {
    bed: [0.27, 0.24, 0.18], sand: [0.62, 0.55, 0.38], meadow: [0.22, 0.42, 0.11], lush: [0.15, 0.36, 0.08],
    forest: [0.09, 0.22, 0.07], heath: [0.36, 0.34, 0.16], rock: [0.38, 0.36, 0.33], cliff: [0.3, 0.27, 0.25],
    snow: [0.86, 0.88, 0.9], reed: [0.48, 0.47, 0.2], mud: [0.31, 0.26, 0.17],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = j * n + i, h = heights[c];
    const hx = heights[j * n + Math.min(n - 1, i + 1)] - heights[j * n + Math.max(0, i - 1)];
    const hz = heights[Math.min(n - 1, j + 1) * n + i] - heights[Math.max(0, j - 1) * n + i];
    const slope = Math.hypot(hx, hz) / (2 * cell);
    const x = i * cell, z = j * cell;
    const nz = fbm(x / 90, z / 90, seed + 5, 3), nz2 = fbm(x / 23, z / 23, seed + 6, 2);
    let col;
    const w = water[c];
    if (!Number.isNaN(w) && h < w) {
      col = mix(C.bed, C.sand, clamp(1 - (w - h) / 4, 0, 1) * 0.6);
    } else {
      const k = nearest[c];
      const above = h - seeds.level[k];
      const moist = clamp(1 - (above - 1) / 30, 0, 1);
      // Height bands: meadow → forest → heath → rock → snow.
      col = mix(C.meadow, C.lush, clamp(0.5 + nz, 0, 1));
      col = mix(col, C.forest, smoothstep(95, 130, h) * (1 - moist * 0.7));
      col = mix(col, C.heath, smoothstep(185, 230, h));
      col = mix(col, C.rock, smoothstep(235, 275, h));
      col = mix(col, C.snow, smoothstep(285, 315, h + nz * 18));
      if (h < 3.2) col = mix(col, C.sand, smoothstep(3.2, 1.2, h));
      if (h < 9 && seeds.level[k] < 6) col = mix(col, C.reed, 0.5 * smoothstep(9, 3, h));
      col = mix(col, C.mud, clamp(1 - above / 1.6, 0, 1) * 0.7);
      col = mix(col, slope > 1.1 ? C.cliff : C.rock, smoothstep(0.55, 1.0, slope));
      const v = 1 + nz2 * 0.1;
      col = [col[0] * v, col[1] * v, col[2] * v];
    }
    colors[c * 3] = col[0]; colors[c * 3 + 1] = col[1]; colors[c * 3 + 2] = col[2];
  }
  return colors;
}

// Bilinear height (matches the terrain tile's triangles closely enough for a boat).
export function heightAt(world, x, z) {
  const { n, cell, heights } = world;
  const gx = clamp(x / cell, 0, n - 1.001), gz = clamp(z / cell, 0, n - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = heights[j * n + i], b = heights[j * n + i + 1], c = heights[(j + 1) * n + i], d = heights[(j + 1) * n + i + 1];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// The nearest river sample to (x, z), refined along the polyline. Null in the lake/sea.
export function riverAt(world, x, z) {
  const { n, cell, nearest, seeds, rivers } = world;
  const i = clamp(Math.round(x / cell), 0, n - 1), j = clamp(Math.round(z / cell), 0, n - 1);
  const k = nearest[j * n + i];
  if (k < 0 || seeds.river[k] < 0) return null;
  const r = rivers[seeds.river[k]], S = r.samples;
  let bi = seeds.index[k], bd = Infinity;
  for (let q = Math.max(0, bi - 6); q <= Math.min(S.length - 1, bi + 6); q++) {
    const d = (S[q].x - x) ** 2 + (S[q].z - z) ** 2;
    if (d < bd) { bd = d; bi = q; }
  }
  const p = S[bi];
  const lat = (x - p.x) * -p.tz + (z - p.z) * p.tx; // + is river-right (looking downstream)
  return { river: r, sample: p, dist: Math.sqrt(bd), lateral: lat };
}

// Water surface level at (x, z), or NaN on dry land.
export function waterAt(world, x, z) {
  const { n, cell, water } = world;
  const gx = x / cell, gz = z / cell;
  if (gx < 0 || gz < 0 || gx > n - 1 || gz > n - 1) return SEA_LEVEL;
  const i = Math.round(gx), j = Math.round(gz);
  return water[j * n + i];
}

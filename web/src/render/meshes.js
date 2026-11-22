// Mesh builders: water, trees, rocks, boats and buildings, as plain arrays the
// bridge uploads. Flat-shaded low-poly: faces don't share vertices.
import { fbm, clamp, lerp, smoothstep } from "../world/noise.js";
import { mulberry32 } from "../world/rng.js";
import { flowSpeed } from "../world/rivers.js";

export class MeshBuilder {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.uvs = []; this.indices = []; }
  get nv() { return this.positions.length / 3; }

  // A flat polygon (convex, ordered counter-clockwise seen from outside).
  poly(pts, color, uvs = null) {
    const b = this.nv, [p0, p1, p2] = pts;
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    pts.forEach((p, i) => {
      this.positions.push(p[0], p[1], p[2]); this.normals.push(nx, ny, nz);
      const c = Array.isArray(color[0]) ? color[i] : color;
      this.colors.push(c[0], c[1], c[2]);
      if (uvs) this.uvs.push(uvs[i][0], uvs[i][1]); else this.uvs.push(0, 0);
    });
    for (let i = 1; i < pts.length - 1; i++) this.indices.push(b, b + i, b + i + 1);
  }

  // Both windings, for thin things seen from either side (sails, flags, leaves).
  poly2(pts, color) { this.poly(pts, color); this.poly([...pts].reverse(), color); }

  // A box from its centre, half sizes and yaw.
  box(cx, cy, cz, hx, hy, hz, color, yaw = 0, topColor = null) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz),
      P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const t = topColor || color;
    this.poly([v[4], v[7], v[6], v[5]], t);   // top
    this.poly([v[0], v[1], v[2], v[3]], color); // bottom
    this.poly([v[3], v[2], v[6], v[7]], color); // +z
    this.poly([v[1], v[0], v[4], v[5]], color); // -z
    this.poly([v[2], v[1], v[5], v[6]], color); // +x
    this.poly([v[0], v[3], v[7], v[4]], color); // -x
  }

  // A frustum/cone/cylinder along y: n sides, radii r0 (bottom) and r1 (top).
  frustum(cx, cy, cz, r0, r1, h, n, color, topColor = null, yaw = 0) {
    const ring = (r, y) => Array.from({ length: n }, (_, k) => {
      const a = yaw + (k / n) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    });
    const lo = ring(r0, cy), hi = ring(r1, cy + h);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      if (r1 > 0.0001) this.poly([lo[k], hi[k], hi[k1], lo[k1]], color);
      else this.poly([lo[k], [cx, cy + h, cz], lo[k1]], color);
    }
    if (r1 > 0.0001) this.poly([...hi].reverse(), topColor || color);
    this.poly(lo, color);
  }

  // A rough boulder: a jittered octahedron-ish blob.
  rock(cx, cy, cz, r, color, rnd) {
    const ring = 6, pts = [];
    const top = [cx, cy + r * (0.7 + rnd() * 0.4), cz];
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2 + rnd() * 0.4;
      const rr = r * (0.75 + rnd() * 0.45);
      pts.push([cx + Math.cos(a) * rr, cy + r * (rnd() * 0.2), cz + Math.sin(a) * rr]);
    }
    const bot = [cx, cy - r * 0.6, cz];
    for (let k = 0; k < ring; k++) {
      const a = pts[k], b = pts[(k + 1) % ring];
      const sh = 0.85 + rnd() * 0.3;
      const c = [color[0] * sh, color[1] * sh, color[2] * sh];
      this.poly([a, top, b], c);
      this.poly([b, bot, a], [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7]);
    }
  }

  build(extra = {}) {
    return {
      positions: new Float32Array(this.positions), normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors), uvs: new Float32Array(this.uvs), indices: new Uint32Array(this.indices), ...extra,
    };
  }
}

// ------------------------------------------------------------------ water

// The rivers' and lake's surface on the terrain grid; the sea is a plane.
// uv: along each river v = s / 6 (flowWater shifts texels toward higher v, so
// the ripples run downstream), u = lateral / 6; on the lake, world xz / 9.
export function waterMesh(world) {
  const { n, cell, water, nearest, seeds, rivers } = world;
  const vid = new Int32Array(n * n).fill(-1);
  const pos = [], col = [], uv = [], idx = [];
  const isInland = (c) => !Number.isNaN(water[c]) && !(water[c] <= 0.01 && seeds.level[nearest[c]] <= 0.7);
  const vertex = (i, j) => {
    const c = j * n + i;
    if (vid[c] >= 0) return vid[c];
    // A dry vertex takes the highest neighbouring water level, so the sheet
    // runs a little under the bank instead of dropping to the bed.
    let w = water[c];
    if (!isInland(c)) {
      w = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const cc = jj * n + ii;
        if (isInland(cc)) w = Math.max(w, water[cc]);
      }
    }
    const x = i * cell, z = j * cell, k = nearest[c];
    let u, v, r = 0.16, g = 0.36, b = 0.42;
    if (seeds.river[k] >= 0) {
      const p = rivers[seeds.river[k]].samples[seeds.index[k]];
      const lat = (x - p.x) * -p.tz + (z - p.z) * p.tx;
      u = lat / 6; v = p.s / 6;
      const white = clamp((p.cls - 1.5) / 3.5, 0, 1) * 0.85;
      const speed = flowSpeed(p);
      r = lerp(0.15, 0.82, white); g = lerp(0.34 + speed * 0.015, 0.88, white); b = lerp(0.38, 0.9, white);
    } else { u = x / 9; v = z / 9; r = 0.12; g = 0.3; b = 0.4; }
    vid[c] = pos.length / 3;
    pos.push(x, w + 0.02, z); col.push(r, g, b); uv.push(u, v);
    return vid[c];
  };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const c = j * n + i;
    if (!(isInland(c) || isInland(c + 1) || isInland(c + n) || isInland(c + n + 1))) continue;
    const a = vertex(i, j), b = vertex(i + 1, j), cc = vertex(i + 1, j + 1), d = vertex(i, j + 1);
    // Up-facing: counter-clockwise seen from above (+y) in x-right, z-down maps to a, d, cc, b.
    idx.push(a, d, cc, a, cc, b);
  }
  const N = pos.length / 3, nrm = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) nrm[i * 3 + 1] = 1;
  return { positions: new Float32Array(pos), normals: nrm, colors: new Float32Array(col), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

export function seaMesh(world) {
  const S = world.size, E = S * 2.5;
  const pos = new Float32Array([-E, 0, -E, S + E, 0, -E, S + E, 0, S + E, -E, 0, S + E]);
  return {
    positions: pos, normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([0.1, 0.27, 0.38, 0.1, 0.27, 0.38, 0.1, 0.27, 0.38, 0.1, 0.27, 0.38]),
    uvs: new Float32Array([-E / 12, -E / 12, (S + E) / 12, -E / 12, (S + E) / 12, (S + E) / 12, -E / 12, (S + E) / 12]),
    indices: new Uint32Array([0, 3, 2, 0, 2, 1]),
  };
}

// A tileable ripple texture; shifting its rows each frame makes water flow.
export function rippleTexture(size = 64, seed = 3) {
  const t = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Tile by sampling noise on a torus.
    const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
    const nx = Math.cos(a) * 1.3, ny = Math.sin(a) * 1.3, nz = Math.cos(b) * 1.3, nw = Math.sin(b) * 1.3;
    const v = fbm(nx * 2 + nz * 1.1 + 9, ny * 2 + nw * 1.7 + 9, seed, 4) * 0.5 + 0.5;
    const streak = Math.pow(Math.abs(Math.sin(b * 3 + fbm(nx * 3 + 3, nz * 3, seed + 1, 2) * 3)), 18);
    const k = 0.78 + v * 0.3 + streak * 0.35;
    const o = (y * size + x) * 4;
    t[o] = clamp(k * 255, 0, 255); t[o + 1] = clamp(k * 255, 0, 255); t[o + 2] = clamp(k * 250, 0, 255); t[o + 3] = 255;
  }
  return t;
}

// ------------------------------------------------------------------ vegetation

// Trees, chunked so no one mesh is huge. Returns [{mesh}, ...] and the list
// of trunks (for collisions and shadows of boats: none needed).
export function forestMeshes(world, density = 1, chunks = 4) {
  const { n, cell, size, heights, water, nearDist, seeds, nearest } = world;
  const rnd = mulberry32(world.seed * 31 + 7);
  const builders = Array.from({ length: chunks * chunks }, () => new MeshBuilder());
  const step = 7 / Math.sqrt(density);
  let count = 0;
  const trees = [];
  for (let z = step; z < size - step; z += step) for (let x = step; x < size - step; x += step) {
    const jx = x + (rnd() - 0.5) * step * 0.9, jz = z + (rnd() - 0.5) * step * 0.9;
    const i = Math.round(jx / cell), j = Math.round(jz / cell), c = j * n + i;
    const h = heights[c];
    if (!Number.isNaN(water[c]) || h < 2.5 || h > 268) continue;
    const near = nearDist[c] - seeds.half[nearest[c]];
    if (near < 5) continue;
    const hx = heights[c + 1] - heights[c - 1], hz = heights[c + n] - heights[c - n];
    const slope = Math.hypot(hx, hz) / (2 * cell);
    if (slope > 0.75) continue;
    const dens = fbm(jx / 210, jz / 210, world.seed + 50, 4) + (h > 95 ? 0.3 : 0) - (h > 210 ? (h - 210) / 60 : 0);
    if (dens < 0.05 + rnd() * 0.25) continue;
    const b = builders[Math.min(chunks - 1, Math.floor(jx / size * chunks)) * chunks + Math.min(chunks - 1, Math.floor(jz / size * chunks))];
    const s = 0.75 + rnd() * 0.6;
    const conifer = h > 92 || rnd() < 0.18;
    const shade = 0.8 + rnd() * 0.35;
    b.frustum(jx, h - 0.3, jz, 0.28 * s, 0.2 * s, 2.2 * s, 5, [0.25 * shade, 0.17, 0.1]);
    if (conifer) {
      const g = [0.06 * shade, 0.2 * shade, 0.09 * shade];
      b.frustum(jx, h + 1.6 * s, jz, 2.3 * s, 0, 4.2 * s, 6, g, null, rnd());
      b.frustum(jx, h + 4.0 * s, jz, 1.7 * s, 0, 3.6 * s, 6, [g[0] * 1.1, g[1] * 1.12, g[2] * 1.1], null, rnd());
    } else {
      const g = [0.17 * shade, 0.36 * shade, 0.1 * shade];
      b.frustum(jx, h + 1.7 * s, jz, 1.6 * s, 2.3 * s, 1.5 * s, 7, g, [g[0] * 1.15, g[1] * 1.15, g[2]], rnd());
      b.frustum(jx, h + 3.2 * s, jz, 2.3 * s, 0.9 * s, 1.6 * s, 7, [g[0] * 1.2, g[1] * 1.2, g[2] * 1.1], null, rnd());
    }
    trees.push({ x: jx, z: jz, r: 0.45 * s });
    count++;
  }
  return { meshes: builders.filter((b) => b.nv > 0).map((b) => b.build()), count, trees };
}

// Boulders on the banks and in rapids (features come from sim/rapids.js).
export function rockMeshes(world, features) {
  const rnd = mulberry32(world.seed * 13 + 1);
  const b = new MeshBuilder();
  for (const f of features) {
    if (f.kind !== "rock") continue;
    b.rock(f.x, f.y - 0.3, f.z, f.r, [0.42, 0.4, 0.37], rnd);
  }
  // Bank boulders along rapids.
  for (const r of world.rivers) for (const p of r.samples) {
    if (p.cls < 3 || rnd() > 0.18) continue;
    const side = rnd() < 0.5 ? -1 : 1, off = p.width / 2 + 0.5 + rnd() * 2.5;
    const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
    b.rock(x, p.level + 0.2, z, 0.8 + rnd() * 1.8, [0.4, 0.38, 0.35], rnd);
  }
  return b.build();
}

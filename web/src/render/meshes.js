// Mesh builders: water, trees, rocks, boats and buildings, as plain arrays the
// bridge uploads. Flat-shaded low-poly: faces don't share vertices.
import { fbm, clamp, lerp, smoothstep } from "../world/noise.js";
import { mulberry32 } from "../world/rng.js";
import { flowSpeed } from "../world/rivers.js";
import { heightAt, waterAt } from "../world/terrain.js";

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

  // Both windings with an up-facing normal: grass and reeds lit like the
  // ground they grow from, not dark on the side away from the sun.
  // Both sides share the three vertices (the normal is the same).
  blade(pts, color) {
    const b = this.nv;
    for (const p of pts) { this.positions.push(p[0], p[1], p[2]); this.normals.push(0, 1, 0); this.colors.push(color[0], color[1], color[2]); this.uvs.push(0, 0); }
    this.indices.push(b, b + 1, b + 2, b, b + 2, b + 1);
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

  // A lathed solid along y: profile [[radius, height], ...] from the bottom up,
  // n sides, one colour per band. Only the outside and the bottom are drawn.
  lathe(cx, cy, cz, profile, n, colors, yaw = 0, bottom = true) {
    const rings = profile.map(([r, h]) => Array.from({ length: n }, (_, k) => {
      const a = yaw + (k / n) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + h, cz + Math.sin(a) * r];
    }));
    for (let q = 0; q < profile.length - 1; q++) {
      const lo = rings[q], hi = rings[q + 1], col = colors[Math.min(q, colors.length - 1)];
      const apex = profile[q + 1][0] < 0.0001;
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (apex) this.poly([lo[k], [cx, cy + profile[q + 1][1], cz], lo[k1]], col);
        else this.poly([lo[k], hi[k], hi[k1], lo[k1]], col);
      }
    }
    if (bottom && profile[0][0] > 0.0001) this.poly(rings[0], colors[0]);
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
  const { n, cell, water, nearest, seeds, rivers, heights } = world;
  const vid = new Int32Array(n * n).fill(-1);
  const pos = [], col = [], uv = [], idx = [], calm = [], rough = [];
  const isInland = (c) => !Number.isNaN(water[c]) && !(water[c] <= 0.01 && seeds.level[nearest[c]] <= 0.7);
  const vertex = (i, j) => {
    const c = j * n + i;
    if (vid[c] >= 0) return vid[c];
    // A dry vertex takes the highest neighbouring water level, so the sheet
    // runs a little under the bank instead of dropping to the bed.
    let w = water[c];
    if (!isInland(c)) {
      // A dry vertex follows its own nearest water level, kept within its wet
      // neighbours' range. (Taking the highest neighbour, as 0.1.0 did, built
      // a stepped shelf along the banks of steep rapids on coarse worlds.)
      let lo = Infinity, hi = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const cc = jj * n + ii;
        if (isInland(cc)) { lo = Math.min(lo, water[cc]); hi = Math.max(hi, water[cc]); }
      }
      const own = nearest[c] >= 0 ? seeds.level[nearest[c]] : hi;
      w = Math.min(hi, Math.max(lo, own));
      // Then tuck it under the bank, so the sheet meets the ground along the
      // real shoreline instead of ending in a visible lip.
      w = Math.min(w, heights[c] - 0.45);
    }
    const x = i * cell, z = j * cell, k = nearest[c];
    let u, v, r, g, b;
    // Colour from depth: shallow water over the bed reads lighter and
    // greener, the channel deep blue-green; dry edge vertices (the sheet
    // tucked under the bank) are the wet shoreline.
    const depth = w - heights[c];
    const shallow = 1 - smoothstep(0.2, 3.2, depth);
    const ripple = fbm(x / 7, z / 7, world.seed + 71, 2);
    if (seeds.river[k] >= 0) {
      const p = rivers[seeds.river[k]].samples[seeds.index[k]];
      const lat = (x - p.x) * -p.tz + (z - p.z) * p.tx;
      // v from the vertex's own distance along the river (the sample's s plus
      // its offset along the tangent): with the sample's s alone, vertices
      // sharing a nearest sample got the same v and the texture stretched.
      const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
      u = lat / 6; v = (p.s + along) / 6;
      const speed = flowSpeed(p);
      r = 0.1; g = 0.27 + speed * 0.02; b = 0.33;
      r = lerp(r, 0.3, shallow * 0.75); g = lerp(g, 0.46, shallow * 0.75); b = lerp(b, 0.38, shallow * 0.75);
      // Whitewater: broken into streaks and boils, whitest mid-channel at
      // the steep end, with foam lines along the banks of fast water.
      const rough = clamp((p.cls - 1.5) / 3.5, 0, 1);
      const edge = Math.abs(lat) / Math.max(1, p.width / 2);
      const streak = fbm(p.s / 12, lat / 4.5, world.seed + 13, 3) * 0.5 + 0.5;
      let white = rough * clamp(-0.15 + streak * 1.5 - edge * 0.15, 0, 1);
      // Class III and up is drawn with the foam texture: keep it near white
      // so the texture's streaks carry the look.
      if (p.cls >= 3) white = Math.max(white, 0.72 + 0.1 * (p.cls - 3));
      if (p.cls >= 2) white = Math.max(white, smoothstep(0.7, 1.05, edge) * clamp(0.25 + rough, 0, 0.8));
      white = Math.max(white, (1 - smoothstep(-0.4, 0.1, depth)) * 0.22 * (0.6 + ripple * 0.4));
      r = lerp(r, 0.86, white); g = lerp(g, 0.92, white); b = lerp(b, 0.93, white);
    } else {
      u = x / 9; v = z / 9;
      r = lerp(0.08, 0.26, shallow); g = lerp(0.25, 0.44, shallow); b = lerp(0.36, 0.42, shallow);
      const lap = (1 - smoothstep(-0.3, 0.35, depth)) * 0.45;
      r = lerp(r, 0.8, lap); g = lerp(g, 0.88, lap); b = lerp(b, 0.9, lap);
    }
    // The ripple texture averages about 0.8, so lift the base to match.
    const tw = (1 + ripple * 0.06) * 1.2; r = Math.min(1, r * tw); g = Math.min(1, g * tw); b = Math.min(1, b * tw);
    // Edge vertices (tucked under the bank) take the wet ground's colour, so
    // the sheet fades into the bank instead of ending in a hard, jagged rim.
    if (!isInland(c) && world.colors) {
      const gc = world.colors, f = 0.8;
      r = lerp(r, gc[c * 3] * 0.85, f); g = lerp(g, gc[c * 3 + 1] * 0.85, f); b = lerp(b, gc[c * 3 + 2] * 0.9, f);
    }
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
    const k = nearest[c], ri = k >= 0 ? seeds.river[k] : -1;
    (ri >= 0 && rivers[ri].samples[seeds.index[k]].cls >= 3 ? rough : calm).push(a, d, cc, a, cc, b);
  }
  const N = pos.length / 3, nrm = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) nrm[i * 3 + 1] = 1;
  // indices: all of it; calm and rough split it for the two water textures.
  return { positions: new Float32Array(pos), normals: nrm, colors: new Float32Array(col), uvs: new Float32Array(uv), indices: new Uint32Array(idx),
    calm: new Uint32Array(calm), rough: new Uint32Array(rough) };
}

// The highest the terrain tile can be at (x, z) whichever way the engine
// splits each cell into triangles, so a strip laid on it never sinks in.
function groundTop(world, x, z) {
  const { n, cell, heights } = world;
  const gx = clamp(x / cell, 0, n - 1.001), gz = clamp(z / cell, 0, n - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = heights[j * n + i], b = heights[j * n + i + 1], c = heights[(j + 1) * n + i], d = heights[(j + 1) * n + i + 1];
  const s1 = u > v ? a + (b - a) * u + (d - b) * v : a + (c - a) * v + (d - c) * u;          // split a-d
  const s2 = u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);   // split b-c
  return Math.max(s1, s2);
}

// The shoreline: a narrow strip along each river bank, built per river
// sample (every 3 m) rather than on the 3 to 6 m terrain grid. Its inner
// edge lies on the water as a foam line, its middle rides just over the
// ground as wet bank, and its outer edge dips under the terrain, so the
// grid's saw-toothed water edge is hidden behind a smooth curve. Lit and
// opaque; about 10 vertices per sample and side.
export function shoreMesh(world) {
  const pos = [], col = [], idx = [], nrm = [];
  const reach = Math.max(3, world.cell * 1.25);          // past the water mesh's widest dry vertex
  const lats = [-0.9, 0, 0.35, 0.7, 1];                   // inner (on the water, metres) .. outer (under the ground), as fractions of reach
  for (const r of world.rivers) {
    const S = r.samples;
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i < S.length; i++) {
        const p = S[i], half = p.width / 2;
        const at = (k) => { const L = half + (k < 0 ? k : k * reach); return [p.x - p.tz * L * side, p.z + p.tx * L * side]; };
        // Skip where the bank is more water (a confluence, the lake, the delta).
        const [ox, oz] = at(1);
        const wet = !Number.isNaN(waterAt(world, ox, oz));
        if (wet) { prev = null; continue; }
        const rough = clamp((p.cls - 1.5) / 3.5, 0, 1);
        const ring = lats.map((k, q) => {
          const [x, z] = at(k), g = q > 0 && q < lats.length - 1 ? groundTop(world, x, z) : heightAt(world, x, z);
          // Lie on the ground with the ground's own slope (normal and colour),
          // so only the wet margin and the foam line show.
          const y = q === 0 ? p.level + 0.06 : q === lats.length - 1 ? g - 0.25 : Math.max(p.level + 0.06, g + 0.12);
          const ci = clamp(Math.round(z / world.cell), 0, world.n - 1) * world.n + clamp(Math.round(x / world.cell), 0, world.n - 1), gc = world.colors;
          const ground = gc ? [gc[ci * 3], gc[ci * 3 + 1], gc[ci * 3 + 2]] : [0.3, 0.27, 0.18];
          const wetG = [ground[0] * 0.7, ground[1] * 0.7, ground[2] * 0.74];
          const lace = [lerp(wetG[0] * 1.3, 0.8, rough), lerp(wetG[1] * 1.3 + 0.04, 0.86, rough), lerp(wetG[2] * 1.3 + 0.05, 0.87, rough)];
          const c = q === 0 ? lace : q === 1 ? wetG : q === 2 ? [lerp(wetG[0], ground[0], 0.6), lerp(wetG[1], ground[1], 0.6), lerp(wetG[2], ground[2], 0.6)] : ground;
          let n = [0, 1, 0];
          if (q > 0) {
            const d = 1.5, hx = heightAt(world, x + d, z) - heightAt(world, x - d, z), hz = heightAt(world, x, z + d) - heightAt(world, x, z - d);
            const l = Math.hypot(hx, 2 * d, hz); n = [-hx / l, 2 * d / l, -hz / l];
          }
          const v = pos.length / 3;
          pos.push(x, y, z); col.push(Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])); nrm.push(n[0], n[1], n[2]);
          return v;
        });
        if (prev) for (let q = 0; q < ring.length - 1; q++) {
          const a = prev[q], b = prev[q + 1], c = ring[q + 1], d = ring[q];
          // Up-facing whichever bank this is.
          if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
        }
        prev = ring;
      }
    }
  }
  const N = pos.length / 3;
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), uvs: new Float32Array(N * 2), indices: new Uint32Array(idx) };
}

// The sea: a grid over the world and a band around it, coloured by depth
// (surf on the beach, turquoise over sand, deep blue offshore), then four
// wide skirts out to the horizon.
export function seaMesh(world) {
  const S = world.size, E = S * 2.5, G = 24, m = Math.round(S / G), B = 16, M = B * S / m;
  const pos = [], col = [], uv = [], idx = [];
  const deep = [0.08, 0.26, 0.4];
  const depthAt = (x, z) => {
    const cx = clamp(x, 0, S), cz = clamp(z, 0, S);
    return -heightAt(world, cx, cz) + Math.hypot(x - cx, z - cz) * 0.12;
  };
  const colourAt = (x, z, d) => {
    const shallow = 1 - smoothstep(0.5, 9, d), mid = 1 - smoothstep(6, 28, d);
    let c = [lerp(deep[0], 0.1, mid), lerp(deep[1], 0.33, mid), lerp(deep[2], 0.4, mid)];
    c = [lerp(c[0], 0.24, shallow), lerp(c[1], 0.52, shallow), lerp(c[2], 0.5, shallow)];
    const n = fbm(x / 11, z / 11, world.seed + 31, 2);
    const surf = (1 - smoothstep(0.1, 1.8 + n * 0.8, d)) * 0.85;
    return [lerp(c[0], 0.88, surf) * 1.2, lerp(c[1], 0.93, surf) * 1.2, lerp(c[2], 0.94, surf) * 1.07].map((v) => Math.min(1, v));
  };
  const W = m + 2 * B + 1, vid = new Int32Array(W * W).fill(-1), dep = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) dep[j * W + i] = depthAt((i - B) * G, (j - B) * G);
  const vert = (i, j) => {
    const q = j * W + i;
    if (vid[q] >= 0) return vid[q];
    const x = (i - B) * G, z = (j - B) * G;
    vid[q] = pos.length / 3;
    pos.push(x, 0, z); col.push(...colourAt(x, z, Math.max(0, dep[q]))); uv.push(x / 12, z / 12);
    return vid[q];
  };
  for (let j = 0; j < W - 1; j++) for (let i = 0; i < W - 1; i++) {
    const q = j * W + i;
    if (Math.max(dep[q], dep[q + 1], dep[q + W], dep[q + W + 1]) < -1.5) continue;   // all land
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
    idx.push(a, d, c, a, c, b);
  }
  const quad = (x0, z0, x1, z1) => {
    const b = pos.length / 3;
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { pos.push(x, 0, z); col.push(...deep); uv.push(x / 12, z / 12); }
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  };
  quad(-E, -E, S + E, -M); quad(-E, S + M, S + E, S + E); quad(-E, -M, -M, S + M); quad(S + M, -M, S + E, S + M);
  const N = pos.length / 3, nrm = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) nrm[i * 3 + 1] = 1;
  return { positions: new Float32Array(pos), normals: nrm, colors: new Float32Array(col), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

// Tileable noise on a torus: rx and ry set how busy it is across u and
// along v (rx > ry makes streaks that run with the flow).
function torus(x, y, size, rx, ry, seed, oct = 4) {
  const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
  return fbm(Math.cos(a) * rx + Math.cos(b) * ry * 0.7 + 9, Math.sin(a) * rx + Math.sin(b) * ry + 9, seed, oct) * 0.5 + 0.5
    + (fbm(Math.cos(b) * ry + 3, Math.sin(b) * ry + Math.cos(a) * rx * 0.5 + 3, seed + 7, 2) - 0) * 0.15;
}

// Calm water: soft ripples, flow lines running downstream, and sparse sun
// glints. Rows shift each frame (flowWater) so it all moves with the river.
export function rippleTexture(size = 64, seed = 3) {
  const t = new Uint8Array(size * size * 4);
  const rnd = mulberry32(seed * 7 + 5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = torus(x, y, size, 2.6, 2.6, seed);
    const lines = Math.pow(torus(x, y, size, 5.5, 0.8, seed + 21, 3), 6) * 1.6;
    let k = 0.7 + v * 0.3 + lines * 0.35;
    const o = (y * size + x) * 4;
    let r = k, g = k, bl = k * 0.98;
    if (rnd() < 0.012) { r = g = bl = 1.6; }   // a glint
    t[o] = clamp(r * 190, 0, 255); t[o + 1] = clamp(g * 190, 0, 255); t[o + 2] = clamp(bl * 192, 0, 255); t[o + 3] = 255;
  }
  return t;
}

// Whitewater: long foam streaks with green-blue water showing between them,
// and boils of white. Used on class III+ water with a near-white base colour.
export function foamTexture(size = 64, seed = 3) {
  const t = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Streaks at two scales, only a little stretched with the flow, and boils.
    const streak = torus(x, y, size, 3.4, 1.8, seed + 40, 4);
    const fine = torus(x, y, size, 6.5, 4.5, seed + 47, 2);
    const boil = torus(x, y, size, 2.2, 2.2, seed + 55, 3);
    const f = clamp(smoothstep(0.42, 0.72, streak * 0.7 + fine * 0.35) * 0.8 + smoothstep(0.6, 0.8, boil) * 0.6, 0, 1);
    const water = [0.22, 0.41, 0.43], foam = [1, 1, 1];
    const o = (y * size + x) * 4;
    for (let q = 0; q < 3; q++) t[o + q] = clamp(lerp(water[q], foam[q], f) * 255, 0, 255);
    t[o + 3] = 255;
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
    if (slope > 0.75) {
      // Steep ground: now and then a grey outcrop instead of a tree.
      if (rnd() < 0.12) {
        const bb = builders[Math.min(chunks - 1, Math.floor(jx / size * chunks)) * chunks + Math.min(chunks - 1, Math.floor(jz / size * chunks))];
        const g = 0.46 + rnd() * 0.12;
        const r = 2 + rnd() * 2.5;
        bb.rock(jx, h - r * 0.45, jz, r, [g, g * 0.96, g * 0.9], rnd);
      }
      continue;
    }
    const dens = fbm(jx / 210, jz / 210, world.seed + 50, 4) + (h > 95 ? 0.3 : 0) - (h > 210 ? (h - 210) / 60 : 0);
    const b = builders[Math.min(chunks - 1, Math.floor(jx / size * chunks)) * chunks + Math.min(chunks - 1, Math.floor(jz / size * chunks))];
    if (dens < 0.05 + rnd() * 0.25) continue;
    const sr = rnd(), s = 0.62 + sr * sr * 1.05;           // mostly middling, a few big old trees
    const conifer = h > 92 || rnd() < 0.18;
    const shade = 0.8 + rnd() * 0.35, hue = rnd() * 2 - 1;  // hue: -1 blue-green .. +1 yellow-green
    const tint = (c) => [Math.min(0.75, c[0] * (1 + hue * 0.25)), Math.min(0.75, c[1] * (1 + hue * 0.05)), c[2] * (1 - hue * 0.3)];
    const kind = conifer ? 0 : rnd();
    const birch = !conifer && kind < 0.18, autumn = !conifer && kind > 0.965;
    const trunkH = (conifer ? 2.2 : 1.8 + rnd() * 1.2) * s;
    // Vertex budget per tree (memory): at most today's 114 (broadleaf) / 78 (fir) on average.
    b.lathe(jx, h - 0.3, jz, [[0.28 * s, 0], [0.2 * s, trunkH + 0.3]], 5, [birch ? [0.82, 0.8, 0.74] : [0.25 * shade, 0.17, 0.1]], 0, false);   // 20 vertices
    if (conifer) {
      // Firs: two to four tiers, some slim and tall, some broad.
      const g = tint([0.06 * shade, 0.2 * shade, 0.09 * shade]), tiers = 2 + (rnd() < 0.35 ? 1 : 0), slim = 0.7 + rnd() * 0.45;
      const H = (5.6 + rnd() * 2.5) * s, yaw = rnd();
      for (let q = 0; q < tiers; q++) {
        const f = q / tiers, r = (2.4 - f * 1.5) * s * slim, y0 = h + 1.4 * s + f * H * 0.78;
        const lift = 1 + q * 0.07;
        b.frustum(jx, y0, jz, r, 0, H * (0.55 - f * 0.12), 6, [g[0] * lift, g[1] * lift, g[2] * lift], null, yaw + q * 0.5);
      }
    } else {
      const g = tint(autumn ? [0.62 * shade, 0.32 * shade, 0.06] : birch ? [0.3 * shade, 0.48 * shade, 0.12 * shade] : [0.15 * shade, 0.34 * shade, 0.09 * shade]);
      const w = (birch ? 0.72 : 0.85 + rnd() * 0.35), tall = 0.8 + rnd() * 0.5, y0 = h + trunkH - 0.2 * s;
      // A rounded crown, darker underneath and lighter on top; proportions vary.
      b.lathe(jx, y0, jz, [[1.3 * s * w, 0], [2.2 * s * w, 1.2 * s * tall], [1.5 * s * w, 2.4 * s * tall], [0, 3.2 * s * tall]], 6,
        [[g[0] * 0.8, g[1] * 0.8, g[2] * 0.8], g, [g[0] * 1.25, g[1] * 1.23, g[2] * 1.08]], rnd());   // 72 vertices
      // Big broadleaf trees get a second, offset lobe so the crown is lumpy.
      if (s > 1.3 && !birch) {
        const a = rnd() * 6.28, ox = jx + Math.cos(a) * 1.3 * s, oz = jz + Math.sin(a) * 1.3 * s;
        b.lathe(ox, y0 + 0.9 * s, oz, [[0.9 * s, 0], [1.5 * s, 0.8 * s], [0, 1.9 * s]], 6,
          [[g[0] * 0.95, g[1] * 0.95, g[2] * 0.95], [g[0] * 1.25, g[1] * 1.23, g[2] * 1.08]], a);   // 48 vertices, one tree in five
      }
    }
    trees.push({ x: jx, z: jz, r: 0.45 * s });
    count++;
  }
  return { meshes: builders.filter((b) => b.nv > 0).map((b) => b.build()), count, trees };
}

// Ground cover near the water, where the chase camera sees it: grass tufts
// tinted from the ground under them, wild flowers in the meadows, reeds on
// slow banks and pebbles on gravel bars. Chunked like the forest.
export function groundCover(world, density = 1, chunks = 4) {
  const { n, cell, size, heights, water, colors, nearDist, seeds, nearest, rivers } = world;
  const rnd = mulberry32(world.seed * 17 + 3);
  const builders = Array.from({ length: chunks * chunks }, () => new MeshBuilder());
  const step = 3.2 / Math.sqrt(density);
  const FLOWERS = [[0.95, 0.85, 0.2], [0.95, 0.95, 0.92], [0.7, 0.45, 0.9], [0.95, 0.4, 0.35]];
  let count = 0;
  for (let z = step; z < size - step; z += step) for (let x = step; x < size - step; x += step) {
    const jx = x + (rnd() - 0.5) * step, jz = z + (rnd() - 0.5) * step;
    const i = Math.round(jx / cell), j = Math.round(jz / cell);
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
    const c = j * n + i, k = nearest[c];
    if (k < 0 || !Number.isNaN(water[c])) continue;
    const near = nearDist[c] - seeds.half[k];
    if (near < 0.8 || near > 75) continue;
    const h = heightAt(world, jx, jz);
    if (h > 190 || h < 1.5) continue;
    const slope = Math.hypot(heights[c + 1] - heights[c - 1], heights[c + n] - heights[c - n]) / (2 * cell);
    if (slope > 0.7) continue;
    const patch = fbm(jx / 18, jz / 18, world.seed + 61, 2);
    if (patch < -0.3 + near / 110 - rnd() * 0.3) continue;
    const b = builders[Math.min(chunks - 1, Math.floor(jx / size * chunks)) * chunks + Math.min(chunks - 1, Math.floor(jz / size * chunks))];
    const ri = seeds.river[k], cls = ri >= 0 ? rivers[ri].samples[seeds.index[k]].cls : 0;
    const gc = [colors[c * 3], colors[c * 3 + 1], colors[c * 3 + 2]];
    const yaw = rnd() * Math.PI * 2;
    if (near < 3.5 && cls >= 2) {
      // Pebbles on a gravel bar.
      for (let q = 0; q < 3; q++) { const r = 0.12 + rnd() * 0.2, g = 0.42 + rnd() * 0.2; b.rock(jx + (rnd() - 0.5) * 1.5, h, jz + (rnd() - 0.5) * 1.5, r, [g, g * 0.97, g * 0.92], rnd); }
    } else if (near < 4 && cls <= 1) {
      // Reeds: tall, thin, upright.
      for (let q = 0; q < 5; q++) {
        const a = yaw + q * 1.3, ox = jx + Math.cos(a) * 0.35 * rnd(), oz = jz + Math.sin(a) * 0.35 * rnd(), H = 1.1 + rnd() * 0.9;
        const w = 0.05, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        b.blade([[ox - px, h - 0.1, oz - pz], [ox + px, h - 0.1, oz + pz], [ox + Math.cos(a) * 0.15, h + H, oz + Math.sin(a) * 0.15]], [0.3 + rnd() * 0.1, 0.38 + rnd() * 0.08, 0.14]);
      }
      if (rnd() < 0.3) b.box(jx, h + 1.4, jz, 0.05, 0.14, 0.05, [0.35, 0.22, 0.12]);   // a bulrush head
    } else {
      // A tuft: three blades leaning out, a little lighter than the ground.
      const sh = 1.05 + rnd() * 0.3, col = [Math.min(1, gc[0] * sh + 0.02), Math.min(1, gc[1] * sh + 0.03), Math.min(1, gc[2] * sh)];
      const H = 0.45 + rnd() * 0.45;
      for (let q = 0; q < 3; q++) {
        const a = yaw + q * 2.1, w = 0.22, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        b.blade([[jx - px, h - 0.05, jz - pz], [jx + px, h - 0.05, jz + pz], [jx + Math.cos(a) * 0.35, h + H, jz + Math.sin(a) * 0.35]], col);
      }
      if (h < 120 && rnd() < 0.22) {
        // Wild flowers: a few heads on the tuft.
        const fc = FLOWERS[Math.floor(rnd() * FLOWERS.length)];
        for (let q = 0; q < 3; q++) {
          const fx = jx + (rnd() - 0.5) * 0.9, fz = jz + (rnd() - 0.5) * 0.9, fy = h + 0.35 + rnd() * 0.3;
          b.blade([[fx - 0.09, fy, fz], [fx + 0.09, fy, fz + 0.02], [fx, fy + 0.14, fz - 0.03]], fc);
        }
      }
    }
    count++;
  }
  return { meshes: builders.filter((b) => b.nv > 0).map((b) => b.build()), count };
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

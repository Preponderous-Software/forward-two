// Low-poly boats in their own space: x forward (bow at +x), y up, z to
// starboard. Hulls are lofted from cross-sections (curved, tapered, with
// gunwales and a few fittings); the crew are seated people (helmet, head,
// PFD, arms) whose torsos and paddles are separate meshes so they can paddle.
// BoatRig owns a boat's meshes and poses them every frame; the pose maths
// lives in crew.js.
import { MeshBuilder } from "./meshes.js";
import { MESH_TRANSLUCENT } from "./bridge.js";
import { BOATS } from "../sim/boat.js";
import {
  CREW, OARLOCK, OAR, READY, STROKE_SECONDS, seatAction, bladeAt, idleBlade, crewPose, approach, turnLean, waterMotion,
  sprayLevel, wakePoints, AutoStroker, swimPose, downstream, SWIM_TILT, mat, mul, apply, invRigid, bodyMatrix, paddleMatrix, oarMatrix,
} from "./crew.js";

const DARK = [0.08, 0.08, 0.1], WOOD = [0.58, 0.4, 0.22], CREAM = [0.92, 0.9, 0.84], ROPE = [0.2, 0.2, 0.22];
const scale = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Who's in the boat: PFD, shirt, helmet and skin, so a crew reads as people.
export const LOOKS = [
  { pfd: [0.95, 0.45, 0.08], shirt: [0.18, 0.28, 0.45], helmet: [0.96, 0.84, 0.14], skin: [0.86, 0.64, 0.5], shorts: [0.2, 0.22, 0.28] },
  { pfd: [0.1, 0.5, 0.92], shirt: [0.86, 0.86, 0.8], helmet: [0.92, 0.2, 0.15], skin: [0.55, 0.38, 0.27], shorts: [0.25, 0.3, 0.25] },
  { pfd: [0.2, 0.74, 0.35], shirt: [0.34, 0.22, 0.38], helmet: [0.95, 0.95, 0.95], skin: [0.95, 0.76, 0.62], shorts: [0.18, 0.18, 0.2] },
  { pfd: [0.98, 0.8, 0.1], shirt: [0.62, 0.2, 0.2], helmet: [0.15, 0.55, 0.88], skin: [0.72, 0.5, 0.36], shorts: [0.3, 0.26, 0.2] },
  { pfd: [0.86, 0.12, 0.15], shirt: [0.26, 0.3, 0.22], helmet: [0.22, 0.22, 0.25], skin: [0.8, 0.58, 0.42], shorts: [0.2, 0.2, 0.24] },
];

// ------------------------------------------------------------------ geometry

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A triangle turned to face along `hint` (outward); degenerate ones dropped.
function tri(b, p, q, r, col, hint) {
  const n = cross(sub(q, p), sub(r, p));
  if (dot(n, n) < 1e-12) return;
  if (dot(n, hint) < 0) b.poly([p, r, q], col); else b.poly([p, q, r], col);
}
function quad(b, p0, p1, p2, p3, col, hint) { tri(b, p0, p1, p2, col, hint); tri(b, p0, p2, p3, col, hint); }
// Faces outward from a centre point.
function quadC(b, p0, p1, p2, p3, col, c) {
  const m = [(p0[0] + p1[0] + p2[0] + p3[0]) / 4, (p0[1] + p1[1] + p2[1] + p3[1]) / 4, (p0[2] + p1[2] + p2[2] + p3[2]) / 4];
  quad(b, p0, p1, p2, p3, col, sub(m, c));
}

// A tube from a to c: n sides, radii r0 -> r1, capped.
function limb(b, a, c, r0, r1, n, col) {
  const d = sub(c, a), L = Math.hypot(...d) || 1, u = d.map((v) => v / L);
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1 = cross(u, ref); const l1 = Math.hypot(...e1); e1 = e1.map((v) => v / l1);
  const e2 = cross(u, e1);
  const ring = (p, r) => Array.from({ length: n }, (_, k) => {
    const t = (k / n) * Math.PI * 2 + Math.PI / n, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    return [p[0] + e1[0] * cs + e2[0] * sn, p[1] + e1[1] * cs + e2[1] * sn, p[2] + e1[2] * cs + e2[2] * sn];
  });
  const A = ring(a, r0), C = ring(c, r1), mid = lerp3(a, c, 0.5);
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; quadC(b, A[k], A[k1], C[k1], C[k], col, mid); }
  for (let k = 1; k < n - 1; k++) { tri(b, A[0], A[k], A[k + 1], col, sub(a, c)); tri(b, C[0], C[k], C[k + 1], col, d); }
}

// A tube along a path of points (closed or open), n sides, radius r.
function pipe(b, path, r, n, col, closed, colAt = null) {
  const m = path.length, rings = [];
  for (let i = 0; i < m; i++) {
    const p = path[i], prev = path[closed ? (i - 1 + m) % m : Math.max(0, i - 1)], next = path[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
    let t = sub(next, prev); const lt = Math.hypot(...t) || 1; t = t.map((v) => v / lt);
    let e1 = cross(t, [0, 1, 0]); const l1 = Math.hypot(...e1) || 1; e1 = e1.map((v) => v / l1);
    const e2 = cross(e1, t);
    rings.push(Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2, cs = Math.cos(a) * r, sn = Math.sin(a) * r;
      return [p[0] + e1[0] * cs + e2[0] * sn, p[1] + e1[1] * cs + e2[1] * sn, p[2] + e1[2] * cs + e2[2] * sn];
    }));
  }
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i++) {
    const A = rings[i], B = rings[(i + 1) % m], c = lerp3(path[i], path[(i + 1) % m], 0.5);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      quadC(b, A[k], A[k1], B[k1], B[k], colAt ? colAt(k, i) : col, c);
    }
  }
  if (!closed) for (const [R, P, Q] of [[rings[0], path[0], path[1]], [rings[m - 1], path[m - 1], path[m - 2]]]) {
    for (let k = 1; k < n - 1; k++) tri(b, R[0], R[k], R[k + 1], col, sub(P, Q));
  }
}

// An ellipsoid (or its top half): seg around, rings top to bottom.
function blob(b, c, rx, ry, rz, col, seg = 6, rings = 4, half = false) {
  const pt = (i, k) => {
    const v = (i / rings) * (half ? Math.PI / 2 : Math.PI), a = (k / seg) * Math.PI * 2;
    return [c[0] + Math.sin(v) * Math.cos(a) * rx, c[1] + Math.cos(v) * ry, c[2] + Math.sin(v) * Math.sin(a) * rz];
  };
  for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) {
    const k1 = (k + 1) % seg;
    quadC(b, pt(i, k), pt(i, k1), pt(i + 1, k1), pt(i + 1, k), col, c);
  }
  if (half) for (let k = 1; k < seg - 1; k++) tri(b, pt(rings, 0), pt(rings, k), pt(rings, k + 1), col, [0, -1, 0]);
}

// An elliptical frustum along y.
function prism(b, cx, cz, y0, y1, rx0, rz0, rx1, rz1, n, col, top = null) {
  const ring = (y, rx, rz) => Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2 + Math.PI / n; return [cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz]; });
  const A = ring(y0, rx0, rz0), B = ring(y1, rx1, rz1), c = [cx, (y0 + y1) / 2, cz];
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; quadC(b, A[k], A[k1], B[k1], B[k], col, c); }
  for (let k = 1; k < n - 1; k++) { tri(b, A[0], A[k], A[k + 1], col, [0, -1, 0]); tri(b, B[0], B[k], B[k + 1], top || col, [0, 1, 0]); }
}

// Append mesh m (from a builder's build()) moved by matrix M.
function merge(b, m, M) {
  const base = b.nv;
  for (let i = 0; i < m.positions.length; i += 3) {
    const p = apply(M, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
    const n = m.normals, nx = M[0] * n[i] + M[4] * n[i + 1] + M[8] * n[i + 2], ny = M[1] * n[i] + M[5] * n[i + 1] + M[9] * n[i + 2], nz = M[2] * n[i] + M[6] * n[i + 1] + M[10] * n[i + 2];
    b.positions.push(...p); b.normals.push(nx, ny, nz);
    b.colors.push(m.colors[i], m.colors[i + 1], m.colors[i + 2]); b.uvs.push(0, 0);
  }
  for (const i of m.indices) b.indices.push(base + i);
}

// ------------------------------------------------------------------ hulls

// A hull lofted along x. Sections run gunwale -> keel as [zFrac, depthFrac].
//   L half length, B half beam, g0 gunwale height amidships, sheer/sheerAft
//   rise to the ends, k0 keel amidships, rocker its rise, transom (dory) the
//   stern's half width as a fraction of B.
export function hullShape(o) {
  const w = (u) => {
    const a = Math.abs(u);
    const fine = o.B * Math.pow(Math.max(0, 1 - Math.pow(a, u > 0 ? o.bowP || 2.2 : o.sternP || 2.2)), 0.62);
    return u < 0 && o.transom ? Math.max(fine, o.B * o.transom * Math.min(1, a * 1.4)) : fine;
  };
  const g = (u) => o.g0 + (u > 0 ? o.sheer : o.sheerAft ?? o.sheer) * Math.pow(Math.abs(u), 2.6);
  const k = (u) => Math.min(o.k0 + o.rocker * Math.pow(Math.abs(u), 2.2), g(u) - (o.stem ?? 0.12));
  return { w, g, k, at: (x) => Math.max(-1, Math.min(1, x / o.L)) };
}

function loft(b, o) {
  const S = hullShape(o), n = o.n || 12, prof = o.prof;
  const us = Array.from({ length: n + 1 }, (_, i) => -Math.cos(Math.PI * i / n));
  const sec = us.map((u) => {
    const w = S.w(u), g = S.g(u), k = S.k(u), x = u * o.L;
    return prof.map(([zf, yf]) => [x, g - yf * (g - k), zf * w]);
  });
  const J = prof.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < J - 1; j++) for (const s of [1, -1]) {
    const P = (ii, jj) => { const p = sec[ii][jj]; return [p[0], p[1], p[2] * s]; };
    const mid = [(sec[i][0][0] + sec[i + 1][0][0]) / 2, (S.g(us[i]) + S.k(us[i])) / 2 + 0.05, 0];
    const col = o.band ? o.band(j, J) : o.col;
    quadC(b, P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), col, mid);
    if (o.inside) {
      const I = (ii, jj) => { const p = P(ii, jj); return [p[0], p[1] + 0.025, p[2] * 0.93]; };
      const c = mid, q = [I(i, j), I(i + 1, j), I(i + 1, j + 1), I(i, j + 1)];
      const m = q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
      quad(b, ...q, o.inside, sub(c, m));
    }
  }
  // A transom closes a cut-off stern.
  if (o.transom) {
    const s0 = sec[0], poly = [...s0.map((p) => [p[0], p[1], p[2]]), ...s0.slice().reverse().map((p) => [p[0], p[1], -p[2]])];
    for (let k = 1; k < poly.length - 1; k++) tri(b, poly[0], poly[k], poly[k + 1], o.transomCol || o.col, [-1, 0, 0]);
  }
  // Gunwale rails: a cap and an outer lip along the sheer line.
  if (o.rail) for (let i = 0; i < n; i++) for (const s of [1, -1]) {
    const a = sec[i][0], c = sec[i + 1][0];
    const o0 = [a[0], a[1] + 0.025, (a[2] + 0.025) * s], o1 = [c[0], c[1] + 0.025, (c[2] + 0.025) * s];
    const i0 = [a[0], a[1] + 0.025, (a[2] * 0.93 - 0.01) * s], i1 = [c[0], c[1] + 0.025, (c[2] * 0.93 - 0.01) * s];
    if (a[2] + c[2] < 0.02) continue;
    quad(b, o0, o1, i1, i0, o.rail, [0, 1, 0]);
    quad(b, o0, o1, [o1[0], o1[1] - 0.07, o1[2]], [o0[0], o0[1] - 0.07, o0[2]], o.rail, [0, 0, s]);
  }
  // A deck (kayak): a crowned skin from gunwale to gunwale.
  if (o.deck) for (let i = 0; i < n; i++) {
    const a = sec[i][0], c = sec[i + 1][0];
    const ra = [a[0], a[1] + a[2] * o.crown, 0], rc = [c[0], c[1] + c[2] * o.crown, 0];
    for (const s of [1, -1]) quad(b, [a[0], a[1], a[2] * s], [c[0], c[1], c[2] * s], rc, ra, o.deck, [0, 1, 0.3 * s]);
  }
  return S;
}

// Something across the boat at x (a thwart or seat): spans the inside beam.
function across(b, S, o, x, y, hx, hy, col, inset = 0.9) {
  const u = S.at(x), hz = S.w(u) * inset;
  b.box(x, y, 0, hx, hy, hz, col);
}

function raftHull(b, c) {
  const r = 0.26, R = 0.74, straight = 1.1, kick = 0.24;
  const path = [];
  const yAt = (x) => 0.05 + kick * Math.pow(Math.max(0, (Math.abs(x) - straight) / R), 2);
  for (let k = 0; k <= 4; k++) { const x = -straight + (2 * straight * k) / 4; path.push([x, yAt(x), R]); }
  for (let k = 1; k < 8; k++) { const a = Math.PI / 2 - (k / 8) * Math.PI; const x = straight + Math.cos(a) * R; path.push([x, yAt(x), Math.sin(a) * R]); }
  for (let k = 0; k <= 4; k++) { const x = straight - (2 * straight * k) / 4; path.push([x, yAt(x), -R]); }
  for (let k = 1; k < 8; k++) { const a = -Math.PI / 2 - (k / 8) * Math.PI; const x = -straight + Math.cos(a) * R; path.push([x, yAt(x), Math.sin(a) * R]); }
  const rub = scale(c, 0.55);
  // The two lowest faces are a darker rub strip.
  pipe(b, path, r, 8, c, true, (k) => (k === 5 || k === 6 ? rub : c));
  // Perimeter grab line just above the tube's waist, outside.
  const line = path.map((p) => {
    const cx = Math.max(-straight, Math.min(straight, p[0])), dx = p[0] - cx, l = Math.hypot(dx, p[2]) || 1, k = (R + r * 0.97) / l;
    return [cx + dx * k, p[1] + 0.1, p[2] * k];
  });
  pipe(b, line, 0.022, 4, ROPE, true);
  // Floor, thwarts, a cooler for the guide and a dry bag.
  const floor = path.map((p) => [p[0] * 0.92, -0.14, p[2] * 0.8]);
  for (let k = 1; k < floor.length - 1; k++) tri(b, floor[0], floor[k], floor[k + 1], [0.16, 0.17, 0.2], [0, 1, 0]);
  // Its underside, seen when the raft is upside down.
  const under = floor.map((p) => [p[0], p[1] - 0.03, p[2]]);
  for (let k = 1; k < under.length - 1; k++) tri(b, under[0], under[k], under[k + 1], [0.1, 0.1, 0.12], [0, -1, 0]);
  pipe(b, [[0.42, 0.04, -R], [0.42, 0.04, R]], 0.17, 7, scale(c, 0.85), false);
  pipe(b, [[-0.78, 0.04, -R], [-0.78, 0.04, R]], 0.17, 7, scale(c, 0.85), false);
  b.box(-1.42, 0.16, 0.38, 0.22, 0.2, 0.26, [0.9, 0.9, 0.88], 0, [0.75, 0.75, 0.75]);
  blob(b, [-1.12, 0.06, -0.28], 0.28, 0.17, 0.2, [0.95, 0.75, 0.1], 6, 3);
  limb(b, [-1.12, 0.22, -0.28], [-1.12, 0.3, -0.28], 0.05, 0.03, 4, DARK);
}

function kayakHull(b, c) {
  const S = loft(b, {
    L: 1.8, B: 0.33, g0: 0.12, sheer: 0.08, sheerAft: 0.05, k0: -0.2, rocker: 0.14, stem: 0.06, n: 12,
    prof: [[1, 0], [0.97, 0.35], [0.78, 0.75], [0.4, 0.96], [0, 1]], col: c,
    band: (j) => (j === 3 ? scale(c, 0.78) : c), deck: scale(c, 1.1), crown: 0.42,
  });
  // Cockpit: a coaming ring with the spray deck stretched over it.
  const cx = -0.15, ax = 0.42, az = 0.25, N = 12;
  const deckY = (x, z) => { const u = S.at(x), w = S.w(u); return S.g(u) + (w - Math.abs(z)) * 0.42; };
  const lo = [], hi = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, x = cx + Math.cos(a) * ax, z = Math.sin(a) * az;
    const y = deckY(x, z);
    lo.push([x, y - 0.01, z]); hi.push([x, y + 0.05, z]);
  }
  for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; quadC(b, lo[k], lo[k1], hi[k1], hi[k], [0.12, 0.12, 0.14], [cx, 0.1, 0]); }
  const top = Math.max(...hi.map((p) => p[1])) + 0.005;
  const skirt = hi.map((p) => [p[0], top - (top - p[1]) * 0.5, p[2]]);
  for (let k = 1; k < N - 1; k++) tri(b, skirt[0], skirt[k], skirt[k + 1], DARK, [0, 1, 0]);
  // Bungees on the fore and aft decks, grab toggles at the ends.
  for (const [x0, x1] of [[0.45, 1.15], [-0.75, -1.25]]) {
    for (const s of [1, -1]) {
      const z0 = S.w(S.at(x0)) * 0.55 * s, z1 = S.w(S.at(x1)) * 0.45 * s;
      limb(b, [x0, deckY(x0, z0) + 0.012, z0], [x1, deckY(x1, z1) + 0.012, z1], 0.012, 0.012, 3, ROPE);
    }
    const xm = (x0 + x1) / 2, zm = S.w(S.at(xm)) * 0.5;
    limb(b, [xm, deckY(xm, -zm) + 0.012, -zm], [xm, deckY(xm, zm) + 0.012, zm], 0.012, 0.012, 3, ROPE);
  }
  for (const x of [1.78, -1.78]) limb(b, [x, S.g(S.at(x)) - 0.02, -0.06], [x, S.g(S.at(x)) - 0.02, 0.06], 0.02, 0.02, 4, DARK);
}

function canoeHull(b, c) {
  const S = loft(b, {
    L: 2.5, B: 0.46, g0: 0.26, sheer: 0.3, k0: -0.24, rocker: 0.24, stem: 0.1, n: 14,
    prof: [[1, 0], [0.99, 0.3], [0.9, 0.65], [0.6, 0.92], [0, 1]], col: c,
    band: (j) => (j === 0 ? scale(c, 1.15) : j === 3 ? scale(c, 0.82) : c),
    inside: scale(c, 0.72), rail: WOOD,
  });
  // Seats, a centre thwart, deck plates at the ends and a load.
  across(b, S, {}, 1.62, S.g(S.at(1.62)) - 0.1, 0.12, 0.02, [0.74, 0.6, 0.36]);
  across(b, S, {}, -1.62, S.g(S.at(-1.62)) - 0.1, 0.12, 0.02, [0.74, 0.6, 0.36]);
  across(b, S, {}, 0.1, S.g(S.at(0.1)) - 0.01, 0.04, 0.025, WOOD, 0.95);
  for (const s of [1, -1]) {
    const x0 = s * 2.12, x1 = s * 2.5, u = S.at(x0), w = S.w(u) * 0.96, y0 = S.g(u) + 0.02, y1 = S.g(S.at(x1)) + 0.02;
    tri(b, [x0, y0, -w], [x0, y0, w], [x1, y1, 0], WOOD, [0, 1, 0]);
  }
  blob(b, [-0.35, 0.02, 0], 0.32, 0.2, 0.25, [0.9, 0.42, 0.12], 6, 3);       // dry bag
  b.box(0.55, -0.02, 0, 0.18, 0.16, 0.2, [0.3, 0.42, 0.3], 0, [0.36, 0.5, 0.36]); // pack
  limb(b, [0.55, 0.15, -0.2], [0.55, 0.15, 0.2], 0.015, 0.015, 3, DARK);
}

function doryHull(b, c) {
  const S = loft(b, {
    L: 2.8, B: 0.86, g0: 0.42, sheer: 0.58, sheerAft: 0.38, k0: -0.12, rocker: 0.42, stem: 0.18, n: 14, bowP: 2.0, sternP: 2.6, transom: 0.34,
    prof: [[1, 0], [0.8, 0.7], [0.64, 1], [0, 1]], col: c,
    band: (j) => (j === 0 ? c : j === 1 ? scale(c, 0.8) : [0.16, 0.17, 0.2]), inside: CREAM, rail: WOOD, transomCol: scale(c, 0.85),
  });
  // Decked bow and stern hatches, the rower's seat, thwarts and oarlocks.
  for (const [u0, u1] of [[0.6, 0.96], [-0.56, -1]]) {
    const pts = [];
    const M = 6;
    for (let k = 0; k <= M; k++) { const u = u0 + (u1 - u0) * k / M; pts.push([u * 2.8, S.g(u) - 0.03, S.w(u) * 0.95]); }
    for (let k = 0; k < M; k++) quad(b, pts[k], pts[k + 1], [pts[k + 1][0], pts[k + 1][1], -pts[k + 1][2]], [pts[k][0], pts[k][1], -pts[k][2]], CREAM, [0, 1, 0]);
    const ux = u0 * 2.8, y = S.g(u0) - 0.03, w = S.w(u0) * 0.95;
    b.box(ux, y - 0.15, 0, 0.02, 0.15, w, scale(CREAM, 0.9));
    b.box(ux + Math.sign(u0) * 0.35, y + 0.01, 0, 0.2, 0.012, w * 0.45, scale(c, 0.9));   // hatch lid
  }
  across(b, S, {}, -0.08, 0.2, 0.16, 0.04, WOOD);
  across(b, S, {}, 1.3, 0.22, 0.12, 0.03, WOOD);
  across(b, S, {}, -1.3, 0.22, 0.12, 0.03, WOOD);
  for (const s of [1, -1]) {
    const z = OARLOCK.z * s, y = S.g(S.at(OARLOCK.x));
    limb(b, [OARLOCK.x, y, z], [OARLOCK.x, OARLOCK.y + 0.03, z], 0.025, 0.02, 4, [0.6, 0.6, 0.62]);
  }
  b.box(2.75, S.g(1) - 0.05, 0, 0.05, 0.12, 0.04, WOOD);   // stem post
}

// ------------------------------------------------------------------ people

// Where a seated paddler's hands rest, in the torso's frame (the pose at READY).
function restPose(seat) {
  const act = seatAction(seat, null);
  return crewPose(seat, act, idleBlade(seat));
}

// Arms are built for a mid-stroke pose, so the elbows stay close to the
// forearms (which ride the paddle) through the whole stroke.
function handsAt(seat) {
  const pose = seat.type === "rider" ? restPose(seat) : crewPose(seat, seatAction(seat, "forward"), { sweep: 0.2, dip: 0.6 });
  if (seat.type === "single") {
    const P = paddleMatrix(pose);
    return { pose, P, top: apply(P, [0, -0.04, 0]), low: apply(P, [0, -0.52, 0]) };
  }
  if (seat.type === "double") {
    const P = paddleMatrix(pose);
    return { pose, P, l: apply(P, [0, 0, -0.32]), r: apply(P, [0, 0, 0.32]) };
  }
  if (seat.type === "oars") {
    const toBody = invRigid(bodyMatrix(seat, pose));
    const hand = (side) => apply(toBody, apply(oarMatrix(pose.oars[side < 0 ? "port" : "starboard"]), [0, 0, -side * (OAR.inboard - 0.06)]));
    return { pose, l: hand(-1), r: hand(1) };
  }
  return { pose, l: [0.3, 0.06, -0.15], r: [0.3, 0.06, 0.15] };
}

const SHOULDER = (s) => [0.0, 0.47, 0.17 * s];
const elbowFor = (sh, hand, s) => { const m = lerp3(sh, hand, 0.5); return [m[0] - 0.04, m[1] - 0.1, m[2] + 0.07 * s]; };

// A paddler from the hips up, facing +x, origin at the hips. arms: which
// forearms this mesh carries ("both", "left", "right" or "none"; the rest
// ride on the paddle so the hands stay on it).
export function bodyMesh(look, hands, forearms = "both") {
  const b = new MeshBuilder();
  const { pfd, shirt, helmet, skin } = look;
  prism(b, 0, 0, 0.0, 0.5, 0.12, 0.16, 0.12, 0.19, 6, shirt);                     // torso
  prism(b, 0.005, 0, 0.16, 0.48, 0.15, 0.2, 0.14, 0.215, 6, pfd);                 // PFD
  prism(b, 0, 0, 0.47, 0.53, 0.1, 0.13, 0.08, 0.1, 6, scale(pfd, 0.6));            // collar
  b.box(0.145, 0.25, 0, 0.012, 0.012, 0.16, DARK);                                 // waist strap
  prism(b, 0.01, 0, 0.5, 0.59, 0.05, 0.05, 0.045, 0.045, 5, skin);                 // neck
  blob(b, [0.02, 0.68, 0], 0.095, 0.11, 0.09, skin, 6, 4);                         // head
  blob(b, [0.0, 0.7, 0], 0.115, 0.1, 0.11, helmet, 6, 2, true);                    // helmet shell
  b.box(0.1, 0.705, 0, 0.035, 0.012, 0.08, helmet);                                // brim
  b.box(0.105, 0.665, 0, 0.012, 0.016, 0.065, DARK);                               // sunglasses
  for (const s of [-1, 1]) {
    const sh = SHOULDER(s), hand = s < 0 ? hands.l || hands.top : hands.r || hands.low;
    if (!hand) continue;
    const el = elbowFor(sh, hand, s);
    limb(b, sh, el, 0.05, 0.042, 4, shirt);                                        // upper arm
    if (forearms === "both" || (forearms === "left" && s < 0) || (forearms === "right" && s > 0)) {
      limb(b, el, hand, 0.04, 0.035, 4, shirt);
      blob(b, hand, 0.042, 0.042, 0.042, skin, 4, 2);
    }
  }
  return b.build();
}

// Hips and legs for a seat, in the seat's frame (baked into the hull mesh).
function legs(b, seat, look) {
  if (seat.type === "double") return;                // under the kayak's deck
  const sh = look.shorts, boot = [0.12, 0.1, 0.09];
  b.box(0, 0.02, 0, 0.12, 0.07, 0.16, sh);
  for (const s of [-1, 1]) {
    const hip = [0.04, 0.0, 0.1 * s];
    if (seat.kneel) {
      const knee = [0.32, -0.26, 0.16 * s], foot = [-0.15, -0.3, 0.12 * s];
      limb(b, hip, knee, 0.065, 0.055, 4, sh); limb(b, knee, foot, 0.05, 0.045, 4, sh);
      b.box(foot[0], foot[1], foot[2], 0.08, 0.035, 0.045, boot);
      continue;
    }
    const inward = seat.z ? -Math.sign(seat.z) * 0.12 : 0;
    const knee = [0.4, 0.08, 0.12 * s + inward], foot = [0.5, -(seat.drop ?? 0.36), 0.13 * s + inward * 1.6];
    limb(b, hip, knee, 0.065, 0.055, 4, sh); limb(b, knee, foot, 0.05, 0.045, 4, sh);
    b.box(foot[0] + 0.05, foot[1], foot[2], 0.09, 0.035, 0.045, boot);
  }
}

// ------------------------------------------------------------------ paddles

const SHAFT = [0.2, 0.2, 0.22], BLADE = [0.95, 0.95, 0.92];

// A blade in the plane spanned by `along` and `wide` axes, from `a` for len.
function blade(b, a, along, wide, len, width, col) {
  const P = (t, w) => [a[0] + along[0] * t + wide[0] * w, a[1] + along[1] * t + wide[1] * w, a[2] + along[2] * t + wide[2] * w];
  const outline = [P(0, -width * 0.25), P(len * 0.25, -width * 0.5), P(len * 0.92, -width * 0.48), P(len, -width * 0.2), P(len, width * 0.2), P(len * 0.92, width * 0.48), P(len * 0.25, width * 0.5), P(0, width * 0.25)];
  b.poly2(outline, col);
  limb(b, P(0, 0), P(len * 0.85, 0), 0.02, 0.012, 3, scale(col, 0.75));          // spine
}

// A single-bladed paddle, grip at the origin, shaft down -y, blade face
// across x. carries: the lower hand's forearm (from the elbow, given in the
// paddle's frame) so the hand stays on the shaft.
export function singlePaddleMesh(len = 1.4, look = null, elbow = null, bladeCol = BLADE) {
  const b = new MeshBuilder();
  b.box(0, 0.02, 0, 0.025, 0.025, 0.07, DARK);                                    // T-grip
  limb(b, [0, 0, 0], [0, -len + 0.42, 0], 0.018, 0.018, 5, SHAFT);
  blade(b, [0, -len + 0.45, 0], [0, -1, 0], [0, 0, 1], 0.45, 0.2, bladeCol);
  if (look) {
    const top = [0, -0.04, 0], hand = [0, -0.52, 0];
    blob(b, top, 0.042, 0.042, 0.042, look.skin, 4, 2);
    blob(b, hand, 0.042, 0.042, 0.042, look.skin, 4, 2);
    if (elbow?.low) limb(b, elbow.low, hand, 0.04, 0.035, 4, look.shirt);
    if (elbow?.top) limb(b, elbow.top, top, 0.04, 0.035, 4, look.shirt);
  }
  return b.build();
}

// A kayak paddle along z, centred between the hands.
export function doublePaddleMesh(look = null, elbows = null, bladeCol = [0.95, 0.72, 0.12]) {
  const b = new MeshBuilder();
  limb(b, [0, 0, -0.85], [0, 0, 0.85], 0.017, 0.017, 5, SHAFT);
  for (const s of [-1, 1]) blade(b, [0, 0, 0.82 * s], [0, 0, s], [0, 1, 0], 0.46, 0.18, bladeCol);
  if (look) for (const s of [-1, 1]) {
    const hand = [0, 0, 0.32 * s];
    blob(b, hand, 0.042, 0.042, 0.042, look.skin, 4, 2);
    if (elbows) limb(b, elbows[s < 0 ? 0 : 1], hand, 0.04, 0.035, 4, look.shirt);
  }
  return b.build();
}

// One oar for side s, pivot at the oarlock, along +z*s.
export function oarMesh(s, look = null, elbow = null) {
  const b = new MeshBuilder();
  limb(b, [0, 0, -s * OAR.inboard], [0, 0, s * (OAR.outboard - 0.75)], 0.024, 0.02, 5, WOOD);
  limb(b, [0, 0, -s * OAR.inboard], [0, 0, -s * (OAR.inboard - 0.18)], 0.03, 0.03, 5, DARK);  // handle grip
  blade(b, [0, 0, s * (OAR.outboard - 0.8)], [0, 0, s], [0, 1, 0], 0.8, 0.17, CREAM);
  b.box(0, 0, s * 0.02, 0.035, 0.035, 0.06, ROPE);                                   // leather at the lock
  if (look) {
    const hand = [0, 0, -s * (OAR.inboard - 0.06)];
    blob(b, hand, 0.042, 0.042, 0.042, look.skin, 4, 2);
    if (elbow) limb(b, elbow, hand, 0.04, 0.035, 4, look.shirt);
  }
  return b.build();
}

// ------------------------------------------------------------------ crew parts

// Everything a seat needs: its body mesh (torso up) and its paddle meshes,
// with the forearms split so hands stay on the paddle as it moves.
function crewParts(seat, kind) {
  const look = LOOKS[seat.look % LOOKS.length];
  const h = handsAt(seat);
  const pose = h.pose;
  if (seat.type === "rider") return { look, body: bodyMesh(look, h, "both"), paddles: [] };
  if (seat.type === "single") {
    // Both forearms ride the paddle; the upper arms stay on the torso.
    const s = seat.side, topIsLeft = s > 0;
    const hands = topIsLeft ? { l: h.top, r: h.low } : { l: h.low, r: h.top };
    const body = bodyMesh(look, hands, "none");
    const inv = invRigid(h.P);
    const elbow = (side) => apply(inv, elbowFor(SHOULDER(side), side < 0 ? hands.l : hands.r, side));
    const col = seat.guide ? [0.2, 0.2, 0.22] : kind === "canoe" ? [0.7, 0.5, 0.28] : BLADE;
    const elbows = topIsLeft ? { top: elbow(-1), low: elbow(1) } : { top: elbow(1), low: elbow(-1) };
    return { look, body, paddles: [{ kind: "single", mesh: singlePaddleMesh(seat.len, look, elbows, col), side: s }] };
  }
  if (seat.type === "double") {
    const body = bodyMesh(look, h, "none");
    const inv = invRigid(h.P);
    const elbows = [-1, 1].map((s) => apply(inv, elbowFor(SHOULDER(s), s < 0 ? h.l : h.r, s)));
    return { look, body, paddles: [{ kind: "double", mesh: doublePaddleMesh(look, elbows) }] };
  }
  // Oars: forearms ride the oars.
  const body = bodyMesh(look, h, "none");
  const B = bodyMatrix(seat, pose);
  const paddles = [-1, 1].map((s) => {
    const elbowBoat = apply(B, elbowFor(SHOULDER(s), s < 0 ? h.l : h.r, s));
    const O = oarMatrix(pose.oars[s < 0 ? "port" : "starboard"]);
    return { kind: "oar", side: s, mesh: oarMesh(s, look, apply(invRigid(O), elbowBoat)) };
  });
  return { look, body, paddles };
}

// The hull with any static parts (legs, and with bakeCrew the torsos too).
function hullMesh(kind, colour, crew = null) {
  const b = new MeshBuilder();
  const c = colour;
  if (kind === "raft") raftHull(b, c);
  else if (kind === "kayak") kayakHull(b, c);
  else if (kind === "canoe") canoeHull(b, c);
  else doryHull(b, c);
  for (const seat of CREW[kind] || []) {
    const look = LOOKS[seat.look % LOOKS.length];
    const lb = new MeshBuilder(); legs(lb, seat, look);
    merge(b, lb.build(), mat(seat.x, seat.y, seat.z));
  }
  if (crew) for (const { seat, parts, rest } of crew) merge(b, parts.body, rest);
  return b.build();
}

// A whole boat in one mesh at rest (hull, crew and paddles). kind "walker" is
// a person on foot.
export function boatMesh(kind, colour) {
  if (kind === "walker") return personMesh(colour);
  const seats = CREW[kind] || CREW.raft;
  const crew = seats.map((seat) => ({ seat, parts: crewParts(seat, kind), rest: bodyMatrix(seat, restPose(seat)) }));
  const b = new MeshBuilder();
  merge(b, hullMesh(CREW[kind] ? kind : "raft", colour, crew), mat());
  for (const { seat, parts, rest } of crew) {
    const pose = restPose(seat);
    for (const p of parts.paddles) merge(b, p.mesh, p.kind === "oar" ? oarMatrix(pose.oars[p.side < 0 ? "port" : "starboard"]) : mul(rest, paddleMatrix(pose)));
  }
  return b.build();
}

// ------------------------------------------------------------------ swimmer

// A swimmer without arms, origin at the water surface over the hips, feet
// toward +x (downstream): lying back, PFD and helmet up out of the water.
export function swimmerMesh(look) {
  const b = new MeshBuilder();
  merge(b, bodyMesh(look, {}, "none"), mat(0, -0.22, 0, 0, SWIM_TILT, 0));
  b.box(0.02, -0.22, 0, 0.1, 0.07, 0.15, look.shorts);
  for (const s of [-1, 1]) {
    const hip = [0.04, -0.22, 0.1 * s], knee = [0.46, -0.16, 0.13 * s], foot = [0.86, -0.02, 0.15 * s];
    limb(b, hip, knee, 0.065, 0.055, 4, look.shorts); limb(b, knee, foot, 0.05, 0.045, 4, look.shorts);
    b.box(foot[0] + 0.02, foot[1] + 0.05, foot[2], 0.04, 0.08, 0.045, [0.12, 0.1, 0.09]);   // toes up
  }
  return b.build();
}

// One sculling arm from the shoulder, out to side s at the surface.
export function swimArmMesh(look, s) {
  const b = new MeshBuilder();
  const el = [0.06, -0.06, 0.27 * s], hand = [0.16, -0.12, 0.5 * s];
  limb(b, [0, 0, 0], el, 0.05, 0.042, 4, look.shirt);
  limb(b, el, hand, 0.04, 0.035, 4, look.shirt);
  blob(b, hand, 0.042, 0.03, 0.05, look.skin, 4, 2);
  return b.build();
}

// ------------------------------------------------------------------ on foot

// A person standing, origin at the feet, facing +x. withLegs=false leaves the
// legs out (the local walker swings its own leg meshes).
export function personMesh(colour, withLegs = true) {
  const look = { ...LOOKS[0], pfd: colour };
  const b = new MeshBuilder();
  if (withLegs) for (const s of [-1, 1]) merge(b, legMesh(), mat(0, 0.92, 0.1 * s));
  b.box(0, 0.88, 0, 0.11, 0.08, 0.17, look.shorts);
  const hands = { l: [0.04, -0.02, -0.24], r: [0.04, -0.02, 0.24] };
  merge(b, bodyMesh(look, hands, "both"), mat(0, 0.92, 0));
  b.box(-0.21, 1.25, 0, 0.07, 0.2, 0.16, [0.25, 0.25, 0.3]);                     // a small pack
  return b.build();
}

export function legMesh() {
  const b = new MeshBuilder(), pants = LOOKS[0].shorts;
  limb(b, [0, 0, 0], [0.02, -0.45, 0], 0.07, 0.06, 5, pants);
  limb(b, [0.02, -0.45, 0], [0, -0.86, 0], 0.055, 0.045, 5, [0.78, 0.6, 0.48]);
  b.box(0.05, -0.88, 0, 0.13, 0.045, 0.06, [0.12, 0.1, 0.08]);                    // boot
  return b.build();
}

// Kept for anything that wants a lone paddle at its grip.
export function paddleMesh(kind) {
  return kind === "kayak" ? doublePaddleMesh() : singlePaddleMesh(1.4);
}

// ------------------------------------------------------------------ the rig

// Column-major model matrix: translate, yaw (forward = (cos h, 0, sin h)), pitch, roll, scale.
export function boatMatrix(x, y, z, heading, pitch = 0, roll = 0, s = 1, out = new Float32Array(16)) {
  mat(x, y, z, heading, pitch, roll, out);
  if (s !== 1) for (let i = 0; i < 12; i++) if (i % 4 !== 3) out[i] *= s;
  return out;
}

// Upside down, a hull floats on its gunwales with its bottom (and a raft's
// floor) riding above the water: the origin sits right at the water line.
export const FLIP_DROP = -0.15;

const DIM = (kind) => { const s = BOATS[kind] || BOATS.raft; return { L: s.len / 2, B: s.beam / 2 }; };

// A boat and its crew on the engine, posed per frame.
//   level "full": hull + a torso and paddle mesh per paddler (the player);
//   level "lite": hull with the crew baked in + one mesh of paddles that
//   sweeps as a group (other players and ghosts: two meshes a boat).
//   ghost: pale and translucent.
export class BoatRig {
  constructor(bridge, kind, colour, { level = "full", ghost = false, seed = 0 } = {}) {
    this.bridge = bridge; this.kind = kind; this.level = level; this.ghost = ghost; this.seed = seed;
    this.t = 0; this.alt = 0; this.lastStroke = null; this.heading = null; this.turnRate = 0;
    this.auto = new AutoStroker(STROKE_SECONDS[kind] || 0.7, seed);
    this.slots = []; this.parts = [];
    this.M = new Float32Array(16); this.tmp = new Float32Array(16); this.tmp2 = new Float32Array(16);
    this.tips = []; this.speed = 0; this.rough = 0; this.swim = false; this.shown = true; this.water = 0;
    const add = (m) => {
      if (ghost) { m.flags = MESH_TRANSLUCENT; m.color = [1, 1, 1, 0.42]; }
      const s = bridge.mesh(m);
      this.slots.push(s);
      return s;
    };
    if (kind === "walker" || !CREW[kind]) { this.hull = add(boatMesh(kind, colour)); this.seats = []; this.count = this.slots.length; return; }
    this.seats = CREW[kind];
    const crew = this.seats.map((seat) => ({ seat, parts: crewParts(seat, kind), rest: bodyMatrix(seat, restPose(seat)) }));
    this.cur = this.seats.map(() => ({ sweep: READY, dip: 0, prevDip: 0 }));
    if (level === "full") {
      this.hull = add(hullMesh(kind, colour));
      for (const { seat, parts } of crew) {
        this.parts.push({ seat, body: add(parts.body), paddles: parts.paddles.map((p) => ({ ...p, slot: add(p.mesh), mesh: null })) });
      }
      // The swimmer after a flip (hidden until then).
      const look = LOOKS[this.seats[0].look % LOOKS.length];
      this.swimmer = { body: add(swimmerMesh(look)), arms: [-1, 1].map((sd) => ({ s: sd, slot: add(swimArmMesh(look, sd)) })) };
      this.swimSlots = new Set([this.swimmer.body, ...this.swimmer.arms.map((a) => a.slot)]);
      for (const sl of this.swimSlots) bridge.visible(sl, false);
    } else {
      this.hull = add(hullMesh(kind, colour, crew));
      // Kayak: the one paddle keeps its full motion. Others: all paddles in one
      // mesh at rest, swept fore and aft as a group.
      if (kind === "kayak") {
        const { seat, parts } = crew[0];
        this.parts.push({ seat, body: null, rest: crew[0].rest, paddles: [{ ...parts.paddles[0], slot: add(parts.paddles[0].mesh), mesh: null }] });
      } else {
        const b = new MeshBuilder();
        for (const { seat, parts, rest } of crew) {
          const pose = restPose(seat);
          for (const p of parts.paddles) merge(b, p.mesh, p.kind === "oar" ? oarMatrix(pose.oars[p.side < 0 ? "port" : "starboard"]) : mul(rest, paddleMatrix(pose)));
        }
        this.group = add(b.build());
      }
    }
    this.count = this.slots.length;
  }

  setVisible(v) {
    this.shown = v;
    for (const s of this.slots) if (!this.swimSlots?.has(s)) this.bridge.visible(s, v);
    this.crewVisible(v && !this.swim);
  }

  // The crew in the boat, or (while swimming) the swimmer beside it.
  crewVisible(v) {
    for (const s of this.slots) {
      if (s === this.hull) continue;
      this.bridge.visible(s, this.swimSlots?.has(s) ? this.shown && !v && this.swim : v);
    }
  }

  dispose() { for (const s of this.slots) this.bridge.removeMesh(s); this.slots = []; }

  // o: a boat (x, y, z, heading, pitch?, roll?, spin?, vx, vz, swimming|swim,
  // stroke?, strokeT?, lastStroke?, current?). Without stroke fields the rig
  // paddles on its own from speed and turning.
  drive(o, dt) {
    const B = this.bridge, kind = this.kind;
    this.t += dt;
    const t = this.t, h = o.heading ?? o.h ?? 0;
    // Turn rate from the heading when the boat doesn't say.
    if (this.heading != null && dt > 0) {
      let d = h - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.turnRate = approach(this.turnRate, d / dt, 6, dt);
    }
    this.heading = h;
    const spin = o.spin ?? this.turnRate;
    const cur = o.current;
    const rvx = (o.vx || 0) - (cur?.vx || 0), rvz = (o.vz || 0) - (cur?.vz || 0);
    this.speed = Math.hypot(rvx, rvz) || 0;
    this.travel = Math.hypot(o.vx || 0, o.vz || 0);
    this.rough = cur ? Math.max(0, cur.cls - 1) : 0;
    const swim = !!(o.swimming ?? o.swim);
    if (swim !== this.swim) { this.swim = swim; if (this.shown) this.crewVisible(!swim); }
    // Which stroke is on.
    let stroke, strokeT;
    if ("strokeT" in o) {
      if (o.lastStroke !== this.lastStroke) { if (this.lastStroke != null && o.lastStroke >= 0) this.alt++; this.lastStroke = o.lastStroke; }
      stroke = o.stroke; strokeT = o.strokeT;
    } else {
      const a = this.auto.update(dt, this.speed || this.travel, spin);
      stroke = a.stroke; strokeT = a.strokeT; this.alt = a.count;
    }
    const secs = STROKE_SECONDS[kind] || 0.7;
    const live = stroke && strokeT < secs;
    // The boat: sim pitch/roll plus water motion, a lean into turns, squat with speed.
    const wm = waterMotion(t, this.rough, this.seed);
    const k = "pitch" in o ? 0.6 : 1;
    const pitch = (o.pitch || 0) + wm.pitch * k + Math.min(this.speed, 6) * 0.008;
    const roll = (o.roll || 0) + wm.roll * k + turnLean(spin, 0.08, 0.12) + (swim ? Math.PI : 0);
    this.water = o.y;
    mat(o.x, o.y + 0.15 + wm.heave + (swim ? FLIP_DROP : 0), o.z, h, pitch, roll, this.M);
    B.transform(this.hull, this.M);
    this.flat = mat(o.x, o.y, o.z, h, 0, 0, this.flat || new Float32Array(16));
    if (!this.seats.length) return;
    if (swim) { if (this.swimmer) this.drawSwimmer(o, h, t); return; }
    const lean = turnLean(spin);
    this.tips.length = 0;
    this.seats.forEach((seat, i) => {
      const act = live ? seatAction(seat, stroke, this.alt) : { ...seatAction(seat, stroke, this.alt), mode: "idle", port: "fwd", starboard: "fwd" };
      const want = act.mode === "idle" ? idleBlade(seat) : bladeAt(act.mode === "row" ? "fwd" : act.mode, strokeT, secs);
      const c = this.cur[i];
      c.prevDip = c.dip;
      c.sweep = approach(c.sweep, want.sweep, 22, dt);
      c.dip = approach(c.dip, want.dip, 20, dt);
      const pose = crewPose(seat, act, c, { rough: this.rough, lean, breathe: Math.sin(t * 1.5 + i * 1.3 + this.seed) });
      const part = this.level === "full" ? this.parts[i] : null;
      if (part) {
        const BM = mul(this.M, bodyMatrix(seat, pose, this.tmp), this.tmp2);
        B.transform(part.body, BM);
        for (const p of part.paddles) {
          const PM = p.kind === "oar" ? mul(this.M, oarMatrix(pose.oars[p.side < 0 ? "port" : "starboard"]), this.tmp) : mul(BM, paddleMatrix(pose), this.tmp);
          B.transform(p.slot, PM);
          this.tip(p, PM, pose, c, seat);
        }
      } else if (this.kind === "kayak" && this.parts[0]) {
        const p = this.parts[0].paddles[0];
        const PM = mul(mul(this.M, this.parts[0].rest, this.tmp2), paddleMatrix(pose), this.tmp);
        B.transform(p.slot, PM);
        this.tip(p, PM, pose, c, seat);
      } else if (i === 0 && this.group != null) {
        // The group sweeps with the first paddler's blade.
        const dx = (c.sweep - READY) * 0.28, dy = -c.dip * 0.16;
        B.transform(this.group, mul(this.M, mat(dx, dy, 0), this.tmp));
      }
    });
  }

  // The swimmer floats beside the upturned boat, feet downstream, sculling.
  drawSwimmer(o, h, t) {
    const B = this.bridge, sp = swimPose(t, this.rough);
    const side = apply(this.flat, [0, 0, -(DIM(this.kind).B + 0.7)]);
    const S = mat(side[0], o.y + sp.heave, side[2], downstream(o.current, h), sp.tilt - SWIM_TILT, sp.roll, this.tmp2);
    B.transform(this.swimmer.body, S);
    const body = mat(0, -0.22, 0, 0, SWIM_TILT, 0);
    for (const a of this.swimmer.arms) {
      const sh = apply(body, [0, 0.47, 0.17 * a.s]);
      B.transform(a.slot, mul(S, mat(sh[0], sh[1], sh[2], a.s * sp.scull, 0, 0), this.tmp));
    }
  }

  // Record where a blade tip is in the world, and whether it just went in.
  tip(p, PM, pose, c, seat) {
    let local;
    if (p.kind === "single") local = [0, -(seat.len || 1.4) + 0.12, 0];
    else if (p.kind === "double") local = [0, 0, 1.12 * (pose.side || 1)];
    else local = [0, 0, p.side * (OAR.outboard - 0.3)];
    const dip = p.kind === "oar" ? c.dip * (pose.oars && Math.abs(pose.oars[p.side < 0 ? "port" : "starboard"].dip) > 0.2 ? 1 : 0.3) : c.dip;
    this.tips.push({ at: apply(PM, local), dip, entered: c.prevDip < 0.5 && c.dip >= 0.5, sweep: c.sweep });
  }

  // Spray, bow wave, wake and paddle splashes into a Rows of points.
  fx(points, soft = 1) {
    if (!this.shown || !this.seats.length) return;
    const { L, B } = DIM(this.kind), lvl = sprayLevel(this.speed, this.rough), y = this.water + 0.06;
    if (this.swim) {
      // Foam slapping round the upturned hull.
      for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2, p = apply(this.flat, [Math.cos(a) * L * 0.95, 0, Math.sin(a) * B * 1.05]);
        points.push(p[0], y + Math.random() * 0.15, p[2], 4, 0.3, 0.92, 0.96, 1, 0.5, soft);
      }
      return;
    }
    const ga = this.ghost ? 0.4 : 1;
    if (lvl > 0.04) {
      for (const s of [-1, 1]) {
        const n = 1 + Math.floor(lvl * 3);
        for (let k = 0; k < n; k++) {
          const p = apply(this.M, [L * (0.82 - Math.random() * 0.25), 0, s * (B * 0.6 + Math.random() * 0.35 * lvl)]);
          points.push(p[0], y + Math.random() * 0.3 * lvl, p[2], 4 + lvl * 4, 0.2 + lvl * 0.4, 0.95, 0.97, 1, (0.3 + 0.45 * lvl) * ga, soft);
        }
      }
    }
    for (const w of wakePoints(this.t, this.travel, B, 8)) {
      for (const s of [-1, 1]) {
        const p = apply(this.flat, [-L * 0.9 - w.along, 0, s * w.out]);
        points.push(p[0], y - 0.03, p[2], 4, 0.45 + w.along * 0.09, 0.9, 0.95, 1, 0.38 * w.fade * ga, soft);
      }
    }
    for (const tp of this.tips) {
      const [x, , z] = tp.at;
      if (tp.entered) for (let k = 0; k < 5; k++) points.push(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.35, z + (Math.random() - 0.5) * 0.4, 4, 0.22, 0.92, 0.96, 1, 0.7 * ga, soft);
      else if (tp.dip > 0.6) points.push(x, y, z, 4, 0.35, 0.9, 0.95, 1, 0.45 * ga, soft);
      else if (tp.dip < 0.1 && tp.at[1] > y && Math.random() < 0.35) points.push(x, tp.at[1] - Math.random() * 0.3, z, 3, 0.06, 0.85, 0.92, 1, 0.6 * ga, soft);
    }
  }
}

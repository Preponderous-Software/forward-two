// Per-frame effects drawn as rows: stars after dusk, foam streaming down
// rapids, the boat's lantern. Cheap: a few hundred points and one light.
import { mulberry32 } from "../world/rng.js";
import { POINT_SOFT, TEX_MIPMAPS } from "./bridge.js";
import { rippleTexture, foamTexture } from "./meshes.js";

const lerp = (a, b, t) => a + (b - a) * t;

let STARS = null;
function stars() {
  if (STARS) return STARS;
  const rnd = mulberry32(2026), out = [];
  for (let k = 0; k < 260; k++) {
    // Uniform over the upper hemisphere, a little above the horizon.
    const y = 0.12 + rnd() * 0.88, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    const mag = rnd();
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, size: mag > 0.93 ? 4.5 : mag > 0.7 ? 3.2 : 2.4, b: 0.6 + mag * 0.4, ph: rnd() * 6.3, warm: rnd() < 0.2 });
  }
  return (STARS = out);
}

// R: the frame's rows; cam: the kit camera (target tx, ty, tz); night 0..1.
export function drawStars(R, cam, night, t) {
  if (night < 0.35) return;
  const fade = Math.min(1, (night - 0.35) / 0.4), D = 1500;
  for (const s of stars()) {
    const tw = 0.82 + 0.18 * Math.sin(t * 2.3 + s.ph * 7);
    const c = s.warm ? [1, 0.9, 0.75] : [0.85, 0.9, 1];
    R.points.push(cam.tx + s.x * D, cam.ty + s.y * D, cam.tz + s.z * D, s.size, 0, c[0], c[1], c[2], fade * s.b * tw, 0);
  }
}

// Foam flecks riding the current through a rapid: each fast sample near i
// sends a few down to the next, spread across the channel.
export function foamStream(R, S, i, t, night = 0) {
  const dim = 1 - 0.7 * night;
  for (let q = Math.max(0, i - 12); q < Math.min(S.length - 1, i + 30); q++) {
    const p = S[q], p1 = S[q + 1];
    // A lacy foam line along both banks, busier on fast water.
    for (const side of [-1, 1]) for (let m = 0; m < 2; m++) {
      const h = Math.sin(q * 3.17 + side * 9.1 + m * 4.3) * 9631.7, r = h - Math.floor(h);
      const u = (t * (0.25 + p.cls * 0.2) + r) % 1, lat = side * (p.width / 2 - 0.4);
      const x = p.x + (p1.x - p.x) * u - p.tz * lat, z = p.z + (p1.z - p.z) * u + p.tx * lat;
      R.points.push(x, p.level + (p1.level - p.level) * u + 0.08, z, 4, 0.6 + p.cls * 0.15, 0.92, 0.96, 0.98, (0.2 + p.cls * 0.07) * dim * Math.sin(u * Math.PI), POINT_SOFT);
    }
    if (p.cls < 2) continue;
    const n = p.cls >= 4 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const h = Math.sin(q * 12.9898 + k * 78.233) * 43758.5453, r = h - Math.floor(h);
      const u = (t * (0.6 + p.cls * 0.25) + r * 7) % 1;
      const lat = (r - 0.5) * p.width * 0.85;
      const x = p.x + (p1.x - p.x) * u - p.tz * lat, z = p.z + (p1.z - p.z) * u + p.tx * lat;
      R.points.push(x, p.level + (p1.level - p.level) * u + 0.12, z, 8, 0.6 + p.cls * 0.2, 0.95, 0.97, 1, 0.62 * dim * Math.sin(u * Math.PI), POINT_SOFT);
    }
  }
}

// A lantern hung at the stern after dark (one light, kept ahead of camp fires).
export function boatLantern(R, b, night) {
  if (night <= 0.15 || b.swimming) return;
  const lx = b.x - Math.cos(b.heading) * 1.6, lz = b.z - Math.sin(b.heading) * 1.6;
  R.lights.push(lx, b.y + 1.5, lz, 11, 1, 0.78, 0.45, 0.9 * night, 4, 0, 0, 0);
  R.points.push(lx, b.y + 1.5, lz, 20, 0.9, 1, 0.8, 0.45, 0.8 * night, POINT_SOFT);
}

// Fair-weather clouds: flattened low-poly puffs high over the valley, lit by
// the sun (gold at dusk, grey-blue at night) and drifting on the wind. One
// translucent mesh; driftClouds() returns its model matrix for the frame.
export function cloudMesh(size, seed = 1, MeshBuilder) {
  const rnd = mulberry32(seed * 101 + 9), b = new MeshBuilder();
  const span = size * 2.2, c0 = size / 2;
  for (let k = 0; k < 44; k++) {
    const cx = c0 + (rnd() - 0.5) * span, cz = c0 + (rnd() - 0.5) * span, cy = 430 + rnd() * 180;
    const W = 90 + rnd() * 140, puffs = 4 + Math.floor(rnd() * 4), yaw = rnd() * 6.3;
    for (let q = 0; q < puffs; q++) {
      const a = yaw + (q / puffs) * Math.PI * 2 * 0.6, d = (q === 0 ? 0 : 0.35 + rnd() * 0.45) * W;
      const px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d * 0.6, r = W * (0.35 + rnd() * 0.3), hgt = r * (0.45 + rnd() * 0.25);
      const top = [1, 1, 1], mid = [0.94, 0.95, 0.98], base = [0.8, 0.83, 0.9];
      b.lathe(px, cy - hgt * 0.2, pz, [[r * 0.8, 0], [r, hgt * 0.25], [r * 0.95, hgt * 0.55], [r * 0.7, hgt * 0.85], [r * 0.3, hgt * 1.02], [0, hgt * 1.08]], 9, [base, mid, top, top, top], rnd());
    }
  }
  return b.build({ color: [1, 1, 1, 0.88] });
}

export function driftClouds(t, out) {
  // A slow sway rather than a wrap, so no cloud ever jumps.
  const wx = Math.sin(t / 500) * 500, wz = Math.sin(t / 900 + 1) * 250;
  out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; out[12] = wx; out[14] = wz;
  return out;
}

// Sun glitter: twinkling glints on the water between the boat and the sun.
// clock: fraction of the (local solar) day; elev: sun elevation in degrees.
export function sunGlitter(R, b, clock, elev, t, wetAt = null) {
  if (elev < 2 || b.swimming) return;
  const H = (clock * 24 - 12) * 15 * Math.PI / 180, dx = -Math.sin(H), dz = Math.cos(H) * 0.8 + 0.2;
  const l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
  const strength = Math.min(1, (elev - 2) / 8) * (elev > 40 ? 0.6 : 1);
  for (let k = 0; k < 36; k++) {
    const h = Math.sin(k * 91.7 + Math.floor(t * 7 + k * 0.37) * 13.1) * 4375.5, r = h - Math.floor(h);
    if (r < 0.45) continue;
    const d = 6 + (k / 36) * 38, side = (Math.sin(k * 7.7) * 0.5) * d * 0.35;
    const x = b.x + ux * d - uz * side, z = b.z + uz * d + ux * side, wl = wetAt ? wetAt(x, z) : b.y;
    if (Number.isNaN(wl) || Math.abs(wl - b.y) > 3) continue;
    R.points.push(x, wl + 0.05, z, 3 + r * 3, 0, 1, 0.97, 0.88, strength * (r - 0.4), 0);
  }
}

// Surf: points along the sea shore where the land meets y = 0, found once;
// surfDraw() pulses the ones near the camera like waves breaking.
export function surfLine(world, heightAt) {
  const out = [], S = world.size, step = Math.max(6, world.cell);
  for (let z = 0; z <= S; z += step) for (let x = 0; x <= S; x += step) {
    const h = heightAt(world, x, z);
    if (h > 0.15 || h < -0.9) continue;
    if (heightAt(world, x + step, z) < 0 && heightAt(world, x - step, z) < 0 && heightAt(world, x, z + step) < 0 && heightAt(world, x, z - step) < 0) continue;
    out.push({ x, z, ph: (x * 0.013 + z * 0.011) % 6.28 });
  }
  return out;
}

export function surfDraw(R, surf, cx, cz, t) {
  for (const p of surf) {
    const dx = p.x - cx, dz = p.z - cz;
    if (dx * dx + dz * dz > 260 * 260) continue;
    const w = 0.5 + 0.5 * Math.sin(t * 0.9 + p.ph);
    R.points.push(p.x, 0.12, p.z, 3, 1.2 + w * 1.8, 0.95, 0.97, 1, 0.06 + 0.22 * w * w, POINT_SOFT);
  }
}

// The water's two textures (calm ripples, whitewater) and the clouds' tint.
// update() scrolls the water rows downstream (whitewater faster) and tints
// them for the hour, as the sky they reflect: warm at golden hour, moonlit
// blue at night. Rivers and clouds are unlit meshes, so this is their light.
export class WaterTextures {
  constructor(bridge, seed) {
    this.bridge = bridge;
    this.ripple = rippleTexture(64, seed);
    this.rippleSlot = bridge.texture(this.ripple, 64, 64, TEX_MIPMAPS);
    this.foam = foamTexture(64, seed);
    this.foamSlot = bridge.texture(this.foam, 64, 64, TEX_MIPMAPS);
    this.cloud = new Uint8Array(16).fill(255);
    this.cloudSlot = bridge.texture(this.cloud, 2, 2, 0);
    this.states = {};
  }

  scroll(key, src, slot, speed, dt, tint) {
    const st = this.states[key] || (this.states[key] = { off: 0, acc: 0, out: new Uint8Array(src.length), tint: null });
    st.acc += dt * speed;
    const rows = Math.floor(st.acc);
    st.acc -= rows;
    st.off = (st.off + rows) % 64;
    if (!rows && st.tint && Math.abs(st.tint[0] - tint[0]) + Math.abs(st.tint[2] - tint[2]) < 0.01) return;
    st.tint = tint;
    const k = st.off * 64 * 4, out = st.out, L = src.length;
    for (let i = 0; i < L; i += 4) {
      const j = (i - k + L) % L;
      out[i] = Math.min(255, src[j] * tint[0]); out[i + 1] = Math.min(255, src[j + 1] * tint[1]); out[i + 2] = Math.min(255, src[j + 2] * tint[2]); out[i + 3] = 255;
    }
    this.bridge.updateTexture(slot, out);
  }

  update(dt, night, warm) {
    const day = [lerp(1.22, 1.25, warm * 0.8), lerp(1.24, 0.98, warm * 0.8), lerp(1.22, 0.78, warm * 0.8)];
    const tint = [lerp(day[0], 0.42, night), lerp(day[1], 0.58, night), lerp(day[2], 1.0, night)];
    const ct = [lerp(1, 0.2, night), lerp(lerp(1, 0.8, warm), 0.23, night), lerp(lerp(1, 0.68, warm), 0.32, night)];
    if (!this.cloudTint || Math.abs(this.cloudTint[0] - ct[0]) + Math.abs(this.cloudTint[2] - ct[2]) > 0.01) {
      this.cloudTint = ct;
      for (let i = 0; i < 16; i += 4) { this.cloud[i] = ct[0] * 255; this.cloud[i + 1] = ct[1] * 255; this.cloud[i + 2] = ct[2] * 255; }
      this.bridge.updateTexture(this.cloudSlot, this.cloud);
    }
    this.scroll("ripple", this.ripple, this.rippleSlot, 24, dt, tint);
    this.scroll("foam", this.foam, this.foamSlot, 60, dt, tint);
  }
}

// Ghost recorder and codec, shared by the browser and the server.
//
// A ghost is one sample every 100 ms: {t (ms from the start), x, z (metres),
// h (heading, radians)}. The codec quantises x and z to 0.1 m and the heading
// to 1/256 of a turn, delta-encodes each sample against the one before as
// zigzag varints, and wraps the bytes in base64url.
//
// Layout: [version=1] [count varint] then per sample [dt, dx, dz, dh] as zigzag
// varints. The first sample's deltas are taken against {t:0, x:0, z:0, h:0}.
// Pure ES module: no DOM, no Node APIs.

export const GHOST_VERSION = 1;
export const SAMPLE_MS = 100;
export const MAX_GHOST_CHARS = 64 * 1024;
const TURN = Math.PI * 2;

const quantT = (t) => Math.round(t);
const quantXZ = (v) => Math.round(v * 10);
const quantH = (h) => (((Math.round(h / TURN * 256)) % 256) + 256) % 256;

// ---------------------------------------------------------------- varints

function pushVarint(out, n) {
  // n is a non-negative integer below 2^53.
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
}
const zig = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzig = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function readVarint(bytes, pos) {
  let n = 0, mul = 1, i = pos.i;
  for (let k = 0; k < 8; k++) {
    if (i >= bytes.length) throw new Error("ghost: truncated");
    const b = bytes[i++];
    n += (b & 0x7f) * mul;
    if (b < 0x80) { pos.i = i; return n; }
    mul *= 0x80;
  }
  throw new Error("ghost: varint too long");
}

// ---------------------------------------------------------------- base64url

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INV = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INV[B64.charCodeAt(i)] = i;

export function toBase64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (b !== undefined) s += B64[(n >> 6) & 63];
    if (c !== undefined) s += B64[n & 63];
  }
  return s;
}

export function fromBase64url(str) {
  if (typeof str !== "string") throw new Error("ghost: not a string");
  if (str.length % 4 === 1) throw new Error("ghost: bad base64 length");
  const out = new Uint8Array(Math.floor(str.length * 3 / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i), v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) throw new Error("ghost: bad base64 character");
    acc = ((acc << 6) | v) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

// ---------------------------------------------------------------- codec

// samples: [{t, x, z, h}] with t in ms. Returns a base64url string.
export function encode(samples) {
  const out = [GHOST_VERSION];
  pushVarint(out, samples.length);
  let pt = 0, px = 0, pz = 0, ph = 0;
  for (const s of samples) {
    if (![s.t, s.x, s.z, s.h].every(Number.isFinite)) throw new Error("ghost: non-finite sample");
    const t = quantT(s.t), x = quantXZ(s.x), z = quantXZ(s.z), h = quantH(s.h);
    const dh = ((h - ph + 128 + 256) % 256) - 128;
    pushVarint(out, zig(t - pt)); pushVarint(out, zig(x - px)); pushVarint(out, zig(z - pz)); pushVarint(out, zig(dh));
    pt = t; px = x; pz = z; ph = h;
  }
  return toBase64url(Uint8Array.from(out));
}

// Returns [{t, x, z, h}] (h in radians, -PI..PI). Throws on malformed input.
export function decode(str) {
  if (typeof str !== "string" || str.length === 0) throw new Error("ghost: empty");
  if (str.length > MAX_GHOST_CHARS) throw new Error("ghost: too large");
  const bytes = fromBase64url(str);
  if (bytes[0] !== GHOST_VERSION) throw new Error("ghost: unknown version");
  const pos = { i: 1 };
  const n = readVarint(bytes, pos);
  // Each sample needs at least 4 bytes, so a count beyond that is a lie.
  if (n > (bytes.length - pos.i) / 4) throw new Error("ghost: bad count");
  const samples = new Array(n);
  let t = 0, x = 0, z = 0, h = 0;
  for (let k = 0; k < n; k++) {
    t += unzig(readVarint(bytes, pos));
    x += unzig(readVarint(bytes, pos));
    z += unzig(readVarint(bytes, pos));
    h = (((h + unzig(readVarint(bytes, pos))) % 256) + 256) % 256;
    samples[k] = { t, x: x / 10, z: z / 10, h: (h >= 128 ? h - 256 : h) / 256 * TURN };
  }
  if (pos.i !== bytes.length) throw new Error("ghost: trailing bytes");
  return samples;
}

const wrapAngle = (a) => a - TURN * Math.floor((a + Math.PI) / TURN);

// Interpolated pose at tMs (clamped to the ends), heading along the short way round.
export function sampleAt(decoded, tMs) {
  const n = decoded.length;
  if (!n) return null;
  if (tMs <= decoded[0].t) return { ...decoded[0], done: false };
  if (tMs >= decoded[n - 1].t) return { ...decoded[n - 1], done: true };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (decoded[mid].t <= tMs) lo = mid; else hi = mid; }
  const a = decoded[lo], b = decoded[hi];
  const u = b.t > a.t ? (tMs - a.t) / (b.t - a.t) : 0;
  return {
    t: tMs,
    x: a.x + (b.x - a.x) * u,
    z: a.z + (b.z - a.z) * u,
    h: wrapAngle(a.h + wrapAngle(b.h - a.h) * u),
    done: false,
  };
}

// Records a boat every SAMPLE_MS of game time.
//   const rec = new GhostRecorder(); rec.start(game.time * 1000, boat.x, boat.z, boat.heading);
//   each frame: rec.record(game.time * 1000, boat.x, boat.z, boat.heading);
//   at the finish: const ghost = rec.finish(game.time * 1000, boat.x, boat.z, boat.heading);
export class GhostRecorder {
  constructor() { this.samples = []; this.t0 = 0; this.next = 0; this.active = false; }
  // Pass the boat's pose too so the ghost has a sample at exactly t = 0.
  start(tMs, x, z, h) {
    this.samples = []; this.t0 = tMs; this.next = 0; this.active = true;
    if (Number.isFinite(x)) this.record(tMs, x, z, h);
  }
  record(tMs, x, z, h) {
    if (!this.active) return;
    const t = tMs - this.t0;
    if (t < this.next) return;
    this.samples.push({ t: Math.round(t), x, z, h });
    // Stay on the 100 ms grid even when frames are uneven.
    this.next = (Math.floor(t / SAMPLE_MS) + 1) * SAMPLE_MS;
  }
  // Adds a final sample at the finish, stops and returns the encoded ghost.
  finish(tMs, x, z, h) {
    if (!this.active) return null;
    const t = Math.round(tMs - this.t0);
    const last = this.samples[this.samples.length - 1];
    if (!last || t > last.t) this.samples.push({ t, x, z, h });
    this.active = false;
    return encode(this.samples);
  }
  stop() { this.active = false; }
  get durationMs() { const s = this.samples; return s.length ? s[s.length - 1].t : 0; }
}

// Shared plausibility check (the server uses it before ranking; the client can
// use it before saving locally). Returns {ok, decoded} or {ok:false, reason}.
export const GHOST_LIMITS = { maxSpeed: 12, worldMin: 0, worldMax: 3100, slackMs: 1000, maxGapMs: 2000 };

export function checkGhost(str, ms, limits = GHOST_LIMITS) {
  if (typeof str !== "string" || str.length > MAX_GHOST_CHARS) return { ok: false, reason: "ghost too large" };
  let d;
  try { d = decode(str); } catch (e) { return { ok: false, reason: e.message }; }
  if (d.length < 2) return { ok: false, reason: "ghost too short" };
  for (let i = 0; i < d.length; i++) {
    const s = d[i];
    if (s.x < limits.worldMin || s.x > limits.worldMax || s.z < limits.worldMin || s.z > limits.worldMax) return { ok: false, reason: "ghost out of bounds" };
    if (i === 0) continue;
    const p = d[i - 1], dt = s.t - p.t;
    if (dt <= 0) return { ok: false, reason: "ghost times not increasing" };
    if (dt > limits.maxGapMs) return { ok: false, reason: "ghost has a gap" };
    // 0.1 m quantisation on both ends allows a little slack over short steps.
    const dist = Math.hypot(s.x - p.x, s.z - p.z) - 0.15;
    if (dist / (dt / 1000) >= limits.maxSpeed) return { ok: false, reason: "ghost too fast" };
  }
  const dur = d[d.length - 1].t - d[0].t;
  if (!Number.isFinite(ms) || Math.abs(dur - ms) > limits.slackMs) return { ok: false, reason: "ghost duration does not match time" };
  return { ok: true, decoded: d };
}

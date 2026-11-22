// Input checks for the live protocol and the ghost API. Pure functions.

export const WORLD_MIN = 0, WORLD_MAX = 3100, MAX_SPEED = 30;
export const BOATS = new Set(["raft", "kayak", "canoe", "dory"]);
export const EMOTES = new Set(["wave", "flare", "bell"]);
export const DEFAULT_NAME = "Paddler";
export const DEFAULT_COLOUR = [0.85, 0.24, 0.12];
export const COURSE_RE = /^[a-z0-9-]{1,40}$/;
export const ROOM_RE = /^[a-z0-9-]{1,24}$/;
export const SEED_RE = /^[A-Za-z0-9_-]{1,32}$/;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

// Printable ASCII, 1-16 chars after trimming; anything else becomes "Paddler".
export function cleanName(name) {
  if (typeof name !== "string") return DEFAULT_NAME;
  const t = name.trim();
  if (t.length < 1 || t.length > 16 || !/^[\x20-\x7e]+$/.test(t)) return DEFAULT_NAME;
  return t;
}

// [r,g,b] in 0..1, or "#rrggbb". Returns an [r,g,b] array rounded to 3 places.
export function cleanColour(c) {
  if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) {
    return [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) / 255 * 1000) / 1000);
  }
  if (Array.isArray(c) && c.length === 3 && c.every((v) => fin(v) && v >= 0 && v <= 1)) {
    return c.map((v) => Math.round(v * 1000) / 1000);
  }
  return DEFAULT_COLOUR.slice();
}

export const cleanBoat = (b) => (BOATS.has(b) ? b : "raft");
export const validCourse = (c) => typeof c === "string" && COURSE_RE.test(c);
export const validEmote = (k) => typeof k === "string" && EMOTES.has(k);

export function cleanRoom(r) { return typeof r === "string" && ROOM_RE.test(r) ? r : "river"; }
export function cleanSeed(s) {
  if (fin(s)) s = String(Math.trunc(s));
  return typeof s === "string" && SEED_RE.test(s) ? s : "0";
}

// Boat state: {x,z,y,h,vx,vz,boat,swim}. Returns a clean copy or null.
export function cleanState(m) {
  if (!m || typeof m !== "object") return null;
  const { x, z, y, h, vx, vz } = m;
  if (![x, z, y, h, vx, vz].every(fin)) return null;
  if (x < WORLD_MIN || x > WORLD_MAX || z < WORLD_MIN || z > WORLD_MAX) return null;
  if (y < -500 || y > 3000) return null;
  if (Math.abs(h) > 1000) return null;
  if (Math.hypot(vx, vz) >= MAX_SPEED) return null;
  if (m.boat !== undefined && !BOATS.has(m.boat)) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  const hw = h - Math.PI * 2 * Math.floor((h + Math.PI) / (Math.PI * 2));
  return { x: r2(x), z: r2(z), y: r2(y), h: Math.round(hw * 1000) / 1000, vx: r2(vx), vz: r2(vz), boat: m.boat, swim: !!m.swim };
}

export const MIN_RACE_MS = 1000, MAX_RACE_MS = 60 * 60 * 1000;
export const validRaceMs = (ms) => fin(ms) && ms >= MIN_RACE_MS && ms <= MAX_RACE_MS;

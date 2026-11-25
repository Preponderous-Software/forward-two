// The chase camera's targets, as pure numbers so tests can check them.
// game.js eases the real camera toward these each frame.
//
// - Look direction blends smoothly from the boat's heading (slow) to its
//   travel (fast), so there is no snap as the boat crosses a speed threshold.
// - In a rapid the camera looks mostly downstream along the river, not along
//   a boat that is spinning off rocks: the player reads the water ahead, and
//   the view does not whip round on every hit. It also sits a little higher
//   and further back, and looks further ahead, to show the next features.
import { clamp } from "../world/noise.js";

const BASE_DIST = { raft: 15, kayak: 11, canoe: 13, dory: 15 };

export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// boat: {heading, vx, vz, kind, current?: {cls, hit?: {sample: {tx, tz}}}}
// rapid: truthy when the guide is calling a rapid.
export function chaseTargets(boat, rapid = false) {
  const fx = Math.cos(boat.heading), fz = Math.sin(boat.heading);
  const sp = Math.hypot(boat.vx, boat.vz);
  const w = smoothstep(0.6, 2.2, sp);
  let dx = fx * (1 - w) + (sp > 1e-6 ? boat.vx / sp : 0) * w;
  let dz = fz * (1 - w) + (sp > 1e-6 ? boat.vz / sp : 0) * w;
  const s = boat.current?.hit?.sample;
  const white = rapid || (boat.current?.cls ?? 0) >= 3;
  if (white && s) {
    // Mostly downstream; if the boat is heading upstream (ferrying), keep
    // facing its way so the controls still read left-is-left.
    const up = s.tx * fx + s.tz * fz < -0.3;
    const k = up ? 0 : 0.7;
    dx = dx * (1 - k) + s.tx * k; dz = dz * (1 - k) + s.tz * k;
  }
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const base = BASE_DIST[boat.kind] || 14;
  return {
    dx, dz,
    yaw: Math.atan2(-dz, -dx),
    pitch: 0.36 + (white ? 0.12 : 0),
    dist: base + Math.min(sp, 8) * 0.6 + (white ? 3 : 0),
    // In white water the camera rises and pulls back to show what's coming,
    // but aims close to the boat so the boat sits mid-screen, clear of the lane.
    ahead: (white ? 1.5 : 3) + Math.min(sp, 8) * 0.3,
    yawRate: white ? 1.4 : 1.8,
  };
}

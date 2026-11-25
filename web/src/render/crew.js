// The crew's pure maths: where each paddler sits, how a stroke moves the
// blade over time, and the small matrix helpers the boat rig composes. No
// DOM, no engine, no meshes, so tests drive it directly.
//
// Boat space as in boats.js: x forward (bow at +x), y up, z to starboard.
// Rotations follow boatMatrix: yaw maps x toward +z, pitch (about z) lifts
// +x toward +y, roll (about x) tips +y toward +z.
import { STROKES } from "../sim/boat.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ strokes

// Seconds one stroke takes, by boat: a big raft crew digs slower than a kayak.
export const STROKE_SECONDS = { raft: 0.8, kayak: 0.55, canoe: 0.7, dory: 0.9 };

// The blade's resting place between strokes: a little forward, out of the water.
export const READY = 0.55;

// One stroke as two curves over its phase p (0..1):
//   sweep: where the blade is, fore (+1) to aft (-1);
//   dip: how deep it is, 0 out of the water to 1 buried.
// catch (reach and plant), drive (pull back), exit (lift out), recovery
// (swing forward again). Both curves start and end at the ready pose, so a
// finished stroke hands back to idle without a jump.
export function strokeCurve(p) {
  if (!(p >= 0) || p >= 1) return { sweep: READY, dip: 0 };
  if (p < 0.18) { const u = smooth(p / 0.18); return { sweep: READY + (1 - READY) * u, dip: u }; }
  if (p < 0.68) return { sweep: 1 - 2 * smooth((p - 0.18) / 0.5), dip: 1 };
  if (p < 0.8) return { sweep: -1, dip: 1 - smooth((p - 0.68) / 0.12) };
  return { sweep: -1 + (1 + READY) * smooth((p - 0.8) / 0.2), dip: 0 };
}

// Phase of a stroke strokeT seconds in, or -1 once it's over.
export function strokePhase(strokeT, seconds) {
  if (!(strokeT >= 0) || !(seconds > 0)) return -1;
  const p = strokeT / seconds;
  return p < 1 ? p : -1;
}

// What a stroke does to one paddler: "fwd", "back" or "idle". Single blades
// and oars sit on a fixed side (+1 starboard, -1 port); a turn is a forward
// stroke on the side away from the turn and a back stroke on the other, as a
// raft guide calls it (turning left: starboard forward, port back). Sides come
// from STROKES[].yaw: + grows the heading and turns the bow toward local +z,
// which is starboard (screen-right from the chase camera). A kayak's double blade picks its side per stroke:
// forward and back strokes alternate, a turn sweeps on the outside.
// Returns {mode, side}.
export function seatAction(seat, stroke, alt = 0) {
  const S = STROKES[stroke];
  if (seat.type === "rider") return { mode: "idle", side: 1 };
  if (seat.type === "oars") {
    const port = seatAction({ type: "single", side: -1 }, stroke, alt).mode, starboard = seatAction({ type: "single", side: 1 }, stroke, alt).mode;
    return { mode: port === "idle" ? "idle" : "row", side: 1, port, starboard };
  }
  if (!S) return { mode: "idle", side: seat.side || 1 };
  const yaw = Math.sign(S.yaw);
  if (seat.type === "double") {
    if (yaw) return { mode: "fwd", side: -yaw };
    return { mode: S.push < 0 ? "back" : "fwd", side: alt % 2 ? -1 : 1 };
  }
  const side = seat.side || 1;
  if (yaw) return { mode: side === -yaw ? "fwd" : "back", side };
  return { mode: S.push < 0 ? "back" : "fwd", side };
}

// The blade curve for one paddler `t` seconds into a stroke of `mode`.
export function bladeAt(mode, t, seconds) {
  const p = mode === "idle" ? -1 : strokePhase(t, seconds);
  const c = strokeCurve(p);
  if (mode === "back" && p >= 0) c.sweep = -c.sweep;   // catch aft, push forward
  return c;
}

// Where a blade waits between strokes: ready, or for a raft guide, trailing
// in the water as a rudder.
export function idleBlade(seat) {
  return seat.guide ? { sweep: -0.75, dip: 0.55 } : { sweep: READY, dip: 0 };
}

// Ease a value toward a target at `rate` per second (frame-rate independent).
export function approach(cur, target, rate, dt) {
  return target + (cur - target) * Math.exp(-rate * Math.max(0, dt));
}

// Crew lean into a turn: spin (rad/s, + turns toward starboard, screen-right) to a roll
// that tips heads toward the inside, capped so nobody falls out.
export function turnLean(spin, k = 0.14, cap = 0.28) {
  return clamp((spin || 0) * k, -cap, cap);
}

// Heave and pitch from the water. rough: 0 flat, ~1 a class II riffle, 3+ big
// water. Returns {heave (m), pitch (rad), roll (rad)} at time t.
export function waterMotion(t, rough = 0, seed = 0) {
  const r = clamp(rough, 0, 4);
  const a = 0.018 + r * 0.05;
  return {
    heave: Math.sin(t * 2.1 + seed) * a + Math.sin(t * 3.7 + seed * 2.3) * a * 0.45,
    pitch: Math.sin(t * 2.6 + seed * 1.7 + 0.8) * (0.008 + r * 0.03),
    roll: Math.sin(t * 1.9 + seed * 0.7 + 2.1) * (0.01 + r * 0.025),
  };
}

// Bow wave, wake and spray strength 0..1 from speed through the water.
export function sprayLevel(speed, rough = 0) {
  return clamp((speed - 0.6) / 4.5, 0, 1) * 0.8 + clamp(rough - 1, 0, 3) * 0.07;
}

// A V-shaped wake as n flowing points per side behind the stern: returns
// [{along (m behind), out (m from centreline), fade 0..1}]. Deterministic in t.
export function wakePoints(t, speed, halfBeam, n = 5, length = 7) {
  const out = [];
  if (speed < 0.5) return out;
  const flow = t * Math.min(speed, 6) / length;
  for (let k = 0; k < n; k++) {
    const u = (flow + k / n) % 1;
    const along = u * length;
    out.push({ along, out: halfBeam * 0.8 + along * 0.32, fade: (1 - u) * clamp(speed / 3, 0.3, 1) });
  }
  return out;
}

// ------------------------------------------------------------------ seats

// Where each crew member sits, per boat. type: "single" (one blade, fixed
// side), "double" (kayak paddle), "oars" (dory rower), "rider" (a passenger).
// x/y/z is the seat (the paddler's hips); look: shirt/PFD/helmet variety.
export const CREW = {
  raft: [
    { type: "single", x: 0.95, y: 0.3, z: -0.72, side: -1, out: 0.5, pz: 0.24, len: 1.5, look: 0 },
    { type: "single", x: 0.95, y: 0.3, z: 0.72, side: 1, out: 0.5, pz: 0.24, len: 1.5, look: 1 },
    { type: "single", x: -0.2, y: 0.3, z: -0.72, side: -1, out: 0.5, pz: 0.24, len: 1.5, look: 2 },
    { type: "single", x: -0.2, y: 0.3, z: 0.72, side: 1, out: 0.5, pz: 0.24, len: 1.5, look: 3 },
    { type: "single", x: -1.42, y: 0.42, z: 0.48, side: 1, out: 0.62, pz: 0.2, len: 1.62, look: 4, guide: true },
  ],
  kayak: [{ type: "double", x: -0.15, y: 0.02, z: 0, side: 1, look: 1 }],
  canoe: [
    { type: "single", x: 1.42, y: 0.16, z: 0, side: -1, out: 0.55, len: 1.36, look: 0, kneel: true },
    { type: "single", x: -1.62, y: 0.27, z: 0, side: 1, out: 0.55, len: 1.46, look: 2 },
  ],
  dory: [
    { type: "oars", x: -0.08, y: 0.24, z: 0, side: 1, look: 4 },
    { type: "rider", x: 1.3, y: 0.26, z: 0, side: 1, look: 3, drop: 0.16 },
    { type: "rider", x: -1.3, y: 0.26, z: 0, side: 1, look: 1 },
  ],
};

// The dory's oarlocks (boat space) and its oars' reach: [inboard, outboard].
export const OARLOCK = { x: 0.42, y: 0.5, z: 0.84 };
export const OAR = { inboard: 0.72, outboard: 2.5 };

// ------------------------------------------------------------------ pose

// A paddler's pose: torso and blade from its seat, action and blade curve.
// Returns {twist, lean, side lean} for the torso and the paddle's local
// transform parameters (in the torso's frame, or the boat's for oars).
export function crewPose(seat, act, blade, extra = {}) {
  const s = act.side || seat.side || 1;
  const sw = blade.sweep, dip = blade.dip;
  const reach = (sw + 1) / 2;                   // 0 aft .. 1 forward
  const rough = extra.rough || 0, lean = extra.lean || 0, breathe = extra.breathe || 0;
  const pose = { side: s, body: { twist: 0, lean: 0, roll: lean }, paddle: null, oars: null };
  if (seat.type === "rider") {
    pose.body.lean = -0.06 - rough * 0.04 + breathe * 0.02;
    return pose;
  }
  if (seat.type === "oars") {
    // The rower faces the bow and pushes: handles forward as blades go aft.
    pose.body.lean = -0.05 - 0.32 * (1 - reach) * dip - rough * 0.05 + breathe * 0.02;
    // Each oar may pull or push on its own (a pivot turn); blades are
    // feathered flat on the recovery.
    const one = (side, mode) => {
      const w = mode === "back" ? { sweep: -blade.sweep, dip: blade.dip } : blade;
      return { side, yaw: -side * 0.42 * w.sweep, dip: side * (0.08 + 0.3 * w.dip), feather: (1 - w.dip) * 1.3 };
    };
    pose.oars = { port: one(-1, act.port || "fwd"), starboard: one(1, act.starboard || "fwd") };
    return pose;
  }
  if (seat.type === "double") {
    pose.body.twist = -s * 0.42 * sw * (0.35 + 0.65 * dip);
    pose.body.lean = -0.1 - 0.16 * reach * dip - rough * 0.06 + breathe * 0.02;
    pose.body.roll += s * 0.06 * dip;
    pose.paddle = {
      x: 0.32 + 0.06 * reach, y: 0.42 + 0.08 * (1 - dip), z: 0,
      yaw: -s * 0.25 * sw * dip, pitch: 0, roll: s * (0.1 + 0.75 * dip),
    };
    return pose;
  }
  // Single blade: the top hand is the pivot, over the paddler's inside hip.
  const sweepS = sw, dipS = dip;
  pose.body.twist = -s * 0.34 * sweepS * (0.4 + 0.6 * dipS);
  pose.body.lean = -0.12 - 0.22 * ((sweepS + 1) / 2) * dipS - rough * 0.07 + breathe * 0.02;
  pose.body.roll += s * 0.09 * dipS;
  const out = seat.out || 0.45, len = seat.len || 1.4;
  pose.paddle = {
    x: 0.28, y: 0.55 + 0.3 * (1 - dipS), z: s * (seat.pz ?? -0.06),
    yaw: 0, pitch: 0.34 * sweepS, roll: -s * Math.asin(clamp(out / (len * 0.8), 0, 0.9)) - s * 0.2 * (1 - dipS),
    feather: (1 - dipS) * 1.1 * s,
  };
  return pose;
}

// A swimmer in the whitewater position: on their back, feet downstream, head
// up, arms sculling at the surface. Returns {heave (m), tilt (rad, how far
// the body lies back), roll, scull (arm sweep, rad)} at time t.
export const SWIM_TILT = 1.0;
export function swimPose(t, rough = 0) {
  const r = clamp(rough, 0, 4);
  return {
    heave: Math.sin(t * 2.3) * (0.045 + r * 0.03) + Math.sin(t * 3.9 + 1.1) * 0.015 * (1 + r),
    tilt: SWIM_TILT + Math.sin(t * 1.7) * 0.06,
    roll: Math.sin(t * 1.3 + 0.4) * (0.05 + r * 0.04),
    scull: Math.sin(t * 4.2) * 0.5,
  };
}

// Which way is downstream: the current's direction, or the boat's heading in
// still water.
export function downstream(current, heading) {
  return current && current.speed > 0.2 ? Math.atan2(current.vz, current.vx) : heading;
}

// The turn stroke that turns the boat the way `turnRate` (heading change)
// goes: read from STROKES so it follows the sim's sign convention.
export function turnStroke(turnRate) {
  const want = Math.sign(turnRate);
  return Object.keys(STROKES).find((k) => Math.sign(STROKES[k].yaw) === want) || "forward";
}

// Synthesised strokes for boats we only see as positions (other players,
// ghosts): a steady cadence when moving, turn strokes when turning.
export class AutoStroker {
  constructor(seconds = 0.7, seed = 0) { this.seconds = seconds; this.t = (seed * 0.37) % 1; this.next = 0.2 + this.t; this.stroke = null; this.strokeT = 9; this.count = 0; }
  update(dt, speed, turnRate) {
    this.t += dt; this.strokeT += dt;
    if (this.t >= this.next) {
      const moving = speed > 0.7, turning = Math.abs(turnRate) > 0.25;
      if (moving || turning) {
        this.stroke = turning ? turnStroke(turnRate) : "forward";
        this.strokeT = 0; this.count++;
      }
      this.next = this.t + this.seconds * (moving ? 1.35 : 1.8);
    }
    return { stroke: this.stroke, strokeT: this.strokeT, count: this.count };
  }
}

// ------------------------------------------------------------------ matrices

// Column-major 4x4s, as boatMatrix builds them.
export function mat(x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, out = new Float32Array(16)) {
  const ch = Math.cos(yaw), sh = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const X = [cp, sp, 0], Y = [-sp * cr, cp * cr, sr], Z = [sp * sr, -cp * sr, cr];
  const w = (v) => [v[0] * ch - v[2] * sh, v[1], v[0] * sh + v[2] * ch];
  const a = w(X), b = w(Y), c = w(Z);
  out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = 0;
  out[4] = b[0]; out[5] = b[1]; out[6] = b[2]; out[7] = 0;
  out[8] = c[0]; out[9] = c[1]; out[10] = c[2]; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

// Rotation about the local z axis only (pitch), and about y only (yaw).
export const pitchMat = (a, out) => mat(0, 0, 0, 0, a, 0, out);
export const yawMat = (a, out) => mat(0, 0, 0, a, 0, 0, out);

export function mul(a, b, out = new Float32Array(16)) {
  const r = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) {
    r[c * 4 + i] = a[i] * b[c * 4] + a[4 + i] * b[c * 4 + 1] + a[8 + i] * b[c * 4 + 2] + a[12 + i] * b[c * 4 + 3];
  }
  if (r !== out) out.set(r);
  return out;
}

export function apply(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

// Inverse of a rotation + translation.
export function invRigid(m, out = new Float32Array(16)) {
  const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  out[0] = r[0]; out[1] = r[3]; out[2] = r[6]; out[3] = 0;
  out[4] = r[1]; out[5] = r[4]; out[6] = r[7]; out[7] = 0;
  out[8] = r[2]; out[9] = r[5]; out[10] = r[8]; out[11] = 0;
  const t = [m[12], m[13], m[14]];
  out[12] = -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]);
  out[13] = -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]);
  out[14] = -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]);
  out[15] = 1;
  return out;
}

// The torso's transform in boat space, and the paddle's in torso space
// (single and double blades) or the oars' in boat space.
export function bodyMatrix(seat, pose, out) {
  return mat(seat.x, seat.y, seat.z, pose.body.twist, pose.body.lean, pose.body.roll, out);
}

export function paddleMatrix(pose, out = new Float32Array(16)) {
  const p = pose.paddle;
  mat(p.x, p.y, p.z, p.yaw, p.pitch, p.roll, out);
  if (p.feather) mul(out, yawMat(p.feather), out);   // turn the blade about its shaft
  return out;
}

export function oarMatrix(o, out = new Float32Array(16)) {
  // yaw about the oarlock, dip about the boat's length, feather about the oar.
  mat(OARLOCK.x, OARLOCK.y, OARLOCK.z * o.side, o.yaw, 0, o.dip, out);
  return mul(out, pitchMat(o.feather * o.side), out);
}

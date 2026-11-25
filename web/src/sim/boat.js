// Boat physics on the water's surface. 2D (x, z) with the height read from
// the water level; no DOM, no engine, so tests drive it directly.
import { riverAt, waterAt, heightAt } from "../world/terrain.js";
import { flowSpeed } from "../world/rivers.js";
import { clamp, lerp } from "../world/noise.js";

export const BOATS = {
  raft: { name: "Raft", stroke: 1.15, turn: 1.0, drag: 0.55, side: 2.6, mass: 1.4, stability: 1.0, cargo: 3, len: 4.2, beam: 2.0, top: 5.2, colour: [0.85, 0.24, 0.12] },
  kayak: { name: "Kayak", stroke: 1.55, turn: 1.55, drag: 0.32, side: 3.4, mass: 0.7, stability: 0.62, cargo: 1, len: 3.6, beam: 0.7, top: 7.0, colour: [0.95, 0.72, 0.1] },
  canoe: { name: "Canoe", stroke: 1.3, turn: 0.9, drag: 0.36, side: 3.0, mass: 1.0, stability: 0.8, cargo: 5, len: 5.0, beam: 0.95, top: 6.2, colour: [0.2, 0.5, 0.35] },
  dory: { name: "Dory", stroke: 1.25, turn: 0.85, drag: 0.42, side: 3.2, mass: 1.8, stability: 1.25, cargo: 4, len: 5.6, beam: 1.7, top: 7.4, colour: [0.2, 0.35, 0.7] },
};

// yaw: the sign of the heading change. Strata's camera is right-handed, so a
// growing heading turns the bow to the screen's right; a left stroke must
// shrink it. (0.1.0 had these the wrong way round: A turned the boat right.)
export const STROKES = {
  forward: { push: 1.0, yaw: 0 },
  back: { push: -0.65, yaw: 0 },
  left: { push: 0.35, yaw: -1 },
  right: { push: 0.35, yaw: 1 },
};

// The water's velocity at (x, z): along the river, fastest mid-channel; a slow
// drift through the lake toward its outlet; nothing at sea.
export function currentAt(world, x, z) {
  const hit = riverAt(world, x, z);
  if (!hit) {
    if (world.lake.inside(x, z)) return { vx: 0.12, vz: 0.1, speed: 0.15, cls: 0, hit: null };
    return { vx: 0, vz: 0, speed: 0, cls: 0, hit: null };
  }
  const p = hit.sample, half = p.width / 2;
  if (hit.dist > half + 4) return { vx: 0, vz: 0, speed: 0, cls: 0, hit };
  const prof = clamp(1 - (hit.lateral / Math.max(half, 1)) ** 2 * 0.75, 0.12, 1);
  const sp = flowSpeed(p) * prof;
  return { vx: p.tx * sp, vz: p.tz * sp, speed: sp, cls: p.cls, hit };
}

export function makeBoat(kind = "raft", x = 0, z = 0, heading = 0) {
  return {
    kind, spec: BOATS[kind] || BOATS.raft,
    x, z, y: 0, heading, vx: 0, vz: 0, spin: 0,
    stability: 1, hull: 1, swimming: false, airborne: 0,
    stroke: null, strokeT: 0, lastStroke: -1, pitch: 0, roll: 0,
    bumps: 0, flips: 0, distance: 0, line: null,
  };
}

// A paddle stroke: a push along the heading and/or a turn. `power` 0..1.5
// (rhythm judgments scale it).
export function stroke(boat, kind, power = 1, now = 0) {
  if (boat.swimming) return false;
  const S = STROKES[kind], spec = boat.spec;
  if (!S) return false;
  const fx = Math.cos(boat.heading), fz = Math.sin(boat.heading);
  const push = S.push * spec.stroke * power / spec.mass ** 0.3;
  boat.vx += fx * push; boat.vz += fz * push;
  boat.spin += S.yaw * 0.9 * spec.turn * power;
  boat.stroke = kind; boat.strokeT = 0; boat.lastStroke = now;
  return true;
}

// A clean stroke on a rock call: the boat visibly takes the line round it.
// It sets a short-lived "line" that stepBoat follows: a sideways pull (across
// the current) to a lane clear of the rock, held until the boat is past it.
// Without it a judged stroke "clears" a rock the boat then sails through.
export const LINE = { clearance: 0.6, gain: 5, damp: 3, maxAccel: 7, maxTime: 3.5 };
// `call` ("left"/"right") picks the side: +across, (-tz, tx), is river-right
// (screen-right looking downstream), so left is -across. Without one, the
// boat's own side of the rock.
export function dodge(boat, rock, call = null) {
  const cur = boat.current, s = cur && cur.hit && cur.hit.sample;
  const tx = s ? s.tx : Math.cos(boat.heading), tz = s ? s.tz : Math.sin(boat.heading);
  const ax = -tz, az = tx;
  const side = (boat.x - rock.x) * ax + (boat.z - rock.z) * az;
  // Pass on the side the boat is already on; dead centre, take the river's wider side.
  const away = call === "left" ? -1 : call === "right" ? 1 : Math.abs(side) > 0.05 ? Math.sign(side) : -Math.sign(rock.lateral || 1);
  boat.line = { x: rock.x, z: rock.z, tx, tz, off: away * ((rock.r || 1) + boat.spec.beam / 2 + LINE.clearance), t: 0 };
  boat.spin += away * 0.35 * boat.spec.turn;   // the bow swings toward the gap
  return away;
}

function followLine(boat, dt) {
  const L = boat.line;
  L.t += dt;
  const dx = boat.x - L.x, dz = boat.z - L.z;
  const along = dx * L.tx + dz * L.tz;
  if (along > 2.5 || L.t > LINE.maxTime) { boat.line = null; return; }
  const ax = -L.tz, az = L.tx;
  const lat = dx * ax + dz * az, vlat = boat.vx * ax + boat.vz * az;
  // Only push outward: once the boat is wide enough it is left alone.
  const need = L.off > 0 ? Math.max(0, L.off - lat) : Math.min(0, L.off - lat);
  let acc = need * LINE.gain - (need ? vlat * LINE.damp : 0);
  acc = Math.max(-LINE.maxAccel, Math.min(LINE.maxAccel, acc));
  boat.vx += ax * acc * dt; boat.vz += az * acc * dt;
}

// Advance dt seconds. Returns events: [{type: "bank"|"rock"|"drop", ...}]
export function stepBoat(world, boat, dt, features = null) {
  const events = [];
  const spec = boat.spec;
  const cur = currentAt(world, boat.x, boat.z);
  if (boat.line) followLine(boat, dt);
  // Relative velocity in the boat's frame.
  const fx = Math.cos(boat.heading), fz = Math.sin(boat.heading);
  const rx = boat.vx - cur.vx, rz = boat.vz - cur.vz;
  const along = rx * fx + rz * fz, across = rx * -fz + rz * fx;
  const swimDrag = boat.swimming ? 3 : 1;
  const dAlong = along * spec.drag * swimDrag * (1 + Math.abs(along) * 0.12);
  const dAcross = across * spec.side * swimDrag;
  boat.vx -= (fx * dAlong - fz * dAcross) * dt;
  boat.vz -= (fz * dAlong + fx * dAcross) * dt;
  // Cap speed relative to the water.
  const rs = Math.hypot(boat.vx - cur.vx, boat.vz - cur.vz);
  if (rs > spec.top) { const k = spec.top / rs; boat.vx = cur.vx + (boat.vx - cur.vx) * k; boat.vz = cur.vz + (boat.vz - cur.vz) * k; }
  // Turning: damped spin, plus the current turning a boat that sits across it.
  boat.spin -= boat.spin * 2.4 * dt;
  boat.heading += boat.spin * dt;
  // Move, then keep the boat on water.
  let nx = boat.x + boat.vx * dt, nz = boat.z + boat.vz * dt;
  const wet = (x, z) => { const w = waterAt(world, x, z); return !Number.isNaN(w) && heightAt(world, x, z) < w - 0.15; };
  if (!wet(nx, nz)) {
    // Slide along the bank: find the land's normal from the height gradient.
    const e = 1.5, h0 = heightAt(world, nx, nz);
    let gx = heightAt(world, nx + e, nz) - heightAt(world, nx - e, nz);
    let gz = heightAt(world, nx, nz + e) - heightAt(world, nx, nz - e);
    const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;   // uphill = into the bank
    const vin = boat.vx * gx + boat.vz * gz;
    if (vin > 0) {
      const speed = Math.hypot(boat.vx, boat.vz);
      boat.vx -= gx * vin * 1.6; boat.vz -= gz * vin * 1.6;
      boat.vx *= 0.8; boat.vz *= 0.8;
      if (vin > 1.6) events.push({ type: "bank", speed: vin, x: nx, z: nz });
      boat.bumps++;
      void speed; void h0;
    }
    nx = boat.x + boat.vx * dt; nz = boat.z + boat.vz * dt;
    if (!wet(nx, nz)) { nx = boat.x - gx * 0.2; nz = boat.z - gz * 0.2; }
  }
  // Rocks: circles that push the boat out.
  if (features) {
    for (const f of features.near(nx, nz, 8)) {
      if (f.kind !== "rock" || f.cleared) continue;
      const dx = nx - f.x, dz = nz - f.z, d = Math.hypot(dx, dz), R = f.r + spec.beam * 0.5;
      if (d < R) {
        const ux = dx / (d || 1), uz = dz / (d || 1);
        const vin = -(boat.vx * ux + boat.vz * uz);
        if (vin > 0) { boat.vx += ux * vin * 1.5; boat.vz += uz * vin * 1.5; }
        nx = f.x + ux * R; nz = f.z + uz * R;
        if (vin > 0.8) events.push({ type: "rock", speed: vin, feature: f });
        boat.spin += (ux * fz - uz * fx) * vin * 0.6;
      }
    }
  }
  boat.distance += Math.hypot(nx - boat.x, nz - boat.z);
  boat.x = nx; boat.z = nz;
  // Height: follow the water, with a little lag so drops feel like drops.
  const w = waterAt(world, boat.x, boat.z);
  const target = Number.isNaN(w) ? boat.y : w;
  if (target < boat.y - 1.2) { boat.airborne += dt; boat.y = lerp(boat.y, target, clamp(dt * 3, 0, 1)); if (boat.airborne > 0.25 && !boat.dropFlag) { events.push({ type: "drop", height: boat.y - target }); boat.dropFlag = true; } }
  else { boat.y = lerp(boat.y, target, clamp(dt * 10, 0, 1)); boat.airborne = 0; boat.dropFlag = false; }
  // Pitch and roll from rough water.
  const t = (boat.t || 0) + dt; boat.t = t;
  const rough = cur.cls >= 2 ? (cur.cls - 1) * 0.04 : 0.008;
  boat.pitch = Math.sin(t * 3.1) * rough + Math.sin(t * 5.3) * rough * 0.5;
  boat.roll = Math.sin(t * 2.3 + 1) * rough + boat.spin * -0.06;
  boat.strokeT += dt;
  // Stability recovers on calm water.
  if (cur.cls <= 1 && !boat.swimming) boat.stability = Math.min(1, boat.stability + dt * 0.08);
  boat.current = cur;
  return events;
}

// A spatial hash over features for fast "near" queries.
export function featureIndex(features, cellSize = 16) {
  const map = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const f of features) {
    const k = key(Math.floor(f.x / cellSize), Math.floor(f.z / cellSize));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  return {
    all: features,
    near(x, z, r) {
      const out = [];
      const i0 = Math.floor((x - r) / cellSize), i1 = Math.floor((x + r) / cellSize);
      const j0 = Math.floor((z - r) / cellSize), j1 = Math.floor((z + r) / cellSize);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const l = map.get(key(i, j));
        if (l) for (const f of l) out.push(f);
      }
      return out;
    },
  };
}

// Low-poly boats in their own space: x forward (bow at +x), y up, z to
// starboard. Each has a paddler; the paddle is its own mesh so it can swing.
import { MeshBuilder } from "./meshes.js";

const SKIN = [0.78, 0.55, 0.4], JACKET = [0.95, 0.42, 0.08], HELMET = [0.95, 0.85, 0.15], DARK = [0.08, 0.08, 0.1];

function paddler(b, x, y, z, jacket = JACKET, helmet = HELMET) {
  b.box(x, y + 0.35, z, 0.16, 0.32, 0.22, jacket);          // torso + PFD
  b.box(x + 0.02, y + 0.78, z, 0.11, 0.12, 0.11, SKIN);      // head
  b.box(x + 0.0, y + 0.9, z, 0.14, 0.06, 0.14, helmet);      // helmet
  b.box(x + 0.15, y + 0.42, z - 0.2, 0.2, 0.05, 0.05, jacket); // arms
  b.box(x + 0.15, y + 0.42, z + 0.2, 0.2, 0.05, 0.05, jacket);
}

// Hull from a profile: stations along x with half-beam and depth.
function hull(b, stations, color, rim) {
  const top = 0.18;
  for (let i = 0; i < stations.length - 1; i++) {
    const [x0, w0, d0] = stations[i], [x1, w1, d1] = stations[i + 1];
    const L0 = [x0, top, -w0], R0 = [x0, top, w0], K0 = [x0, -d0, 0], L1 = [x1, top, -w1], R1 = [x1, top, w1], K1 = [x1, -d1, 0];
    b.poly([R0, R1, K1, K0], color);   // starboard side
    b.poly([L0, K0, K1, L1], color);   // port side
    b.poly([L0, L1, R1, R0], rim);     // deck / cockpit top
  }
}

// A paddler on foot, origin at the feet, facing +x. withLegs=false leaves the
// legs out (the local walker swings its own leg meshes).
export function personMesh(colour, withLegs = true) {
  const b = new MeshBuilder();
  const pants = [0.18, 0.2, 0.26];
  if (withLegs) { b.box(0, 0.45, -0.12, 0.09, 0.45, 0.09, pants); b.box(0, 0.45, 0.12, 0.09, 0.45, 0.09, pants); }
  b.box(0, 1.2, 0, 0.17, 0.32, 0.26, colour);                   // torso + PFD
  b.box(0.02, 1.62, 0, 0.12, 0.13, 0.12, SKIN);                  // head
  b.box(0, 1.76, 0, 0.15, 0.06, 0.15, HELMET);                   // helmet
  b.box(0, 1.15, -0.34, 0.07, 0.3, 0.07, colour);                // arms
  b.box(0, 1.15, 0.34, 0.07, 0.3, 0.07, colour);
  b.box(-0.2, 1.25, 0, 0.06, 0.25, 0.2, [0.25, 0.25, 0.3]);     // a small pack
  return b.build();
}

export function legMesh() {
  const b = new MeshBuilder();
  b.box(0, -0.45, 0, 0.09, 0.45, 0.09, [0.18, 0.2, 0.26]);       // hangs from the hip
  b.box(0.06, -0.88, 0, 0.14, 0.05, 0.1, [0.12, 0.1, 0.08]);     // boot
  return b.build();
}

export function boatMesh(kind, colour) {
  if (kind === "walker") return personMesh(colour);
  const b = new MeshBuilder();
  const c = colour, rim = [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];
  if (kind === "raft") {
    const L = 2.1, W = 1.0, r = 0.26;
    // Tubes: four boxes making a ring, upturned at the ends.
    b.box(0, 0.05, -W + r, L - 0.2, r, r, c);
    b.box(0, 0.05, W - r, L - 0.2, r, r, c);
    b.box(L - r, 0.18, 0, r, r, W - 0.02, c, 0);
    b.box(-L + r, 0.18, 0, r, r, W - 0.02, c, 0);
    b.box(0, -0.12, 0, L - 0.25, 0.06, W - 0.25, [0.12, 0.12, 0.14]); // floor
    b.box(0.6, 0.1, 0, 0.12, 0.12, W - 0.35, rim);  // thwarts
    b.box(-0.6, 0.1, 0, 0.12, 0.12, W - 0.35, rim);
    paddler(b, 0.9, 0.15, -0.62); paddler(b, 0.9, 0.15, 0.62, [0.1, 0.45, 0.85]);
    paddler(b, -0.3, 0.15, -0.62, [0.2, 0.7, 0.3]); paddler(b, -0.3, 0.15, 0.62);
    paddler(b, -1.55, 0.2, 0, [0.85, 0.1, 0.15], [0.9, 0.9, 0.9]); // the guide at the stern
  } else if (kind === "kayak") {
    hull(b, [[1.8, 0.02, 0.05], [1.2, 0.22, 0.17], [0.2, 0.34, 0.22], [-0.6, 0.32, 0.2], [-1.4, 0.2, 0.14], [-1.8, 0.02, 0.05]], c, c);
    b.box(-0.1, 0.2, 0, 0.42, 0.04, 0.24, DARK);  // spray skirt
    paddler(b, -0.15, 0.12, 0, [0.1, 0.4, 0.8]);
  } else if (kind === "canoe") {
    hull(b, [[2.5, 0.03, 0.12], [1.8, 0.32, 0.3], [0.6, 0.47, 0.36], [-0.6, 0.47, 0.36], [-1.8, 0.32, 0.3], [-2.5, 0.03, 0.12]], c, [0.55, 0.38, 0.2]);
    b.box(0.6, 0.12, 0, 0.06, 0.04, 0.44, [0.55, 0.38, 0.2]);
    b.box(-0.9, 0.12, 0, 0.06, 0.04, 0.44, [0.55, 0.38, 0.2]);
    b.box(-0.1, 0.12, 0, 0.35, 0.15, 0.3, [0.45, 0.3, 0.18]);  // cargo pack
    paddler(b, 1.3, 0.0, 0, [0.85, 0.3, 0.1]); paddler(b, -1.5, 0.0, 0, [0.15, 0.45, 0.8]);
  } else {
    // dory: high flared bow and stern
    hull(b, [[2.8, 0.12, 0.2], [2.0, 0.62, 0.42], [0.6, 0.86, 0.5], [-0.8, 0.86, 0.5], [-2.0, 0.66, 0.42], [-2.7, 0.3, 0.25]], c, [0.92, 0.9, 0.85]);
    b.box(2.6, 0.38, 0, 0.18, 0.2, 0.12, c);
    b.box(-2.55, 0.38, 0, 0.14, 0.2, 0.3, c);
    b.box(0.4, 0.15, 0, 0.1, 0.05, 0.82, [0.92, 0.9, 0.85]);
    b.box(-1.2, 0.15, 0, 0.1, 0.05, 0.82, [0.92, 0.9, 0.85]);
    paddler(b, -0.3, 0.05, 0, [0.7, 0.15, 0.15]);
    b.box(-0.3, 0.55, -0.9, 1.4, 0.03, 0.03, [0.6, 0.45, 0.25]);  // oars at rest
    b.box(-0.3, 0.55, 0.9, 1.4, 0.03, 0.03, [0.6, 0.45, 0.25]);
  }
  return b.build();
}

// A double-bladed (kayak) or single paddle, centred at the grip.
export function paddleMesh(kind) {
  const b = new MeshBuilder();
  const shaft = [0.55, 0.42, 0.25], blade = [0.95, 0.95, 0.95];
  if (kind === "kayak") {
    b.box(0, 0, 0, 0.03, 0.03, 1.1, shaft);
    b.box(0, 0, 1.15, 0.12, 0.02, 0.22, blade);
    b.box(0, 0, -1.15, 0.12, 0.02, 0.22, blade);
  } else {
    b.box(0, 0, 0, 0.03, 0.03, 0.75, shaft);
    b.box(0, 0, 0.85, 0.11, 0.02, 0.24, blade);
  }
  return b.build();
}

// Column-major model matrix: translate, yaw (forward = (cos h, 0, sin h)), pitch, roll, scale.
export function boatMatrix(x, y, z, heading, pitch = 0, roll = 0, s = 1, out = new Float32Array(16)) {
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Local basis before yaw: X' = (cp, sp, 0), then roll about X'.
  // Build R = Yaw * Pitch(about z) * Roll(about x).
  // Pitch about local z: X -> (cp, sp, 0), Y -> (-sp, cp, 0)
  // Roll about local x: Y -> (0, cr, sr), Z -> (0, -sr, cr)
  const X = [cp, sp, 0];
  const Y = [-sp * cr, cp * cr, sr];
  const Z = [sp * sr, -cp * sr, cr];
  // Yaw: local x -> (ch, 0, sh), local z -> (-sh, 0, ch), y -> y
  const yaw = (v) => [v[0] * ch - v[2] * sh, v[1], v[0] * sh + v[2] * ch];
  const Xw = yaw(X), Yw = yaw(Y), Zw = yaw(Z);
  out[0] = Xw[0] * s; out[1] = Xw[1] * s; out[2] = Xw[2] * s; out[3] = 0;
  out[4] = Yw[0] * s; out[5] = Yw[1] * s; out[6] = Yw[2] * s; out[7] = 0;
  out[8] = Zw[0] * s; out[9] = Zw[1] * s; out[10] = Zw[2] * s; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

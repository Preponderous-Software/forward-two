// Boats and crew: stroke phase maths, who paddles where, the pose matrices,
// and the rig's mesh budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  strokeCurve, strokePhase, seatAction, bladeAt, approach, turnLean, waterMotion, sprayLevel, wakePoints,
  CREW, READY, STROKE_SECONDS, crewPose, turnStroke, swimPose, downstream, SWIM_TILT, AutoStroker, mat, mul, apply, invRigid, paddleMatrix, oarMatrix, bodyMatrix,
} from "../web/src/render/crew.js";
import { boatMesh, BoatRig, personMesh, boatMatrix } from "../web/src/render/boats.js";
import { makeBoat, stroke, BOATS } from "../web/src/sim/boat.js";

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test("a stroke starts and ends at the ready pose, so idle hands off without a jump", () => {
  assert.deepEqual(strokeCurve(-1), { sweep: READY, dip: 0 });
  const a = strokeCurve(0), z = strokeCurve(0.99999);
  assert.ok(near(a.sweep, READY) && near(a.dip, 0));
  assert.ok(near(z.sweep, READY, 1e-3) && near(z.dip, 0));
  // Continuous: no step bigger than a small fraction between close phases.
  for (let p = 0; p < 0.999; p += 0.001) {
    const c0 = strokeCurve(p), c1 = strokeCurve(p + 0.001);
    assert.ok(Math.abs(c1.sweep - c0.sweep) < 0.05 && Math.abs(c1.dip - c0.dip) < 0.05, `jump at ${p}`);
    assert.ok(c0.sweep >= -1 && c0.sweep <= 1 && c0.dip >= 0 && c0.dip <= 1);
  }
});

test("the drive pulls the buried blade from the bow to the stern", () => {
  let last = Infinity;
  for (let p = 0.18; p < 0.68; p += 0.01) {
    const c = strokeCurve(p);
    assert.equal(c.dip, 1);
    assert.ok(c.sweep <= last + 1e-9);
    last = c.sweep;
  }
  assert.ok(strokeCurve(0.2).sweep > 0.9 && strokeCurve(0.66).sweep < -0.9);
  // The blade is out of the water on the recovery.
  for (let p = 0.81; p < 1; p += 0.02) assert.equal(strokeCurve(p).dip, 0);
});

test("stroke phase runs 0..1 over the boat's stroke time, then idles", () => {
  assert.equal(strokePhase(0, 0.8), 0);
  assert.ok(near(strokePhase(0.4, 0.8), 0.5));
  assert.equal(strokePhase(0.8, 0.8), -1);
  assert.equal(strokePhase(NaN, 0.8), -1);
  assert.equal(strokePhase(0.1, 0), -1);
  for (const k of Object.keys(BOATS)) assert.ok(STROKE_SECONDS[k] > 0.3 && STROKE_SECONDS[k] < 1.2, k);
});

test("a back stroke mirrors the sweep: catch aft, push forward", () => {
  const f = bladeAt("fwd", 0.3, 1), b = bladeAt("back", 0.3, 1);
  assert.ok(near(f.sweep, -b.sweep) && near(f.dip, b.dip));
  assert.deepEqual(bladeAt("idle", 0.3, 1), { sweep: READY, dip: 0 });
});

// Screen terms: the chase camera sits behind the boat at yaw atan2(-sin h, -cos h),
// and Strata's screen-right is (sin yaw, -cos yaw) on the ground.
const screenRight = (h) => { const y = Math.atan2(-Math.sin(h), -Math.cos(h)); return [Math.sin(y), -Math.cos(y)]; };
const sideOnScreen = (h, side) => { const p = apply(mat(0, 0, 0, h, 0, 0), [0, 0, side]), r = screenRight(h); return Math.sign(p[0] * r[0] + p[2] * r[1]); };

test("a left turn: the bow swings screen-left, right-side paddlers pull forward, left-side back", () => {
  for (const h of [0, 0.9, -2.3, 3]) {
    // The sim: a left stroke swings the bow to screen-left.
    const b = makeBoat("raft", 0, 0, h);
    stroke(b, "left");
    const r = screenRight(h), d = b.spin * 0.1;
    const bow = [Math.cos(h + d) - Math.cos(h), Math.sin(h + d) - Math.sin(h)];
    assert.ok(bow[0] * r[0] + bow[1] * r[1] < 0, "left swings the bow screen-left");
    // Crew side +1 is screen-right from the chase camera.
    assert.equal(sideOnScreen(h, 1), 1);
    assert.equal(sideOnScreen(h, -1), -1);
  }
  const right = { type: "single", side: 1 }, left = { type: "single", side: -1 };
  assert.equal(seatAction(right, "left").mode, "fwd");
  assert.equal(seatAction(left, "left").mode, "back");
  assert.equal(seatAction(right, "right").mode, "back");
  assert.equal(seatAction(left, "right").mode, "fwd");
  assert.equal(seatAction(right, "forward").mode, "fwd");
  assert.equal(seatAction(left, "back").mode, "back");
  assert.equal(seatAction(left, null).mode, "idle");
  // The raft's right-side paddlers really sit on the screen-right.
  for (const seat of CREW.raft.filter((x) => x.z)) assert.equal(Math.sign(seat.z), seat.side);
  // Kayak: alternate on forward strokes; a left turn sweeps on the outside (right).
  const kayak = CREW.kayak[0];
  assert.notEqual(seatAction(kayak, "forward", 0).side, seatAction(kayak, "forward", 1).side);
  assert.equal(seatAction(kayak, "left", 0).side, 1);
  assert.equal(seatAction(kayak, "left", 1).side, 1);
  assert.equal(seatAction(kayak, "right", 0).side, -1);
  // Dory: a left pivot pulls the right oar and pushes the left.
  const oars = seatAction(CREW.dory[0], "left");
  assert.equal(oars.starboard, "fwd"); assert.equal(oars.port, "back");
  assert.equal(seatAction(CREW.dory[1], "forward").mode, "idle");
});

test("the crew leans into the turn, toward the inside on screen", () => {
  for (const h of [0, 1.2, -2]) {
    const b = makeBoat("kayak", 0, 0, h);
    stroke(b, "left");                         // turning left: inside is screen-left
    const lean = turnLean(b.spin), seat = CREW.kayak[0];
    const pose = crewPose(seat, { mode: "idle", side: 1 }, { sweep: READY, dip: 0 }, { lean });
    const head = apply(mul(mat(0, 0, 0, h, 0, 0), bodyMatrix(seat, pose)), [0, 0.68, 0]);
    const r = screenRight(h);
    assert.ok(head[0] * r[0] + head[2] * r[1] < -0.05, "head tips screen-left in a left turn");
  }
});

test("every boat kind seats a crew inside its hull", () => {
  for (const [kind, spec] of Object.entries(BOATS)) {
    const seats = CREW[kind];
    assert.ok(seats && seats.length, kind);
    for (const s of seats) {
      assert.ok(Math.abs(s.x) < spec.len / 2, `${kind} seat x`);
      assert.ok(Math.abs(s.z) < spec.beam / 2, `${kind} seat z`);
    }
  }
});

test("matrices: mat matches boatMatrix, mul composes and invRigid undoes", () => {
  const a = mat(1, 2, 3, 0.4, -0.2, 0.3), b = boatMatrix(1, 2, 3, 0.4, -0.2, 0.3);
  for (let i = 0; i < 16; i++) assert.ok(near(a[i], b[i]));
  const p = [0.3, -0.7, 1.1];
  const back = apply(invRigid(a), apply(a, p));
  p.forEach((v, i) => assert.ok(near(back[i], v, 1e-5)));
  const c = mat(-2, 0.5, 0, -1.1, 0.2, 0);
  const viaMul = apply(mul(a, c), p), stepwise = apply(a, apply(c, p));
  viaMul.forEach((v, i) => assert.ok(near(v, stepwise[i], 1e-5)));
  // Heading 0 keeps x forward; positive yaw turns x toward +z.
  const f = apply(mat(0, 0, 0, 0.5, 0, 0), [1, 0, 0]);
  assert.ok(f[2] > 0);
});

test("single blades reach forward at the catch, dig in, and go out over the water", () => {
  for (const seat of [...CREW.raft, ...CREW.canoe]) {
    const act = { mode: "fwd", side: seat.side };
    const toBoat = (blade) => {
      const pose = crewPose(seat, act, blade);
      const M = mul(bodyMatrix(seat, pose), paddleMatrix(pose));
      return apply(M, [0, -seat.len + 0.12, 0]);
    };
    const c = toBoat({ sweep: 1, dip: 1 }), e = toBoat({ sweep: -1, dip: 1 }), r = toBoat({ sweep: READY, dip: 0 });
    assert.ok(c[0] > e[0] + 0.3, `catch ahead of exit (${seat.x})`);
    assert.ok(c[1] < -0.15 && e[1] < -0.15, `blade under the water line (${c[1].toFixed(2)}, ${e[1].toFixed(2)})`);
    assert.ok(r[1] > c[1] + 0.2, "recovery lifts the blade");
    assert.ok(Math.sign(c[2]) === seat.side && Math.abs(c[2]) > Math.abs(seat.z), "blade outboard on the paddler's side");
  }
});

test("a kayak blade dips on its stroke side; dory oars sweep and feather", () => {
  const seat = CREW.kayak[0];
  for (const s of [-1, 1]) {
    const pose = crewPose(seat, { mode: "fwd", side: s }, { sweep: 0.8, dip: 1 });
    const M = mul(bodyMatrix(seat, pose), paddleMatrix(pose));
    const wet = apply(M, [0, 0, 1.1 * s]), dry = apply(M, [0, 0, -1.1 * s]);
    assert.ok(wet[1] < -0.15, `wet blade ${wet[1].toFixed(2)}`);
    assert.ok(dry[1] > 0.5, "the other blade is up in the air");
  }
  const dory = CREW.dory[0];
  const at = (blade) => crewPose(dory, { mode: "row", port: "fwd", starboard: "fwd" }, blade).oars.starboard;
  const tip = (o) => apply(oarMatrix(o), [0, 0, 2.2]);
  const c = tip(at({ sweep: 1, dip: 1 })), e = tip(at({ sweep: -1, dip: 1 })), r = tip(at({ sweep: READY, dip: 0 }));
  assert.ok(c[0] > e[0] + 0.5 && c[1] < -0.15 && r[1] > c[1] + 0.3);
  assert.ok(at({ sweep: 0, dip: 0 }).feather > 1 && at({ sweep: 0, dip: 1 }).feather === 0);
});

test("the crew leans into turns, capped; the water heaves more in rapids", () => {
  assert.ok(turnLean(1) > 0 && turnLean(-1) < 0);
  assert.ok(Math.abs(turnLean(50)) <= 0.28 + 1e-9);
  let calm = 0, rough = 0;
  for (let t = 0; t < 20; t += 0.05) { calm = Math.max(calm, Math.abs(waterMotion(t, 0).heave)); rough = Math.max(rough, Math.abs(waterMotion(t, 3).heave)); }
  assert.ok(rough > calm * 3);
  assert.ok(near(approach(0, 1, 10, 0), 0) && approach(0, 1, 10, 1) > 0.99);
  assert.equal(sprayLevel(0), 0);
  assert.ok(sprayLevel(5) > sprayLevel(2));
  assert.equal(wakePoints(0, 0.2, 0.5).length, 0);
  const w = wakePoints(3.3, 4, 0.5);
  assert.ok(w.length === 5 && w.every((p) => p.along >= 0 && p.along <= 7 && p.out > 0 && p.fade >= 0 && p.fade <= 1));
});

test("boats we only see as positions paddle on their own", () => {
  const a = new AutoStroker(0.7);
  let strokes = 0, last = 0, turns = 0;
  for (let i = 0; i < 300; i++) {
    const s = a.update(1 / 60, 2.5, i > 200 ? 0.8 : 0);
    if (s.count !== last) { strokes++; last = s.count; if (s.stroke === turnStroke(0.8)) turns++; }
  }
  assert.ok(strokes >= 4 && strokes <= 7, `strokes ${strokes}`);
  assert.ok(turns >= 1);
  const still = new AutoStroker(0.7);
  for (let i = 0; i < 300; i++) still.update(1 / 60, 0, 0);
  assert.equal(still.count, 0);
});

test("meshes are well formed and phone sized", () => {
  for (const kind of [...Object.keys(BOATS), "walker"]) {
    const m = boatMesh(kind, [0.8, 0.3, 0.1]);
    const nv = m.positions.length / 3, tris = m.indices.length / 3;
    assert.ok(tris > 100 && tris < 3500, `${kind}: ${tris} triangles`);
    assert.ok(m.indices.every((i) => i < nv));
    assert.ok(m.normals.every(Number.isFinite) && m.positions.every(Number.isFinite));
  }
  assert.ok(personMesh([1, 0, 0], false).indices.length > 0);
});

test("the rig paddles with the player's strokes and stays within its meshes", () => {
  for (const kind of Object.keys(BOATS)) {
    const live = new Map(), moves = new Map();
    const bridge = {
      mesh(m) { const s = live.size + moves.size + 100; live.set(s, m); return s; },
      removeMesh(s) { live.delete(s); }, visible() {},
      transform(s, m) { assert.ok(m.every(Number.isFinite)); moves.set(s, Array.from(m)); },
    };
    const full = new BoatRig(bridge, kind, BOATS[kind].colour);
    assert.equal(full.count, 1 + 3 + CREW[kind].reduce((n, s) => n + (s.type === "rider" ? 1 : s.type === "oars" ? 3 : 2), 0));
    const lite = new BoatRig(bridge, kind, BOATS[kind].colour, { level: "lite", ghost: true });
    assert.equal(lite.count, 2);
    for (const s of lite.slots) assert.equal(live.get(s).flags & 2, 2, "ghost meshes are translucent");
    const boat = makeBoat(kind, 10, 20, 0.3);
    boat.y = 5;
    const snap = () => full.slots.map((s) => moves.get(s)?.join());
    full.drive(boat, 1 / 60);
    const idle = snap();
    stroke(boat, "forward", 1, 1);
    boat.strokeT = 0.3;
    full.drive(boat, 1 / 60); full.drive(boat, 1 / 60);
    const mid = snap();
    assert.ok(mid.slice(1).some((m, i) => m !== idle[i + 1]), `${kind}: the crew moves on a stroke`);
    const pts = { rows: [], push(...v) { this.rows.push(v); } };
    boat.vx = 4; full.drive(boat, 1 / 60); full.fx(pts, 1);
    assert.ok(pts.rows.length > 4 && pts.rows.every((r) => r.length === 10 && r.every(Number.isFinite)));
    lite.drive({ x: 0, y: 1, z: 0, h: 0.2, vx: 2, vz: 0 }, 1 / 60);
    full.dispose(); lite.dispose();
    assert.equal(live.size, 0);
  }
});

test("a swimmer lies back, head up and feet downstream, and bobs", () => {
  const body = mat(0, -0.22, 0, 0, SWIM_TILT, 0);
  const head = apply(body, [0.02, 0.68, 0]), hips = apply(body, [0, 0, 0]);
  assert.ok(head[1] > 0.08, `head out of the water (${head[1].toFixed(2)})`);
  assert.ok(head[0] < hips[0], "head upstream of the hips, feet downstream");
  let lo = Infinity, hi = -Infinity, sc = [];
  for (let t = 0; t < 6; t += 0.05) { const p = swimPose(t, 2); lo = Math.min(lo, p.heave); hi = Math.max(hi, p.heave); sc.push(p.scull); }
  assert.ok(hi - lo > 0.1 && hi < 0.4 && lo > -0.4);
  assert.ok(Math.max(...sc) > 0.3 && Math.min(...sc) < -0.3, "arms scull both ways");
  assert.ok(near(downstream({ speed: 2, vx: 0, vz: 3 }, 1), Math.PI / 2));
  assert.equal(downstream({ speed: 0.1, vx: 1, vz: 0 }, 0.7), 0.7);
  assert.equal(downstream(null, 0.7), 0.7);
});

test("a flip hides the crew and shows the swimmer; climbing back in reverses it", () => {
  const vis = new Map(), moved = new Set();
  let n = 0;
  const bridge = { mesh() { return n++; }, removeMesh() {}, visible(s, v) { vis.set(s, v); }, transform(s) { moved.add(s); } };
  const rig = new BoatRig(bridge, "raft", BOATS.raft.colour);
  const swim = [...rig.swimSlots];
  const boat = makeBoat("raft", 0, 0, 0); boat.y = 2;
  rig.drive(boat, 1 / 60);
  assert.ok(swim.every((s) => vis.get(s) === false));
  boat.swimming = true; moved.clear();
  rig.drive(boat, 1 / 60);
  assert.ok(swim.every((s) => vis.get(s) === true && moved.has(s)));
  assert.equal(vis.get(rig.parts[0].body), false);
  assert.equal(vis.get(rig.hull) ?? true, true);
  rig.setVisible(false);
  assert.ok(rig.slots.every((s) => vis.get(s) === false));
  rig.setVisible(true);
  assert.ok(swim.every((s) => vis.get(s) === true) && vis.get(rig.parts[0].body) === false);
  boat.swimming = false;
  rig.drive(boat, 1 / 60);
  assert.ok(swim.every((s) => vis.get(s) === false) && vis.get(rig.parts[0].body) === true);
});

test("an upturned hull floats bottom up, its top above the water", () => {
  for (const kind of Object.keys(BOATS)) {
    const meshes = new Map(), mats = new Map();
    let n = 0;
    const bridge = { mesh(m) { meshes.set(n, m); return n++; }, removeMesh() {}, visible() {}, transform(s, m) { mats.set(s, Float32Array.from(m)); } };
    const rig = new BoatRig(bridge, kind, BOATS[kind].colour);
    const boat = makeBoat(kind, 0, 0, 0.4); boat.y = 3; boat.swimming = true;
    for (let i = 0; i < 40; i++) {
      rig.drive(boat, 1 / 20);
      const M = mats.get(rig.hull), P = meshes.get(rig.hull).positions;
      let top = -Infinity;
      for (let k = 0; k < P.length; k += 3) top = Math.max(top, apply(M, [P[k], P[k + 1], P[k + 2]])[1]);
      assert.ok(top > boat.y + 0.1, `${kind}: upturned hull top ${(top - boat.y).toFixed(2)} m above water`);
      assert.ok(M[5] < -0.8, `${kind}: upside down`);
      if (kind === "raft") assert.ok(apply(M, [0, -0.14, 0])[1] > boat.y, "the raft's floor is out of the water");
    }
  }
});

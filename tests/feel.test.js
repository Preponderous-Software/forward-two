// Feel: the guide's judging, the chase camera's framing, input mapping and
// the boat's response, checked as plain numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Caller, WINDOW, judgmentFor, HIT } from "../web/src/sim/rapids.js";
import { chaseTargets, smoothstep } from "../web/src/game/camera.js";

const caller = (calls) => {
  const c = new Caller([], []);
  c.calls = calls.map(([call, time]) => ({ feature: null, call, time, state: "pending" }));
  return c;
};

test("judgmentFor: perfect, good, then early or late, then miss", () => {
  assert.equal(judgmentFor(0), "perfect");
  assert.equal(judgmentFor(-WINDOW.perfect), "perfect");
  assert.equal(judgmentFor(0.15), "good");
  assert.equal(judgmentFor(-0.25), "early");
  assert.equal(judgmentFor(0.25), "late");
  assert.equal(judgmentFor(0.31), "miss");
  for (const j of ["perfect", "good", "early", "late"]) assert.ok(HIT.has(j));
  assert.ok(!HIT.has("wrong") && !HIT.has("miss"));
});

test("an early stroke is called early, and still counts as a hit", () => {
  const c = caller([["forward", 10]]);
  const v = c.judge("forward", 10 - 0.25);
  assert.equal(v.judgment, "early");
  assert.equal(c.streak, 1);
  assert.equal(c.stats.good, 1);
});

test("overlapping windows: the stroke that matches the next call is judged on it, not 'wrong' on the last", () => {
  // Class V: calls 0.55 s apart, so a stroke between them is inside both windows.
  const c = caller([["left", 10], ["right", 10.55]]);
  const v = c.judge("right", 10.28);
  assert.equal(v.call.call, "right");
  assert.equal(v.judgment, "early");
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].call, "left");
  assert.equal(c.stats.miss, 0);
});

test("a stroke matching nothing open is wrong on the earliest open call", () => {
  const c = caller([["left", 10], ["right", 10.55]]);
  const v = c.judge("back", 10.05);
  assert.equal(v.judgment, "wrong");
  assert.equal(v.call.call, "left");
  assert.equal(c.flow, 0);
});

test("with two matching calls open, the closer one is taken", () => {
  const c = caller([["forward", 10], ["forward", 10.5]]);
  assert.equal(c.judge("forward", 10.4).call.time, 10.5);
});

test("a stroke with no open window is not judged", () => {
  const c = caller([["forward", 10]]);
  assert.equal(c.judge("forward", 9), null);
  assert.equal(c.calls.length, 1);
});

const boat = (o) => ({ heading: 0, vx: 0, vz: 0, kind: "raft", current: null, ...o });

test("camera: at rest it looks along the heading, at speed along the travel", () => {
  const still = chaseTargets(boat({ heading: Math.PI / 2 }));
  assert.ok(Math.abs(still.dx) < 1e-9 && Math.abs(still.dz - 1) < 1e-9);
  const fast = chaseTargets(boat({ heading: Math.PI / 2, vx: 4, vz: 0 }));
  assert.ok(Math.abs(fast.dx - 1) < 1e-9);
});

test("camera: the look direction changes smoothly with speed (no snap)", () => {
  let prev = null, worst = 0;
  for (let sp = 0; sp <= 4; sp += 0.05) {
    const t = chaseTargets(boat({ heading: Math.PI / 2, vx: sp, vz: 0 }));
    const a = Math.atan2(t.dz, t.dx);
    if (prev != null) worst = Math.max(worst, Math.abs(a - prev));
    prev = a;
  }
  assert.ok(worst < 0.12, `largest step ${worst}`);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
});

test("camera: in a rapid it frames downstream, higher and further back, even while the boat spins", () => {
  const cur = { cls: 4, hit: { sample: { tx: 1, tz: 0 } } };
  const flat = chaseTargets(boat({ heading: 0, vx: 3, current: { cls: 0, hit: { sample: { tx: 1, tz: 0 } } } }));
  const spun = chaseTargets(boat({ heading: 1.2, vx: 0.5, vz: 0.5, current: cur }), true);
  assert.ok(spun.dx > 0.85, `looks downstream: ${spun.dx}`);
  const run = chaseTargets(boat({ heading: 0, vx: 3, current: cur }), true);
  assert.ok(run.pitch > flat.pitch && run.dist > flat.dist);
  // Ferrying upstream: the camera keeps the boat's own view.
  const up = chaseTargets(boat({ heading: Math.PI, current: cur }), true);
  assert.ok(up.dx < -0.9);
});

test("input: keys map to strokes and actions; pad buttons, D-pad, sticks and triggers to strokes", async () => {
  globalThis.matchMedia ??= () => ({ matches: false });
  const { KEYS, KEY_ACTIONS, padStrokes, PAD_ACTIONS, HAPTIC } = await import("../web/src/ui/input.js");
  assert.equal(KEYS.KeyW, "forward"); assert.equal(KEYS.Space, "forward"); assert.equal(KEYS.ArrowLeft, "left");
  assert.equal(KEY_ACTIONS.KeyE, "interact"); assert.equal(KEY_ACTIONS.Digit2, "emote:flare");
  const none = padStrokes([0, 0], []);
  assert.deepEqual(none, { forward: false, back: false, left: false, right: false });
  assert.equal(padStrokes([0.3, -0.3], []).forward, false, "inside the deadzone");
  assert.deepEqual(padStrokes([-0.9, -0.9], []), { forward: true, back: false, left: true, right: false });
  const btn = (...i) => { const p = []; for (const k of i) p[k] = true; return p; };
  assert.equal(padStrokes([], btn(12)).forward, true);
  assert.equal(padStrokes([], btn(13)).back, true);
  assert.equal(padStrokes([], btn(7)).forward, true);
  assert.equal(padStrokes([], btn(5)).right, true);
  assert.equal(PAD_ACTIONS[2], "interact");
  // Every judgment the HUD can show has a haptic pattern.
  for (const j of ["perfect", "good", "early", "late", "miss", "wrong"]) assert.ok(Array.isArray(HAPTIC[j]));
});

test("coach: paddle → turn → explore → (first rapid) → ashore → done, from what the player does", async () => {
  const { Coach, FIRST_RAPID_LENIENCY } = await import("../web/src/game/coach.js");
  const c = new Coach();
  const snap = (o) => ({ moved: 0, speed: 1, inRapid: false, leftRapid: false, hits: 0, walking: false, found: false, panel: false, ...o });
  assert.equal(c.step(snap({ walking: true }), 0.1), "paddle", "going ashore does not skip learning to paddle");
  for (let i = 0; i < 3; i++) c.step(snap({ stroke: "forward" }), 0.1);
  assert.equal(c.state, "turn");
  c.step(snap({ stroke: "left" }), 0.1); c.step(snap({ stroke: "right" }), 0.1);
  assert.equal(c.state, "turn");
  c.step(snap({ stroke: "left" }), 0.1);
  assert.equal(c.state, "explore");
  // The first rapid: a tip in the lane and wider windows until it is run.
  assert.equal(c.leniency(), FIRST_RAPID_LENIENCY);
  c.step(snap({ inRapid: true }), 0.1);
  assert.ok(c.rapidTip);
  c.step(snap({ inRapid: true, hits: 3 }), 0.1);
  assert.ok(!c.rapidTip, "the tip goes once the player has the idea");
  c.step(snap({ leftRapid: true, campAhead: 300 }), 0.1);
  assert.equal(c.state, "ashore");
  assert.equal(c.leniency(), 1);
  c.step(snap({ walking: true }), 0.1);
  assert.equal(c.state, "done");
});

test("coach: moving far also counts as paddling; when done, a still boat gets a hint, with a cooldown", async () => {
  const { Coach, IDLE_HINT, HINT_COOLDOWN } = await import("../web/src/game/coach.js");
  const c = new Coach();
  c.step({ moved: 40, speed: 2 }, 0.1);
  assert.equal(c.state, "turn");
  const d = new Coach("done");
  const still = { moved: 0, speed: 0, inRapid: false, walking: false, found: false, panel: false };
  for (let t = 0; t < IDLE_HINT - 1; t += 0.5) d.step(still, 0.5);
  assert.equal(d.hint, null);
  for (let t = 0; t < 2; t += 0.5) d.step(still, 0.5);
  assert.ok(d.hint, "a hint after sitting still");
  for (let t = 0; t < 10; t += 0.5) d.step(still, 0.5);
  assert.equal(d.hint, null, "the hint times out");
  for (let t = 0; t < HINT_COOLDOWN - 20; t += 0.5) d.step(still, 0.5);
  assert.equal(d.hint, null, "and does not nag");
  // A panel open (reading the map) is not idling.
  const e = new Coach("done");
  for (let t = 0; t < 60; t += 0.5) e.step({ ...still, panel: true }, 0.5);
  assert.equal(e.hint, null);
});

test("coach: bearing is screen-relative, and nextAhead picks the nearest unfound thing downstream", async () => {
  const { bearing, nextAhead, Coach } = await import("../web/src/game/coach.js");
  // Camera yaw π: the eye sits at -x, looking toward +x.
  assert.ok(Math.abs(bearing(Math.PI, 0, 0, 10, 0)) < 1e-9, "straight ahead");
  assert.ok(Math.abs(bearing(Math.PI, 0, 0, 0, 10) - Math.PI / 2) < 1e-9, "to the right (+z, right-handed view)");
  assert.ok(Math.abs(Math.abs(bearing(Math.PI, 0, 0, -10, 0)) - Math.PI) < 1e-9, "behind");
  const pois = [
    { name: "Upstream", river: 0, s: 50, id: "a" }, { name: "Found", river: 0, s: 150, id: "b" },
    { name: "Bridge", river: 0, s: 300, id: "c" }, { name: "Rapid", river: 0, s: 400, rapid: true },
    { name: "Other river", river: 1, s: 120, id: "d" },
  ];
  assert.equal(nextAhead(pois, 0, 100, (id) => id === "b").name, "Bridge");
  assert.equal(nextAhead(pois, 0, 350).name, "Rapid");
  assert.equal(nextAhead(pois, 0, 500), null);
  // Every step has words for both keyboard and touch, and touch never names a key.
  for (const s of ["paddle", "turn", "explore", "rapid", "ashore", "hint", "swim", "camp"]) {
    assert.ok(Coach.text(s, false, { name: "X" }).length > 10);
    assert.ok(!/<kbd>/.test(Coach.text(s, true, { name: "X" })), s);
  }
});

test("rock calls steer away from the rock: +lateral is river-right, a left stroke turns away from it", async () => {
  const { generateWorld } = await import("../web/src/world/terrain.js");
  const { buildFeatures } = await import("../web/src/sim/rapids.js");
  const { makeBoat, stroke, stepBoat } = await import("../web/src/sim/boat.js");
  const world = generateWorld(1, "tiny");
  const rocks = buildFeatures(world).filter((f) => f.kind === "rock");
  assert.ok(rocks.length > 5);
  for (const r of rocks) assert.equal(r.call, r.lateral > 0 ? "left" : "right");
  // And a left stroke turns the bow toward -lateral (river-left), away from a river-right rock.
  const p = world.rivers[0].samples[300];
  const b = makeBoat("raft", p.x, p.z, Math.atan2(p.tz, p.tx));
  stroke(b, "left");
  for (let i = 0; i < 30; i++) stepBoat(world, b, 1 / 60);
  const across = Math.cos(b.heading) * -p.tz + Math.sin(b.heading) * p.tx;
  assert.ok(across < -0.05, `left stroke heads toward -across: ${across}`);
});

test("a clean rock call takes the line round the rock instead of through it", async () => {
  const { generateWorld } = await import("../web/src/world/terrain.js");
  const { buildFeatures } = await import("../web/src/sim/rapids.js");
  const { makeBoat, stroke, stepBoat, dodge, featureIndex } = await import("../web/src/sim/boat.js");
  const world = generateWorld(1, "small");
  const all = buildFeatures(world);
  const rocks = all.filter((f) => f.kind === "rock").slice(0, 40);
  const pass = (withDodge) => {
    let clear = 0;
    for (const r of rocks) {
      const S = world.rivers[r.river].samples, p0 = S.find((q) => q.s >= r.s - 12);
      // Rocks cleared (a judged hit), so only the line decides how close the hull passes.
      const idx = featureIndex(all.map((f) => ({ ...f, cleared: true })));
      const b = makeBoat("raft", p0.x - p0.tz * r.lateral, p0.z + p0.tx * r.lateral, Math.atan2(p0.tz, p0.tx));
      b.y = p0.level; b.vx = p0.tx * 3; b.vz = p0.tz * 3;
      let minD = Infinity;
      for (let i = 0; i < 360; i++) {
        if (i === 50) { stroke(b, r.call, 1.15); if (withDodge) dodge(b, r, r.call); }
        stepBoat(world, b, 1 / 60, idx);
        minD = Math.min(minD, Math.hypot(b.x - r.x, b.z - r.z) - r.r);
      }
      if (minD > b.spec.beam / 2) clear++;
      assert.equal(b.line, null, "the line ends once past the rock");
    }
    return clear / rocks.length;
  };
  const without = pass(false), withLine = pass(true);
  assert.ok(withLine >= 0.8, `with the line ${withLine}`);
  assert.ok(withLine > without + 0.5, `without ${without}, with ${withLine}`);
});

test("between features the guide keeps the tempo with drive calls on the beat grid", async () => {
  const { generateWorld } = await import("../web/src/world/terrain.js");
  const { buildFeatures, buildRapids, Caller: C, FILL_EVERY, BPM } = await import("../web/src/sim/rapids.js");
  const { makeBoat, stepBoat, featureIndex } = await import("../web/src/sim/boat.js");
  const world = generateWorld(1, "small");
  const F = buildFeatures(world), R = buildRapids(world), idx = featureIndex(F);
  const r = R.find((x) => x.cls === 3 && !x.falls);
  const S = world.rivers[r.river].samples, p = S.find((q) => q.s >= r.s0 + 4);
  const b = makeBoat("raft", p.x, p.z, Math.atan2(p.tz, p.tx)); b.y = p.level;
  const c = new C(F, R);
  const calls = [];
  for (let t = 0; t < 40; t += 1 / 60) {
    stepBoat(world, b, 1 / 60, idx);
    for (const e of c.update(t, b)) if (e.type === "call") calls.push(e);
    // Answer every call on time so nothing piles up.
    for (const k of c.calls) if (!k._d && t >= k.time) { k._d = true; c.judge(k.call, t); }
  }
  const fills = calls.filter((e) => e.fill);
  assert.ok(fills.length >= 6, `drive calls: ${fills.length}`);
  const interval = 60 / BPM[3];
  const times = calls.map((e) => e.time).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < times.length; i++) {
    const g = times[i] - times[i - 1];
    maxGap = Math.max(maxGap, g);
    const beats = g / interval;
    assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6, "every call is on the beat grid");
  }
  assert.ok(maxGap <= FILL_EVERY[3] * interval + 1e-6, `no silence longer than ${FILL_EVERY[3]} beats: ${maxGap}`);
  assert.ok(c.stats.drive >= 6);
});

test("a dropped drive call costs a little flow but not the clean line; leaving drops pending drive calls", () => {
  const c = new Caller([], []);
  c.flow = 0.8;
  c.resolve({ call: "forward", fill: true }, "miss", 0);
  assert.equal(c.stats.miss, 0);
  assert.equal(c.stats.dropped, 1);
  assert.ok(c.flow > 0.6 && c.flow < 0.8);
  c.flow = 0.8;
  c.resolve({ call: "left", feature: { cleared: false } }, "miss", 0);
  assert.equal(c.stats.miss, 1);
  assert.ok(c.flow < 0.4);
});

test("running a rapid again calls it again (features are re-armed on entry)", async () => {
  const { generateWorld } = await import("../web/src/world/terrain.js");
  const { buildFeatures, buildRapids, Caller: C } = await import("../web/src/sim/rapids.js");
  const { makeBoat, stepBoat, featureIndex } = await import("../web/src/sim/boat.js");
  const world = generateWorld(1, "small");
  const F = buildFeatures(world), R = buildRapids(world), idx = featureIndex(F);
  const r = R.find((x) => x.cls >= 3 && !x.falls);
  const S = world.rivers[r.river].samples, p = S.find((q) => q.s >= r.s0 + 4);
  const c = new C(F, R);
  const run = () => {
    const b = makeBoat("raft", p.x, p.z, Math.atan2(p.tz, p.tx)); b.y = p.level;
    let n = 0;
    for (let t = 0; t < 30; t += 1 / 60) { stepBoat(world, b, 1 / 60, idx); for (const e of c.update(t, b)) if (e.type === "call" && e.feature) n++; }
    return n;
  };
  const first = run();
  c.reset();
  const second = run();
  assert.ok(first > 0);
  assert.equal(second, first);
});

test("steering while a drive call is open is free: only a forward stroke answers it", () => {
  const c = new Caller([], []);
  c.calls = [{ feature: null, call: "forward", time: 10, state: "pending", fill: true }];
  assert.equal(c.judge("left", 10), null);
  assert.equal(c.calls.length, 1);
  assert.equal(c.judge("forward", 10.05).judgment, "perfect");
});

test("ashore, the camera pulls in short of a tree or the truck behind the walker", async () => {
  const { Walker } = await import("../web/src/game/walker.js");
  const truck = { x: -5, z: 0, r: 1.5 };
  const game = { treeIdx: { near: () => [] }, places: { camps: [{ x: 0, z: 0, obstacles: [truck] }] } };
  const w = new Walker(game);
  w.x = 0; w.z = 0;
  // The eye sits at +cos/sin(yaw): yaw π puts it toward -x, where the truck is.
  const behind = w.clearReach({ yaw: Math.PI, pitch: 0.3 }, 7.5);
  assert.ok(behind < 4 && behind >= 2.2, `pulled in: ${behind}`);
  assert.equal(w.clearReach({ yaw: 0, pitch: 0.3 }, 7.5), 7.5, "nothing that way");
});

test("one rock, one penalty: hitting a rock before its call, or after missing it, never charges twice", async () => {
  const { missHurt } = await import("../web/src/sim/rapids.js");
  // Missed call, then the boat strikes the rock: only the miss is charged.
  const a = new Caller([], []);
  const rockA = { kind: "rock", cls: 4, cleared: false };
  a.calls = [{ feature: rockA, call: "left", time: 10, state: "pending" }];
  const ev = a.update(11, { current: null, swimming: false });
  const miss = ev.find((e) => e.type === "miss");
  const p1 = a.missPenalty(miss.call);
  assert.equal(p1.amount, missHurt(rockA));
  assert.equal(a.rockHit(rockA, 3, 11.2), null, "no second penalty for the collision");
  // The boat reaches the rock while its call is still pending: the call counts as missed, charged once.
  const b = new Caller([], []);
  const rockB = { kind: "rock", cls: 3, cleared: false };
  b.calls = [{ feature: rockB, call: "right", time: 10, state: "pending" }];
  const p2 = b.rockHit(rockB, 2.5, 9.5);
  assert.equal(p2.amount, missHurt(rockB));
  assert.equal(b.calls.length, 0, "the pending call is resolved by the hit");
  assert.equal(b.stats.miss, 1);
  assert.equal(b.update(11, { current: null, swimming: false }).filter((e) => e.type === "miss").length, 0);
  // A rock nobody called costs a knock by speed, once.
  const c = new Caller([], []);
  const rockC = { kind: "rock", cls: 2, cleared: false };
  assert.ok(Math.abs(c.rockHit(rockC, 2, 0).amount - 0.2) < 1e-9);
  assert.equal(c.rockHit(rockC, 2, 0.1), null);
  // Drive and swim calls never cost the boat.
  assert.equal(c.missPenalty({ fill: true, call: "forward" }), null);
  assert.equal(c.missPenalty({ swim: true, call: "forward" }), null);
});

test("coach: after the first rapid with no camp close downstream, the tutorial ends instead of sending the player on", async () => {
  const { Coach, CAMP_NEAR_AHEAD, FIRST_RAPID_LENIENCY } = await import("../web/src/game/coach.js");
  const c = new Coach("explore");
  assert.equal(c.leniency(), FIRST_RAPID_LENIENCY);
  c.step({ leftRapid: true, campAhead: CAMP_NEAR_AHEAD + 1, speed: 1 }, 0.1);
  assert.equal(c.state, "done");
  assert.equal(c.leniency(), 1);
  // A returning player never gets the wider windows.
  assert.equal(new Coach("done").leniency(), 1);
});

test("Gorge Lookout stands in the flat water above Gorge Gate, as its card says", async () => {
  const { generateWorld } = await import("../web/src/world/terrain.js");
  const { buildRapids } = await import("../web/src/sim/rapids.js");
  const { CAMPS } = await import("../web/src/game/places.js");
  for (const preset of ["small", "tiny"]) {
    const w = generateWorld(1, preset), R = buildRapids(w);
    const ri = w.rivers.findIndex((r) => r.id === "long"), S = w.rivers[ri].samples;
    const d = CAMPS.find((x) => x.id === "lookout");
    const p = S[Math.round(d.f * (S.length - 1))];
    const inside = R.find((r) => r.river === ri && p.s >= r.s0 - 6 && p.s <= r.s1 + 6);
    assert.equal(inside, undefined, `${preset}: inside ${inside?.name}`);
    const next = R.filter((r) => r.river === ri && r.s0 > p.s).sort((a, b) => a.s0 - b.s0)[0];
    assert.ok(next && next.s0 - p.s < 120, `${preset}: the gorge starts just below (${next && (next.s0 - p.s).toFixed(0)} m)`);
  }
});

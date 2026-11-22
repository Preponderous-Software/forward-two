// World generation and simulation: deterministic, water runs downhill and
// sits in its channel, boats float, the guide calls rapids on the beat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, heightAt, waterAt, riverAt, buildSkeleton } from "../web/src/world/terrain.js";
import { makeBoat, stepBoat, stroke, currentAt, featureIndex } from "../web/src/sim/boat.js";
import { buildFeatures, buildRapids, Caller, LEAD, WINDOW } from "../web/src/sim/rapids.js";

const world = generateWorld(1, "tiny");

test("generation is deterministic for a seed", () => {
  const again = generateWorld(1, "tiny");
  assert.deepEqual(Array.from(again.heights.slice(0, 500)), Array.from(world.heights.slice(0, 500)));
  const other = generateWorld(2, "tiny");
  assert.notDeepEqual(Array.from(other.heights.slice(1000, 1500)), Array.from(world.heights.slice(1000, 1500)));
});

test("rivers run downhill from source to mouth", () => {
  for (const r of world.rivers) {
    for (let i = 1; i < r.samples.length; i++) assert.ok(r.samples[i].level <= r.samples[i - 1].level + 1e-6, `${r.name} rises at ${i}`);
  }
  const long = world.rivers.find((r) => r.id === "long");
  assert.ok(long.samples[0].level > 100 && long.samples.at(-1).level < 1);
});

test("water sits above the bed along every river", () => {
  const full = generateWorld(1, "small");
  for (const r of full.rivers) for (const p of r.samples.filter((_, i) => i % 7 === 0)) {
    const w = waterAt(full, p.x, p.z);
    if (Number.isNaN(w)) continue; // a sample can fall between grid points on a narrow headwater
    assert.ok(heightAt(full, p.x, p.z) < w + 0.3, `${r.name} dry at s=${p.s.toFixed(0)}`);
  }
});

test("the skeleton is cheap and matches the grids' world", () => {
  const sk = buildSkeleton(1, "tiny");
  assert.equal(sk.rivers.length, world.rivers.length);
  assert.equal(sk.seeds.count, world.seeds.count);
});

test("the current runs downstream mid-river", () => {
  const long = world.rivers[0];
  const p = long.samples[Math.floor(long.samples.length * 0.45)];
  const c = currentAt(world, p.x, p.z);
  assert.ok(c.speed > 0.2);
  assert.ok(c.vx * p.tx + c.vz * p.tz > 0);
  assert.ok(riverAt(world, p.x, p.z).dist < 3);
});

test("a drifting boat floats downstream and stays wet", () => {
  const long = world.rivers[0];
  const p = long.samples[Math.floor(long.samples.length * 0.4)];
  const b = makeBoat("raft", p.x, p.z, Math.atan2(p.tz, p.tx));
  b.y = p.level;
  const s0 = riverAt(world, b.x, b.z).sample.s;
  for (let i = 0; i < 60 * 20; i++) stepBoat(world, b, 1 / 60);
  const hit = riverAt(world, b.x, b.z);
  assert.ok(hit && hit.sample.s > s0 + 5, "moved downstream");
  assert.ok(!Number.isNaN(waterAt(world, b.x, b.z)), "still on water");
});

test("strokes push the boat forward and turn it", () => {
  const p = world.rivers[0].samples[400];
  const b = makeBoat("kayak", p.x, p.z, 0);
  stroke(b, "forward");
  assert.ok(b.vx > 0.5);
  const h0 = b.heading; stroke(b, "left");
  for (let i = 0; i < 30; i++) stepBoat(world, b, 1 / 60);
  assert.ok(b.heading > h0);
});

test("rapids have features with calls, and the guide calls them on the beat", () => {
  const features = buildFeatures(world), rapids = buildRapids(world);
  assert.ok(features.length > 30);
  assert.ok(rapids.some((r) => r.name === "The Throat" || r.cls === 5));
  for (const f of features) assert.ok(["forward", "back", "left", "right"].includes(f.call));
  const caller = new Caller(features, rapids);
  const r = rapids.find((x) => x.cls >= 3);
  const S = world.rivers[r.river].samples;
  const f0 = features.find((f) => f.river === r.river && f.s > r.s0 + 8);
  const p = S.find((q) => q.s >= f0.s - 6);
  const b = makeBoat("raft", p.x, p.z, Math.atan2(p.tz, p.tx));
  b.vx = p.tx * 3; b.vz = p.tz * 3;
  stepBoat(world, b, 1 / 60, featureIndex(features));
  b.vx = p.tx * 3; b.vz = p.tz * 3;
  const ev = caller.update(10, b);
  assert.ok(ev.some((e) => e.type === "enter"));
  assert.ok(caller.calls.length > 0, "calls scheduled");
  const first = caller.calls[0];
  assert.ok(first.time >= 10 + LEAD - 1e-9);
  // Beats are evenly spaced.
  for (let i = 1; i < caller.calls.length; i++) assert.ok(Math.abs(caller.calls[i].time - caller.calls[i - 1].time - caller.interval) < 1e-6);
  // A stroke on time is perfect; the wrong one is wrong.
  const j = caller.judge(first.call, first.time + WINDOW.perfect / 2);
  assert.equal(j.judgment, "perfect");
  if (caller.calls.length) {
    const c = caller.calls[0], wrong = c.call === "forward" ? "back" : "forward";
    assert.equal(caller.judge(wrong, c.time).judgment, "wrong");
  }
  // Unanswered calls become misses.
  caller.update(1000, b);
  assert.equal(caller.calls.length, 0);
});

test("river water texture runs downstream (uv v grows with distance along the river)", async () => {
  const { waterMesh } = await import("../web/src/render/meshes.js");
  const m = waterMesh(world);
  const long = world.rivers[0];
  const a = long.samples[Math.floor(long.samples.length * 0.4)], b = long.samples[Math.floor(long.samples.length * 0.42)];
  const vNear = (p) => {
    let best = Infinity, v = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const d = (m.positions[i * 3] - p.x) ** 2 + (m.positions[i * 3 + 2] - p.z) ** 2;
      if (d < best) { best = d; v = m.uvs[i * 2 + 1]; }
    }
    return v;
  };
  assert.ok(vNear(b) > vNear(a), "downstream water has the larger v");
});

test("every camp and every built landmark stands on dry land", async () => {
  const { Places } = await import("../web/src/game/places.js");
  const small = generateWorld(1, "small");
  const p = new Places({ world: small });
  for (const q of [...p.camps, ...p.landmarks.filter((l) => l.side)]) {
    const wl = waterAt(small, q.x, q.z), h = heightAt(small, q.x, q.z);
    assert.ok(Number.isNaN(wl) || h > wl, `${q.id} is in the water (ground ${h.toFixed(1)}, water ${wl})`);
  }
});

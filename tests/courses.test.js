// Course gates: the game and the relay build the same gates from the seed,
// and the relay ranks a ghost only if it ran them in order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkeleton } from "../web/src/world/terrain.js";
import { buildCourses, checkCourseRun, COURSES } from "../web/src/game/courses.js";
import { encode } from "../web/src/net/ghost.js";
import { createApp } from "../server/app.js";

const courses = buildCourses(buildSkeleton(1, "small").rivers);
const byId = Object.fromEntries(courses.map((c) => [c.id, c]));

// Follow the river's centreline at `speed` m/s from the start gate to the end.
function honestRun(c, speed = 3) {
  const S = c.river.samples.filter((p) => p.s >= c.gates[0].s - 1 && p.s <= c.gates.at(-1).s + 6);
  const out = []; let t = 0, s0 = S[0].s;
  for (const p of S) { const tt = Math.round(((p.s - s0) / speed) * 1000); if (tt >= t) { out.push({ t: tt, x: p.x, z: p.z, h: Math.atan2(p.tz, p.tx) }); t = tt + 100; } }
  return out;
}

test("courses are the same whatever the world preset", () => {
  const full = buildCourses(buildSkeleton(1, "full").rivers);
  assert.equal(full.length, COURSES.length);
  full.forEach((c, i) => assert.deepEqual(c.gates.map((g) => [g.x.toFixed(2), g.z.toFixed(2)]), courses[i].gates.map((g) => [g.x.toFixed(2), g.z.toFixed(2)])));
});

test("a run down the river passes every gate; a shortcut over land does not", () => {
  for (const c of courses) assert.ok(checkCourseRun(c, honestRun(c)).ok, c.id);
  const c = byId["meadow-sprint"], a = c.gates[0], b = c.gates.at(-1);
  const line = Array.from({ length: 40 }, (_, i) => ({ t: i * 100, x: a.x + (b.x - a.x) * i / 39, z: a.z + (b.z - a.z) * i / 39, h: 0 }));
  assert.equal(checkCourseRun(c, line).ok, false);
  assert.equal(checkCourseRun(null, line).reason, "unknown course");
});

test("the relay rejects unknown courses and gate-skipping ghosts, and ranks honest ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "f2-courses-"));
  const app = createApp({ data: dir, courses: byId });
  const port = await app.listen(0, "127.0.0.1");
  try {
  const post = (course, body) => fetch(`http://127.0.0.1:${port}/api/ghosts/${course}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const c = byId["meadow-sprint"], run = honestRun(c), ms = run.at(-1).t;
  assert.equal((await post("made-up-course", { name: "X", ms, ghost: encode(run) })).status, 404);
  // Same times, but a straight line from start to finish over the land.
  const a = run[0], b = run.at(-1);
  const skip = run.map((s, i) => ({ ...s, x: a.x + (b.x - a.x) * i / (run.length - 1), z: a.z + (b.z - a.z) * i / (run.length - 1) }));
  const skipped = await post("meadow-sprint", { name: "Cheat", ms: skip.at(-1).t, ghost: encode(skip) });
  assert.equal(skipped.status, 422);
  const ok = await post("meadow-sprint", { name: "Honest", ms, ghost: encode(run) });
  assert.ok(ok.status === 200 || ok.status === 201, JSON.stringify(ok.body));
  assert.equal(ok.body.rank, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

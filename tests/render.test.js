// Render builders: the water, sea and forest meshes are well formed (indices
// in range, colours in 0..1) and the extras stay within their budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../web/src/world/terrain.js";
import { waterMesh, shoreMesh, seaMesh, forestMeshes, groundCover } from "../web/src/render/meshes.js";
import { drawStars, foamStream } from "../web/src/render/effects.js";
import { Rows } from "../web/src/render/bridge.js";
import { badge, placeBadge } from "../web/src/ui/badges.js";

const world = generateWorld(1, "tiny");

function wellFormed(m, name) {
  const nv = m.positions.length / 3;
  assert.equal(m.colors.length, nv * 3, `${name}: a colour per vertex`);
  assert.equal(m.uvs.length, nv * 2, `${name}: a uv per vertex`);
  assert.ok(m.indices.length > 0 && m.indices.length % 3 === 0, `${name}: whole triangles`);
  assert.ok(m.indices.every((i) => i < nv), `${name}: indices in range`);
  const bad = m.colors.findIndex((c) => !(c >= 0 && c <= 1.001));
  assert.equal(bad, -1, `${name}: colour in 0..1 (got ${m.colors[bad]})`);
  assert.ok(m.positions.every(Number.isFinite), `${name}: finite positions`);
}

test("water, sea and forest meshes are well formed", () => {
  const wm = waterMesh(world);
  wellFormed(wm, "water");
  assert.equal(wm.calm.length + wm.rough.length, wm.indices.length, "calm and rough split the water");
  wellFormed(seaMesh(world), "sea");
  wellFormed(shoreMesh(world), "shore");
  for (const m of forestMeshes(world, 1, 2).meshes) wellFormed(m, "forest");
  for (const m of groundCover(world, 1, 2).meshes) wellFormed(m, "ground cover");
});

test("rapids are whiter than flat water", () => {
  const m = waterMesh(world), r = world.rivers[0];
  const near = (cls) => {
    let sum = 0, n = 0;
    for (const p of r.samples.filter((q) => q.cls === cls).slice(0, 40)) {
      for (let i = 0; i < m.positions.length / 3; i++) {
        if (Math.hypot(m.positions[i * 3] - p.x, m.positions[i * 3 + 2] - p.z) < world.cell) { sum += m.colors[i * 3]; n++; }
      }
    }
    return n ? sum / n : NaN;
  };
  const flat = near(0), rough = [4, 5].map(near).find((v) => !Number.isNaN(v)) ?? near(3);
  assert.ok(rough > flat + 0.1, `rapids ${rough.toFixed(2)} vs flat ${flat.toFixed(2)}`);
});

test("stars and foam stay within a small point budget", () => {
  const R = { points: new Rows(10), lights: new Rows(12) };
  drawStars(R, { tx: 0, ty: 0, tz: 0 }, 1, 0);
  const S = world.rivers[0].samples, i = S.findIndex((p) => p.cls >= 3);
  foamStream(R, S, Math.max(0, i), 1.3);
  assert.ok(R.points.n > 0 && R.points.n < 700, `${R.points.n} points`);
  const day = { points: new Rows(10) };
  drawStars(day, { tx: 0, ty: 0, tz: 0 }, 0, 0);
  assert.equal(day.points.n, 0, "no stars by day");
});

test("badges draw art when earned and a question mark for unfound places", () => {
  assert.match(badge("wave", true, { feat: true }), /<svg[^>]*class="badge on"/);
  assert.match(placeBadge({ id: "fork", flag: [0.95, 0.45, 0.1] }, false), />\?</);
  assert.match(placeBadge({ id: "town", flag: [1, 1, 1] }), /#ffffff/);
});

test("the shore strip follows both banks of every river at modest cost", () => {
  const m = shoreMesh(world), nv = m.positions.length / 3;
  const samples = world.rivers.reduce((a, r) => a + r.samples.length, 0);
  assert.ok(nv > samples, "both banks of most samples");
  assert.ok(nv <= samples * 10, `${nv} vertices for ${samples} samples`);
});

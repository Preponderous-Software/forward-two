// Perf tier choice, frame meter, and the friendly error descriptions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTier, readPerf, writePerf, noteSlow, clearSlow, FrameMeter, DETAIL, PERF_KEY } from "../web/src/game/perf.js";
import { describeError, errorWithCode } from "../web/src/ui/errors.js";

const P = (s) => new URLSearchParams(s);
const desktop = { coarse: false, mem: 8, cores: 8, saveData: false };
const phone = { coarse: true, mem: 4, cores: 8, saveData: false };

test("pickTier: desktops get the full world, phones and weak machines the small one", () => {
  assert.deepEqual([pickTier(desktop).preset, pickTier(desktop).detail], ["full", 2]);
  assert.deepEqual([pickTier(phone).preset, pickTier(phone).detail], ["small", 1]);
  assert.equal(pickTier({ ...desktop, mem: 4 }).preset, "small");
  assert.equal(pickTier({ ...desktop, cores: 2 }).preset, "small");
  assert.equal(pickTier({ ...desktop, mem: null, cores: null }).preset, "full", "unknown hints: assume capable");
  const sd = pickTier({ ...desktop, saveData: true });
  assert.deepEqual([sd.preset, sd.detail, sd.dprCap], ["small", 0, DETAIL[0].dprCap]);
  assert.equal(pickTier({ ...phone, mem: 2 }).detail, 0);
  assert.ok(pickTier(phone).reasons.includes("touch screen"));
});

test("pickTier: a slow last session starts lighter; URL options pin the choice", () => {
  assert.equal(pickTier(desktop, null, { slow: { full: { frameMs: 60 } } }).preset, "small");
  assert.equal(pickTier(phone, null, { slow: { small: { frameMs: 60 } } }).detail, 0);
  assert.equal(pickTier(phone, P("world=full")).preset, "full");
  assert.equal(pickTier(desktop, P("world=full"), { slow: { full: {} } }).preset, "full");
  assert.equal(pickTier(desktop, P("world=full"), { slow: { full: {} } }).detail, 1);
  assert.equal(pickTier(desktop, P("world=tiny")).preset, "tiny");
  assert.equal(pickTier(desktop, P("world=huge")).preset, "full");
  assert.equal(pickTier(phone, P("detail=2")).detail, 2);
  assert.equal(pickTier(phone, P("detail=9")).detail, 1);
  assert.doesNotThrow(() => pickTier(undefined, { get() { throw new Error("x"); } }, "junk"));
});

test("perf memory survives junk and blocked storage", () => {
  const m = new Map(); const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.deepEqual(readPerf(s), {});
  m.set(PERF_KEY, "{oops"); assert.deepEqual(readPerf(s), {});
  m.set(PERF_KEY, "[1]"); assert.deepEqual(readPerf(s), {});
  assert.equal(noteSlow("full", 61.4, s), true);
  assert.equal(readPerf(s).slow.full.frameMs, 61);
  assert.equal(clearSlow("full", s), true);
  assert.equal(readPerf(s).slow.full, undefined);
  assert.equal(clearSlow("full", s), false);
  const bad = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  assert.deepEqual(readPerf(bad), {});
  assert.equal(writePerf({ a: 1 }, bad), false);
  assert.equal(noteSlow("small", 50, bad), false);
});

test("FrameMeter: average, p95 and max over a rolling window", () => {
  const f = new FrameMeter(10);
  assert.deepEqual(f.summary(), { n: 0, avg: 0, p95: 0, max: 0 });
  for (let i = 1; i <= 25; i++) f.add(i);
  const s = f.summary();
  assert.equal(s.n, 10);
  assert.equal(s.max, 25);
  assert.equal(s.avg, 20.5);
});

test("describeError turns failures into words a player can act on", () => {
  assert.equal(describeError(new TypeError("Failed to fetch")).code, "network");
  assert.equal(describeError(new Error("engine/forward-two.wasm: HTTP 404")).code, "network");
  assert.equal(describeError(new TypeError("error loading dynamically imported module: http://x/src/game/game.js")).code, "network");
  assert.equal(describeError(Object.assign(new Error("bad magic"), { name: "CompileError" })).code, "engine");
  assert.equal(describeError(new Error("x"), { wasm: false }).code, "no-wasm");
  assert.equal(describeError(errorWithCode("world", "worker died")).code, "world");
  assert.equal(describeError(errorWithCode("not-a-code", "?")).code, "boot");
  assert.equal(describeError("plain string").code, "boot");
  assert.equal(describeError(null).code, "boot");
  assert.equal(describeError(new ReferenceError("StrataLoader is not defined")).code, "network", "a loader script that did not download");
  const d = describeError(new Error("y".repeat(500)));
  assert.equal(d.detail.length, 200);
  for (const c of ["no-webgl2", "no-wasm", "network", "engine", "world", "crash", "boot"]) assert.ok(describeError(errorWithCode(c)).message.length > 20, c);
});

test("the world worker reports a failure as {error} instead of dying silently", async () => {
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  try {
    await import("../web/src/world/worker.js");
    globalThis.self.onmessage({ data: null });
    assert.equal(posted.length, 1);
    assert.equal(typeof posted[0].error, "string");
    posted.length = 0;
    globalThis.self.onmessage({ data: { seed: 3, preset: "tiny", forest: { density: 0.3, chunks: 2 } } });
    const last = posted.at(-1);
    assert.ok(last.grids, "a good request still builds the grids");
    assert.ok(last.forest && last.forest.count > 0 && last.forest.density === 0.3, "and the forest");
    assert.ok(last.forest.meshes[0].positions instanceof Float32Array);
    assert.equal(last.forest.meshes[0].uvs, null, "untextured forest ships without uvs");
    assert.ok(posted.some((m) => m.progress != null));
  } finally { delete globalThis.self; }
});

test("forestDensity keeps the shipped densities and thins the lowest tier", async () => {
  const { forestDensity } = await import("../web/src/game/perf.js");
  assert.equal(forestDensity("full", 2), 1);
  assert.equal(forestDensity("full", 1), 1);
  assert.equal(forestDensity("small", 1), 0.3);
  assert.equal(forestDensity("tiny", 2), 0.3);
  assert.ok(Math.abs(forestDensity("small", 0) - 0.18) < 1e-12);
});

test("Bridge drops the engine's copy of rebuildable meshes and refills them after a context restore", async () => {
  const { Bridge } = await import("../web/src/render/bridge.js");
  const heap = new ArrayBuffer(1 << 22);
  const slots = [];
  const mod = {
    HEAPF32: new Float32Array(heap), _malloc: () => 8, _free() {},
    _f2_mesh_add: (p, n, c, u, i, nv, ni) => { slots.push({ nv, ni, copy: true, missing: false, refills: 0 }); return slots.length - 1; },
    _f2_mesh_drop_copy: (s) => { slots[s].copy = false; return slots[s].nv * 36; },
    _f2_mesh_missing: (s) => (slots[s].missing ? 1 : 0),
    _f2_mesh_refill: (s, p, n, c, u, i, nv, ni) => { Object.assign(slots[s], { missing: false, refills: slots[s].refills + 1, nv, ni }); return 0; },
    _f2_mesh_remove: (s) => { slots[s] = null; },
  };
  const tri = () => ({ positions: new Float32Array(9), normals: new Float32Array(9), colors: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
  const b = new Bridge(mod);
  assert.equal(b.canDropCopies, true);
  const kept = b.mesh(tri());
  let built = 0;
  const big = b.mesh(tri(), () => { built++; return tri(); });
  assert.equal(slots[kept].copy, true, "meshes without a rebuild keep their copy");
  assert.equal(slots[big].copy, false);
  assert.equal(b.droppedBytes, 3 * 36);
  // A restore that lost nothing rebuilds nothing.
  assert.deepEqual(await b.restore(), { refilled: 0, failed: 0 });
  assert.equal(built, 0);
  // The engine lost the copy-less mesh: it is rebuilt and refilled.
  slots[big].missing = true;
  assert.deepEqual(await b.restore(), { refilled: 1, failed: 0 });
  assert.equal(built, 1);
  assert.equal(slots[big].refills, 1);
  // A rebuild may be async (the world worker).
  slots[big].missing = true;
  const asyncSlot = b.mesh(tri(), async () => tri());
  slots[asyncSlot].missing = true;
  assert.deepEqual(await b.restore(), { refilled: 2, failed: 0 });
  // A rebuild that throws is counted, not thrown.
  const bad = b.mesh(tri(), () => { throw new Error("gone"); });
  slots[bad].missing = true;
  assert.deepEqual(await b.restore(), { refilled: 0, failed: 1 });
  // Removing a mesh forgets its rebuild.
  b.removeMesh(big);
  assert.equal(b.rebuilders.has(big), false);
  // An older wasm without the exports keeps every copy.
  const old = new Bridge({ ...mod, _f2_mesh_drop_copy: undefined });
  assert.equal(old.canDropCopies, false);
  const s = old.mesh(tri(), () => tri());
  assert.equal(slots[s].copy, true);
  assert.equal(old.rebuilders.size, 0);
});

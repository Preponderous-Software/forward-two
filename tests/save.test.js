// Save integrity: validation, repair, backups, recovery from corrupt or
// newer saves, failed writes, and fields this build does not know.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Save, KEY, saveKey, normalizeSave, parseSave } from "../web/src/game/save.js";

class MemStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); this.quota = Infinity; this.blocked = false; this.mangle = null; }
  getItem(k) { if (this.blocked) throw new Error("SecurityError"); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    if (this.blocked) throw new Error("SecurityError");
    if (String(v).length > this.quota) throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
    this.m.set(k, this.mangle ? this.mangle(String(v)) : String(v));
  }
  removeItem(k) { this.m.delete(k); }
}

function fakeGame({ params = "", seed = 1, boat = {} } = {}) {
  const toasts = [];
  const g = {
    params: new URLSearchParams(params), world: { seed, size: 3072 },
    boat: { kind: "kayak", x: 1200, z: 900, heading: 0.5, hull: 0.8, swimming: false, ...boat },
    caller: { rapid: null }, clock: 0.4, colour: [0.1, 0.2, 0.3], boatsOwned: new Set(["raft", "kayak"]),
    journal: { data: () => ({ found: ["tarn-spring"], feats: [], visited: [], pay: 12, deliveries: 1, explored: "" }), restore(d) { this.got = d; } },
    jobs: { data: () => ({ active: [] }), restore(d) { this.got = d; } },
    races: { data: () => ({ best: { "mirror-sprint": { ms: 61000 } } }), restore(d) { this.got = d; } },
    hud: { toast: (t) => toasts.push(t) },
  };
  g.toasts = toasts;
  return g;
}

const good = (over = {}) => JSON.stringify({ v: 1, seed: 1, boat: "canoe", pos: { x: 500, z: 600, heading: 1 }, clock: 0.25, hull: 0.5,
  boatsOwned: ["raft", "canoe"], colour: null, journal: { found: ["meadow-fork"], pay: 40 }, jobs: { active: [] }, races: { best: {} }, at: 1000, ...over });

test("saveKey keeps the main slot for seed 1 and separates other seeds", () => {
  assert.equal(saveKey(1), KEY);
  assert.equal(saveKey("1"), KEY);
  assert.equal(saveKey(undefined), KEY);
  assert.equal(saveKey(7), `${KEY}.s7`);
  assert.equal(saveKey("x/../y"), `${KEY}.sxy`);
});

test("normalizeSave repairs bad fields one by one and keeps the rest", () => {
  const r = normalizeSave({
    v: 1, boat: "submarine", pos: { x: NaN, z: 5 }, clock: 1.25, hull: 7, boatsOwned: ["kayak", "jetski", "kayak"],
    colour: [2, 0, 0], journal: { found: "nope", pay: "lots", feats: ["x"] }, jobs: 5, races: { best: [] }, future: { keep: true },
  }, { size: 3072 });
  assert.equal(r.ok, true);
  const d = r.data;
  assert.equal(d.boat, "raft");
  assert.equal(d.pos, undefined);
  assert.equal(d.clock, 0.25);
  assert.equal(d.hull, 1);
  assert.deepEqual(d.boatsOwned, ["raft", "kayak"]);
  assert.equal(d.colour, null);
  assert.deepEqual(d.journal, { feats: ["x"] });
  assert.equal(d.jobs, undefined);
  assert.deepEqual(d.races, {});
  assert.deepEqual(d.future, { keep: true }, "unknown fields survive");
  for (const k of ["boat", "pos", "colour", "jobs"]) assert.ok(r.fixed.some((f) => f.startsWith(k)), k);
});

test("normalizeSave: positions outside the world, missing heading, negative clock", () => {
  assert.equal(normalizeSave({ pos: { x: 5000, z: 10 } }, { size: 3072 }).data.pos, undefined);
  assert.equal(normalizeSave({ pos: { x: -1, z: 10 } }, { size: 3072 }).data.pos, undefined);
  assert.deepEqual(normalizeSave({ pos: { x: 1, z: 2 } }, { size: 3072 }).data.pos, { x: 1, z: 2, heading: 0 });
  assert.ok(Math.abs(normalizeSave({ clock: -0.25 }).data.clock - 0.75) < 1e-12);
  assert.equal(normalizeSave({}).ok, true, "an empty object is an (empty) save");
  assert.equal(normalizeSave({}).data.v, 1);
});

test("normalizeSave rejects non-objects and newer versions", () => {
  for (const bad of [null, 3, "x", [], true]) assert.equal(normalizeSave(bad).ok, false);
  assert.equal(normalizeSave({ v: "1" }).ok, false);
  const n = normalizeSave({ v: 2 });
  assert.equal(n.ok, false); assert.equal(n.newer, true);
  assert.equal(parseSave("{not json").ok, false);
  assert.equal(parseSave(null).reason, "missing");
});

test("a good save loads, applies, and missing fields stay default", () => {
  const st = new MemStorage({ [KEY]: JSON.stringify({ v: 1, boat: "canoe", journal: { found: ["a"] } }) });
  const g = fakeGame(); const s = new Save(g, st);
  const d = s.load();
  assert.equal(d.boat, "canoe");
  s.apply(d);
  assert.equal(g.clock, 0.4, "no clock in the save: unchanged");
  assert.deepEqual(g.journal.got, { found: ["a"] });
  assert.equal(g.jobs.got, undefined);
  assert.equal(s.notice(), null);
  assert.equal(s.load(), d, "cached");
});

test("apply survives a system whose restore throws", () => {
  const g = fakeGame(); g.journal.restore = () => { throw new Error("boom"); };
  const s = new Save(g, new MemStorage({ [KEY]: good() }));
  s.apply(s.load());
  assert.equal(g.clock, 0.25);
  assert.deepEqual(g.races.got, { best: {} }, "later systems still restore");
});

test("corrupt JSON falls back to the backup and keeps the damaged text", () => {
  const st = new MemStorage({ [KEY]: '{"v":1,"boat":"ka', [`${KEY}.bak`]: good({ at: 1234 }) });
  const s = new Save(fakeGame(), st);
  const d = s.load();
  assert.equal(d.boat, "canoe");
  assert.equal(st.getItem(`${KEY}.corrupt`), '{"v":1,"boat":"ka');
  assert.equal(st.getItem(KEY), good({ at: 1234 }), "primary restored from the backup");
  assert.match(s.notice(), /backup/);
});

test("corrupt JSON with no backup starts fresh, keeps the text, and says so", () => {
  const st = new MemStorage({ [KEY]: "\u0000garbage" });
  const s = new Save(fakeGame(), st);
  assert.equal(s.load(), null);
  assert.equal(st.getItem(`${KEY}.corrupt`), "\u0000garbage");
  assert.match(s.notice(), /fresh start/);
  // The next write replaces the primary but the damaged text is still kept.
  assert.equal(s.write(), true);
  assert.equal(st.getItem(`${KEY}.corrupt`), "\u0000garbage");
  assert.equal(st.getItem(`${KEY}.bak`), null, "a corrupt primary is never copied over a backup");
});

test("a valid-JSON but wrong-shaped save (array, string) is treated as corrupt", () => {
  for (const bad of ["[]", '"hello"', "null", "42"]) {
    const st = new MemStorage({ [KEY]: bad, [`${KEY}.bak`]: good() });
    const d = new Save(fakeGame(), st).load();
    assert.equal(d?.boat, "canoe", bad);
  }
});

test("a save from a newer version is never overwritten: backup loads read-only", () => {
  const newer = JSON.stringify({ v: 2, boat: "hovercraft", pay: 999 });
  const st = new MemStorage({ [KEY]: newer, [`${KEY}.bak`]: good() });
  const g = fakeGame(); const s = new Save(g, st);
  assert.equal(s.load().boat, "canoe");
  assert.equal(st.getItem(KEY), newer, "primary untouched after load");
  assert.equal(st.getItem(`${KEY}.newer`), newer);
  s.apply(s.load());
  assert.equal(s.write(), false);
  s.flush(); s.tick(100);
  assert.equal(st.getItem(KEY), newer, "primary untouched after write/flush/tick");
  assert.match(s.notice(), /newer version/);
});

test("a newer save with no backup starts fresh but still writes nothing", () => {
  const newer = JSON.stringify({ v: 3 });
  const st = new MemStorage({ [KEY]: newer });
  const s = new Save(fakeGame(), st);
  assert.equal(s.load(), null);
  assert.equal(s.write(), false);
  assert.equal(st.getItem(KEY), newer);
});

test("damaged save that can't be kept aside (storage full) is not overwritten", () => {
  const damaged = "{\"v\":1,\"boat\":\"kay" + "x".repeat(400);
  const st = new MemStorage({ [KEY]: damaged });
  st.quota = 300;                                   // .corrupt copy fails
  const s = new Save(fakeGame(), st);
  assert.equal(s.load(), null);
  assert.equal(s.readOnly, "corrupt");
  st.quota = Infinity;                              // room frees up later in the session
  assert.equal(s.write(), false);
  assert.equal(st.getItem(KEY), damaged, "the only copy of the damaged text survives");
  assert.match(s.notice(), /out of space/);
});

test("damaged save kept aside as .corrupt still recovers from the backup and writes", () => {
  const st = new MemStorage({ [KEY]: "garbage", [`${KEY}.bak`]: good() });
  const g = fakeGame(); const s = new Save(g, st);
  assert.equal(s.load().boat, "canoe");
  assert.equal(s.readOnly, null);
  assert.equal(st.getItem(`${KEY}.corrupt`), "garbage");
  s.apply(s.load());
  assert.equal(s.write(), true);
});

test("a 0.1.0 save from another world moves to its own slot before a fresh start", () => {
  const other = good({ seed: 7, boat: "dory" });
  const st = new MemStorage({ [KEY]: other });
  const s = new Save(fakeGame({ seed: 1 }), st);
  assert.equal(s.load(), null);
  assert.equal(st.getItem(saveKey(7)), other);
  assert.match(s.notice(), /seed 7/);
  assert.equal(s.write(), true);
  assert.equal(new Save(fakeGame({ seed: 7 }), st).load().boat, "dory");
});

test("another world's save is left alone if its own slot is taken by different data", () => {
  const other = good({ seed: 7, boat: "dory" });
  const st = new MemStorage({ [KEY]: other, [saveKey(7)]: good({ seed: 7, boat: "kayak" }) });
  const s = new Save(fakeGame({ seed: 1 }), st);
  assert.equal(s.load(), null);
  assert.equal(s.readOnly, "other-world");
  assert.equal(s.write(), false);
  assert.equal(st.getItem(KEY), other);
});

test("the first write of a session snapshots the save it found; later writes do not", () => {
  const st = new MemStorage({ [KEY]: good({ at: 1 }) });
  const g = fakeGame(); const s = new Save(g, st);
  s.apply(s.load());
  assert.equal(s.write(), true);
  assert.equal(st.getItem(`${KEY}.bak`), good({ at: 1 }));
  g.boat.x = 1300;
  assert.equal(s.write(), true);
  assert.equal(st.getItem(`${KEY}.bak`), good({ at: 1 }), "backup is the session's starting save");
  const now = JSON.parse(st.getItem(KEY));
  assert.equal(now.pos.x, 1300);
  assert.equal(now.boat, "kayak");
  assert.deepEqual(now.journal.found, ["tarn-spring"]);
});

test("fields from a newer build survive a write by this build", () => {
  const st = new MemStorage({ [KEY]: good({ letters: ["from-the-ferryman"], weather: { rain: 0.3 } }) });
  const s = new Save(fakeGame(), st);
  s.load(); s.write();
  const now = JSON.parse(st.getItem(KEY));
  assert.deepEqual(now.letters, ["from-the-ferryman"]);
  assert.deepEqual(now.weather, { rain: 0.3 });
});

test("a NaN boat position keeps the last good position", () => {
  const st = new MemStorage({ [KEY]: good() });
  const g = fakeGame(); const s = new Save(g, st);
  s.load(); g.boat.x = NaN;
  assert.equal(s.write(), true);
  assert.deepEqual(JSON.parse(st.getItem(KEY)).pos, { x: 500, z: 600, heading: 1 });
});

test("a failed write (quota) keeps the old save and warns the player once", () => {
  const st = new MemStorage({ [KEY]: good() });
  const g = fakeGame(); const s = new Save(g, st);
  s.load(); st.quota = 10;
  assert.equal(s.write(), false);
  assert.equal(s.write(), false);
  assert.equal(st.getItem(KEY), good());
  assert.equal(g.toasts.length, 1);
  assert.match(g.toasts[0], /Couldn't save/);
  st.quota = Infinity;
  assert.equal(s.write(), true);
  assert.equal(s.failures, 0);
});

test("a write that reads back differently is reported as failed", () => {
  const st = new MemStorage(); st.mangle = (v) => v.slice(0, v.length - 3);
  const s = new Save(fakeGame(), st);
  s.load();
  assert.equal(s.write(), false);
  assert.match(String(s.lastError), /read-back/);
});

test("blocked storage: load is null, write fails quietly, nothing throws", () => {
  const st = new MemStorage({ [KEY]: good() }); st.blocked = true;
  const g = fakeGame(); const s = new Save(g, st);
  assert.equal(s.load(), null);
  assert.equal(s.write(), false);
  s.wipe();
  assert.equal(new Save(fakeGame(), null).load(), null);
  assert.equal(new Save(fakeGame(), null).write(), false);
});

test("?new=1 starts fresh, and its first write moves the old save to .prev", () => {
  const st = new MemStorage({ [KEY]: good() });
  const s = new Save(fakeGame({ params: "new=1" }), st);
  assert.equal(s.load(), null);
  assert.equal(s.write(), true);
  assert.equal(st.getItem(`${KEY}.prev`), good());
  assert.equal(JSON.parse(st.getItem(KEY)).boat, "kayak");
});

test("?nosave=1 never touches storage", () => {
  const st = new MemStorage({ [KEY]: good() });
  const s = new Save(fakeGame({ params: "nosave=1" }), st);
  assert.equal(s.write(), false);
  assert.equal(st.getItem(KEY), good());
  assert.equal(st.m.size, 1);
});

test("wipe (Start over) moves the save to .prev instead of deleting it", () => {
  const st = new MemStorage({ [KEY]: good() });
  const s = new Save(fakeGame(), st);
  s.wipe();
  assert.equal(st.getItem(KEY), null);
  assert.equal(st.getItem(`${KEY}.prev`), good());
});

test("other seeds use their own slot", () => {
  const st = new MemStorage({ [KEY]: good() });
  const s = new Save(fakeGame({ seed: 9 }), st);
  assert.equal(s.load(), null);
  s.write();
  assert.equal(st.getItem(KEY), good(), "the main save is untouched");
  assert.ok(st.getItem(`${KEY}.s9`));
});

test("tick does not write mid-rapid or while swimming, and flush follows the same rule", () => {
  const st = new MemStorage();
  const g = fakeGame(); const s = new Save(g, st);
  g.caller.rapid = { name: "the Throat" };
  s.tick(25); assert.equal(st.getItem(KEY), null); assert.equal(s.timer, 3);
  s.flush(); assert.equal(st.getItem(KEY), null);
  g.caller.rapid = null; g.boat.swimming = true;
  s.tick(5); assert.equal(st.getItem(KEY), null);
  g.boat.swimming = false;
  s.tick(5); assert.ok(st.getItem(KEY));
});

test("round trip: what is written loads back identically (bar the time)", () => {
  const st = new MemStorage();
  const s = new Save(fakeGame(), st); s.load(); s.write();
  const d = new Save(fakeGame(), st).load();
  assert.equal(d.boat, "kayak");
  assert.deepEqual(d.pos, { x: 1200, z: 900, heading: 0.5 });
  assert.deepEqual(d.boatsOwned, ["raft", "kayak"]);
  assert.deepEqual(d.colour, [0.1, 0.2, 0.3]);
  assert.deepEqual(d.races, { best: { "mirror-sprint": { ms: 61000 } } });
});

test("fuzz: random damage to a save never throws and always yields null or a usable save", () => {
  let seed = 42; const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const base = good();
  for (let i = 0; i < 400; i++) {
    const a = Math.floor(rand() * base.length), b = Math.min(base.length, a + Math.floor(rand() * 8));
    const damaged = base.slice(0, a) + String.fromCharCode(32 + Math.floor(rand() * 90)).repeat(b - a) + base.slice(b);
    const st = new MemStorage({ [KEY]: damaged });
    const g = fakeGame(); const s = new Save(g, st);
    const d = s.load();
    if (d) {
      assert.equal(typeof d, "object");
      s.apply(d);
      if (d.pos) assert.ok(Number.isFinite(d.pos.x) && Number.isFinite(d.pos.z));
      assert.ok(["raft", "kayak", "canoe", "dory", undefined].includes(d.boat));
    }
    assert.equal(s.write(), true);
    assert.ok(parseSave(st.getItem(KEY), { size: 3072 }).ok);
  }
});

test("a fresh start (?new=1) never replaces a save it could not keep as .prev", () => {
  const old = good({ boat: "dory" });
  const st = new MemStorage({ [KEY]: old });
  st.quota = old.length - 1;                        // the .prev copy fails
  const s = new Save(fakeGame({ params: "new=1" }), st);
  assert.equal(s.load(), null);
  assert.equal(s.write(), false);
  assert.equal(st.getItem(KEY), old);
  assert.equal(s.wipe(), false);
  assert.equal(st.getItem(KEY), old);
});

test("Start over is refused while a newer version's save is in the slot", () => {
  const newer = JSON.stringify({ v: 2 });
  const st = new MemStorage({ [KEY]: newer, [`${KEY}.prev`]: good({ boat: "raft" }) });
  const s = new Save(fakeGame(), st);
  s.load();
  assert.equal(s.wipe(), false);
  assert.equal(st.getItem(KEY), newer);
  assert.equal(JSON.parse(st.getItem(`${KEY}.prev`)).boat, "raft");
});

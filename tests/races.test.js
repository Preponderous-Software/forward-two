// Races when the relay goes away: a finish while offline is kept and its
// upload queued (never a hang); a group lobby falls back to a solo start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Races } from "../web/src/game/races.js";
import { Net, serverUrls, QUEUE_KEY, localTop } from "../web/src/net/net.js";
import { buildSkeleton } from "../web/src/world/terrain.js";

class FakeWs {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWs.all.push(this); }
  send(t) { this.sent.push(JSON.parse(t)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(d) { this.onmessage?.({ data: JSON.stringify(d) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

const rivers = buildSkeleton(1, "tiny").rivers;

function setup({ online = true } = {}) {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  globalThis.WebSocket = FakeWs; FakeWs.all = [];
  const toasts = [];
  const g = {
    time: 100, world: { seed: 1, rivers }, boat: { x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, kind: "raft", swimming: false, spec: { colour: [1, 0, 0] } },
    hud: { toast: (t) => toasts.push(t), flash() {}, raceResult() {} },
    journal: { feat() {}, earn() {} }, save: { soon() {} }, others: null,
  };
  g.net = new Net(g);
  // An address that refuses at once: the relay is down.
  g.net.urls = serverUrls("http://127.0.0.1:9");
  g.races = new Races(g);
  g.races.build();
  const c = g.races.courses[0];
  g.boat.x = c.gates[0].x; g.boat.z = c.gates[0].z;
  let ws = null;
  if (online) {
    g.net.connect(); ws = FakeWs.all.at(-1); ws.open();
    ws.msg({ t: "welcome", id: 1, now: Date.now(), players: [], races: [] });
  }
  return { g, c, ws, toasts, mem };
}

function teardown() { delete globalThis.localStorage; delete globalThis.WebSocket; }

test("a group lobby open when the relay dies falls back to a solo start, with a message", () => {
  const { g, c, ws, toasts } = setup();
  try {
    assert.equal(g.races.interact(), true);
    assert.equal(ws.sent.at(-1).t, "race-ready");
    assert.equal(g.races.pending.course, c);
    ws.msg({ t: "race-lobby", course: c.id, at: Date.now() + 8000, ready: [1] });
    assert.match(toasts.at(-1), /1 ready · start in [89] s/, "seconds, not milliseconds");
    assert.match(g.races.promptHtml(), /waiting for the group start/);
    ws.drop(1006);
    assert.equal(g.races.pending, null);
    assert.ok(g.races.lobby, "a solo countdown");
    assert.match(toasts.at(-1), /Lost the river relay.*Solo start in 5 s/);
    g.time += 5.1; g.races.tick();
    assert.ok(g.races.run, "the solo run starts");
  } finally { teardown(); }
});

test("a lobby with no start from the relay times out to solo; away from the buoy it is cancelled", () => {
  const { g, c, ws, toasts } = setup();
  try {
    g.races.interact();
    g.time += 16; g.races.tick();
    assert.equal(g.races.pending, null);
    assert.ok(g.races.lobby);
    assert.match(toasts.at(-1), /No start from the relay/);
    // Again, but paddled away before the relay vanished.
    g.races.lobby = null; g.races.run = null;
    g.races.interact();
    g.boat.x += 500;
    ws.drop();
    assert.equal(g.races.lobby, null);
    assert.match(toasts.at(-1), new RegExp(`group start at ${c.name} is off`));
  } finally { teardown(); }
});

test("a race start's elapsed milliseconds are converted to seconds", () => {
  const { g, c, ws } = setup();
  try {
    g.races.interact();
    ws.msg({ t: "race-start", course: c.id, at: Date.now() - 120, racers: [1] });
    assert.ok(g.races.run);
    const lag = g.time - g.races.run.t0;
    assert.ok(lag >= 0 && lag < 1, `t0 lag ${lag}`);
    assert.equal(g.races.pending, null);
  } finally { teardown(); }
});

test("finishing a race while the relay is down keeps the run locally and queues the upload, without hanging", async () => {
  const { g, c, toasts, mem } = setup({ online: false });
  try {
    g.races.begin(c, g.time - 42);
    const r = g.races.run;
    for (let i = 0; i < 50; i++) r.samples.push({ t: i * 100, x: c.gates[0].x + i * 0.4, z: c.gates[0].z, h: 0 });
    const t0 = Date.now();
    await g.races.finish(42);
    assert.ok(Date.now() - t0 < 6500, "bounded by the 6 s request timeout");
    assert.equal(g.races.best[c.id].ms, 42000);
    assert.equal(localTop(c.id)[0].ms, 42000, "on the local board");
    const q = JSON.parse(mem.get(QUEUE_KEY));
    assert.equal(q.length, 1);
    assert.deepEqual([q[0].course, q[0].ms], [c.id, 42000]);
    assert.match(toasts.at(-1), /saved here and will go to the online board/);
  } finally { teardown(); }
});

test("the upload queue dedupes, keeps the best per paddler, caps its size and expires old runs", () => {
  const { g } = setup({ online: false });
  try {
    const n = g.net;
    n.queueGhost({ course: "a", name: "P", ms: 5000, ghost: "x", at: Date.now() });
    assert.equal(n.queueGhost({ course: "a", name: "P", ms: 6000, ghost: "y", at: Date.now() }), false, "a slower run is not queued");
    n.queueGhost({ course: "a", name: "P", ms: 4000, ghost: "z", at: Date.now() });
    assert.deepEqual(n.queued().map((e) => e.ms), [4000]);
    for (let i = 0; i < 15; i++) n.queueGhost({ course: `c${i}`, name: "P", ms: 1000, ghost: "g", at: Date.now() });
    assert.equal(n.queued().length, 10);
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ course: "old", name: "P", ms: 1, ghost: "g", at: Date.now() - 8 * 86_400_000 }, "junk", null]));
    assert.deepEqual(n.queued(), []);
    localStorage.setItem(QUEUE_KEY, "{broken");
    assert.deepEqual(n.queued(), []);
  } finally { teardown(); }
});

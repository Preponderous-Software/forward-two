// Ghost codec, recorder, validation and the client helpers (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, sampleAt, GhostRecorder, checkGhost, toBase64url, fromBase64url } from "../web/src/net/ghost.js";
import { serverUrls, cleanName as clientName, randomName, Net } from "../web/src/net/net.js";
import { poseAt, Others, MAX_SLOTS } from "../web/src/net/others.js";
import { cleanName, cleanState, cleanColour, validCourse } from "../server/validate.js";

const TURN = Math.PI * 2;
const angDiff = (a, b) => Math.abs(((a - b + Math.PI) % TURN + TURN) % TURN - Math.PI);

// A plausible run: ~4 m/s along a gentle curve, one sample per 100 ms.
function run(n = 600, speed = 4) {
  const out = [];
  let x = 500, z = 800, h = 0.3;
  for (let i = 0; i < n; i++) {
    out.push({ t: i * 100, x, z, h });
    h += 0.02 * Math.sin(i / 30);
    x += Math.cos(h) * speed * 0.1; z += Math.sin(h) * speed * 0.1;
  }
  return out;
}

test("base64url round-trips every byte length", () => {
  for (let n = 0; n < 20; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 255);
    const s = toBase64url(b);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual([...fromBase64url(s)], [...b]);
  }
  assert.throws(() => fromBase64url("ab=c"));
});

test("codec round-trips within quantisation", () => {
  const src = run();
  const str = encode(src);
  assert.match(str, /^[A-Za-z0-9_-]+$/);
  const d = decode(str);
  assert.equal(d.length, src.length);
  for (let i = 0; i < src.length; i++) {
    assert.equal(d[i].t, src[i].t);
    assert.ok(Math.abs(d[i].x - src[i].x) <= 0.05 + 1e-9, `x ${i}`);
    assert.ok(Math.abs(d[i].z - src[i].z) <= 0.05 + 1e-9, `z ${i}`);
    assert.ok(angDiff(d[i].h, src[i].h) <= TURN / 512 + 1e-9, `h ${i}`);
  }
  // A one-minute run stays in the RFC's 2-6 KB band (or below).
  assert.ok(str.length < 6 * 1024, `size ${str.length}`);
});

test("heading wraps across +-PI without drift", () => {
  const src = [];
  for (let i = 0; i < 200; i++) src.push({ t: i * 100, x: 10, z: 10, h: Math.PI - 0.5 + i * 0.05 });
  const d = decode(encode(src));
  for (let i = 0; i < src.length; i++) assert.ok(angDiff(d[i].h, src[i].h) <= TURN / 512 + 1e-9);
  for (const s of d) assert.ok(s.h >= -Math.PI && s.h < Math.PI);
});

test("decode rejects garbage", () => {
  for (const bad of ["", "!!!!", "AA", toBase64url(Uint8Array.from([2, 0])), toBase64url(Uint8Array.from([1, 100, 0])), 42]) {
    assert.throws(() => decode(bad));
  }
  const ok = encode(run(5));
  assert.throws(() => decode(ok + "AAAA"));
});

test("sampleAt interpolates and wraps heading", () => {
  const d = [{ t: 0, x: 0, z: 0, h: Math.PI - 0.1 }, { t: 100, x: 10, z: -4, h: -Math.PI + 0.1 }];
  const m = sampleAt(d, 50);
  assert.ok(Math.abs(m.x - 5) < 1e-9 && Math.abs(m.z + 2) < 1e-9);
  // Short way round: through PI, not through 0.
  assert.ok(angDiff(m.h, Math.PI) < 1e-9, `h ${m.h}`);
  assert.equal(sampleAt(d, -10).x, 0);
  assert.equal(sampleAt(d, 500).x, 10);
  assert.equal(sampleAt(d, 500).done, true);
  assert.equal(sampleAt([], 0), null);
  // Binary search on a long ghost.
  const long = decode(encode(run(1000)));
  const s = sampleAt(long, 51_234);
  const a = long[512], b = long[513];
  assert.ok(s.x >= Math.min(a.x, b.x) - 1e-9 && s.x <= Math.max(a.x, b.x) + 1e-9);
});

test("recorder samples every 100 ms of uneven frames", () => {
  const r = new GhostRecorder();
  r.start(5000, 100, 200, 0.1);
  let t = 5000, x = 100;
  for (let i = 0; i < 300; i++) { t += 10 + (i % 7) * 4; x += 0.05; r.record(t, x, 200, 0.1); }
  const ghost = r.finish(t, x, 200, 0.1);
  const d = decode(ghost);
  assert.equal(d[0].t, 0);
  for (let i = 1; i < d.length; i++) {
    const dt = d[i].t - d[i - 1].t;
    assert.ok(dt > 0 && dt < 140, `dt ${dt}`);
  }
  assert.equal(d[d.length - 1].t, Math.round(t - 5000));
  assert.ok(checkGhost(ghost, t - 5000).ok);
});

test("checkGhost rejects teleports, bad timing and wrong durations", () => {
  const good = run(300);
  const ms = good[good.length - 1].t;
  assert.equal(checkGhost(encode(good), ms).ok, true);
  assert.equal(checkGhost(encode(good), ms + 900).ok, true);
  // Teleport: one sample jumps 50 m.
  const tele = good.map((s, i) => (i === 150 ? { ...s, x: s.x + 50 } : s));
  assert.match(checkGhost(encode(tele), ms).reason, /fast/);
  // Steady 17 m/s is too fast (the limit is 16 since 0.2.1).
  assert.match(checkGhost(encode(run(300, 17)), ms).reason, /fast/);
  // Time going backwards.
  const back = good.map((s, i) => (i === 100 ? { ...s, t: good[98].t } : s));
  assert.match(checkGhost(encode(back), ms).reason, /increasing/);
  // Claimed time far from the recording.
  assert.match(checkGhost(encode(good), ms - 5000).reason, /duration/);
  // Out of the world.
  assert.match(checkGhost(encode(good.map((s) => ({ ...s, x: s.x + 3000 }))), ms).reason, /bounds/);
  assert.equal(checkGhost("not a ghost", ms).ok, false);
  assert.equal(checkGhost("A".repeat(70_000), ms).ok, false);
});

test("names, colours, courses and states are validated", () => {
  assert.equal(cleanName("  Heron 42  "), "Heron 42");
  assert.equal(cleanName(""), "Paddler");
  assert.equal(cleanName("   "), "Paddler");
  assert.equal(cleanName("x".repeat(17)), "Paddler");
  assert.equal(cleanName("Bad\u0007bell"), "Paddler");
  assert.equal(cleanName("Zoë"), "Paddler");
  assert.equal(cleanName(42), "Paddler");
  assert.equal(clientName("ok"), "ok");
  assert.match(randomName(), /^[A-Z][a-z]+ \d{2}$/);
  assert.deepEqual(cleanColour("#ff0000"), [1, 0, 0]);
  assert.deepEqual(cleanColour([2, 0, 0]), [0.85, 0.24, 0.12]);
  assert.equal(validCourse("long-water-1"), true);
  assert.equal(validCourse("Bad_Course"), false);
  assert.equal(validCourse("../etc"), false);
  assert.equal(validCourse("a".repeat(41)), false);
  const s = { x: 10, z: 10, y: 3, h: 1, vx: 1, vz: 2, boat: "kayak", swim: false };
  assert.ok(cleanState(s));
  assert.equal(cleanState({ ...s, x: -1 }), null);
  assert.equal(cleanState({ ...s, z: 3101 }), null);
  assert.equal(cleanState({ ...s, vx: 30 }), null);
  assert.equal(cleanState({ ...s, y: NaN }), null);
  assert.equal(cleanState({ ...s, h: "1" }), null);
  assert.equal(cleanState({ ...s, boat: "yacht" }), null);
});

test("serverUrls derives ws and http from either", () => {
  assert.deepEqual(serverUrls("wss://f2.example.dev/ws"), { ws: "wss://f2.example.dev/ws", http: "https://f2.example.dev" });
  assert.deepEqual(serverUrls("https://f2.example.dev"), { ws: "wss://f2.example.dev/ws", http: "https://f2.example.dev" });
  assert.deepEqual(serverUrls("http://localhost:8790/"), { ws: "ws://localhost:8790/ws", http: "http://localhost:8790" });
  assert.deepEqual(serverUrls("ws://localhost:8790"), { ws: "ws://localhost:8790/ws", http: "http://localhost:8790" });
  assert.deepEqual(serverUrls("https://x.dev/f2"), { ws: "wss://x.dev/f2/ws", http: "https://x.dev/f2" });
  assert.equal(serverUrls(""), null);
  assert.equal(serverUrls("ftp://x"), null);
});

test("Net offline: local ghosts and boards, storage failures tolerated", async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const game = { boat: { x: 1, z: 1, y: 0, heading: 0, vx: 0, vz: 0, kind: "raft", spec: { colour: [1, 0, 0] } }, world: { seed: 7 }, time: 0 };
    const net = new Net(game);
    assert.equal(net.online, false);
    assert.match(net.profile.name, /^[A-Z][a-z]+ \d{2}$/);
    assert.ok(JSON.parse(mem.get("f2.profile")).name);
    net.connect(); net.tick(0.2); // no server: no-ops
    const ghost = encode(run(50));
    for (let i = 0; i < 12; i++) await net.submitGhost("rapid-1", { name: `P${i}`, ms: 10_000 + i * 100, ghost });
    const r = await net.submitGhost("rapid-1", { name: "Fast", ms: 4900, ghost });
    assert.equal(r.rank, 1);
    const board = await net.board("rapid-1");
    assert.equal(board.length, 10);
    assert.equal(board[0].name, "Fast");
    const gs = await net.fetchGhosts("rapid-1", 3);
    assert.equal(gs.length, 3);
    assert.equal(gs[0].decoded.length, 50);
    assert.deepEqual(await net.board("BAD"), []);
    // Storage that throws everywhere.
    globalThis.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    const net2 = new Net(game);
    assert.ok(net2.profile.name);
    assert.equal((await net2.submitGhost("rapid-1", { name: "x", ms: 5000, ghost })).ok, true);
    assert.deepEqual(await net2.board("rapid-1"), []);
  } finally { delete globalThis.localStorage; }
});

test("poseAt interpolates remote samples and extrapolates briefly", () => {
  const s = [{ at: 1000, x: 0, z: 0, y: 1, h: 0, vx: 10, vz: 0 }, { at: 1100, x: 1, z: 0, y: 1, h: 0.2, vx: 10, vz: 0 }];
  assert.ok(Math.abs(poseAt(s, 1050).x - 0.5) < 1e-9);
  assert.ok(Math.abs(poseAt(s, 1050).h - 0.1) < 1e-9);
  assert.ok(Math.abs(poseAt(s, 1200).x - 2) < 1e-9);
  assert.ok(Math.abs(poseAt(s, 5000).x - 4) < 1e-9); // capped at 300 ms
});

test("Others draws remote boats, ghosts and emotes within the slot budget", () => {
  let nextSlot = 0, live = 0, maxLive = 0;
  const bridge = {
    mesh() { live++; maxLive = Math.max(maxLive, live); return nextSlot++; },
    removeMesh() { live--; }, transform() {}, visible() {},
  };
  const players = new Map();
  for (let i = 1; i <= 32; i++) {
    players.set(i, { id: i, name: `P${i}`, colour: [i / 32, 0.5, 0.5], boat: ["raft", "kayak", "canoe", "dory"][i % 4], samples: [{ at: 0, x: 100 + i, z: 100, y: 1, h: 0, vx: 0, vz: 0 }] });
  }
  const handlers = {};
  const game = { bridge, time: 10, boat: { x: 100, z: 100, y: 1, kind: "kayak" }, net: { players, serverNow: 1000, on: (e, fn) => { handlers[e] = fn; } } };
  const o = new Others(game);
  const rows = () => {
    const mk = () => ({ rows: [], push(...v) { this.rows.push(v); } });
    return { labels: mk(), points: mk(), lights: mk() };
  };
  o.tick(0.6);
  let R = rows(), text = [];
  o.draw(R, text, 0.016);
  assert.equal(o.owned.size, 16);
  assert.equal(R.labels.rows.length, text.length);
  assert.ok(text.every((t) => /^[\x20-\x7e]+$/.test(t)));
  handlers.emote({ id: o.near[0], kind: "flare" });
  o.selfEmote("wave");
  const ghost = { name: "Old Heron", ms: 5000, decoded: decode(encode(run(60).map((s) => ({ ...s, x: s.x - 400, z: s.z - 700 })))) };
  o.showGhosts("rapid-1", Array(7).fill(ghost), 9.5);
  R = rows(); text = [];
  game.time = 10.5;
  o.draw(R, text, 0.016);
  assert.equal(o.owned.size, 21);
  assert.ok(text.includes("o/"));
  assert.ok(text.includes("ghost: Old Heron"));
  assert.ok(R.points.rows.length > 5 && R.points.rows.every((r) => r.length === 10));
  assert.ok(R.lights.rows.length === 1 && R.lights.rows[0].length === 12);
  assert.ok(R.labels.rows.every((r) => r.length === 8));
  // Players come and go with changing colours; the pool stays bounded.
  for (let round = 0; round < 10; round++) {
    for (const p of players.values()) p.colour = [Math.random(), Math.random(), Math.random()];
    o.tick(0.6); o.draw(rows(), [], 0.016);
  }
  assert.ok(live <= MAX_SLOTS, `live ${live}`);
  assert.ok(maxLive <= MAX_SLOTS, `max ${maxLive}`);
  o.clearGhosts();
  assert.equal(o.owned.size, 16);
});

// ------------------------------------------------------------ client robustness (fake socket)

class FakeWs {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWs.all.push(this); }
  send(t) { this.sent.push(JSON.parse(t)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(data) { this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function withFakeWs(fn) {
  const had = globalThis.WebSocket;
  globalThis.WebSocket = FakeWs; FakeWs.all = [];
  try { return fn(); } finally { globalThis.WebSocket = had; }
}

const netGame = () => ({ world: { seed: 5 }, time: 0, boat: { x: 10, z: 10, y: 1, heading: 0, vx: 0, vz: 0, kind: "raft", swimming: false, spec: { colour: [1, 0, 0] } } });
function onlineNet() {
  const n = new Net(netGame());
  n.urls = serverUrls("http://relay.test");
  n.connect();
  const ws = FakeWs.all.at(-1);
  ws.open();
  ws.msg({ t: "welcome", id: 1, now: Date.now(), players: [], races: [] });
  return { n, ws };
}

test("Net ignores malformed relay messages without throwing", () => withFakeWs(() => {
  const { n, ws } = onlineNet();
  assert.equal(n.online, true);
  const junk = ["null", "[]", "5", '"x"', "{", "{}", '{"t":7}', { t: "welcome" }, { t: "join" }, { t: "join", id: "2" },
    { t: "states" }, { t: "states", at: 1, list: "nope" }, { t: "states", at: NaN, list: [] }, { t: "states", at: 5, list: [null, 3, { id: 9 }] },
    { t: "leave" }, { t: "emote", kind: "shout", id: 2 }, { t: "race-lobby" }, { t: "race-lobby", course: 7, at: 1 },
    { t: "race-start", course: "c", at: 1 }, { t: "race-results", course: "c" }, { t: "time", c: "x", s: 1 }, { t: "unknown" }];
  for (const j of junk) assert.doesNotThrow(() => ws.msg(j), JSON.stringify(j));
  assert.equal(n.online, true);
  assert.equal(n.id, 1, "a bad welcome does not change who we are");
  assert.equal(n.races.size, 0);
  // A join with junk fields is cleaned; NaN states are dropped.
  ws.msg({ t: "join", id: 2, name: "<script>".repeat(5), colour: [9, 9, 9], boat: "tank" });
  const p = n.players.get(2);
  assert.deepEqual([p.name, p.boat], ["Paddler", "raft"]);
  assert.ok(p.colour.every((v) => v >= 0 && v <= 1));
  ws.msg({ t: "states", at: 100, list: [{ id: 2, x: NaN, z: 1, y: 1, h: 0 }] });
  assert.equal(p.samples.length, 0);
  ws.msg({ t: "states", at: 200, list: [{ id: 2, x: 5, z: 1, y: 1, h: 0, boat: "kayak" }] });
  assert.equal(p.samples.length, 1);
  assert.equal(p.samples[0].vx, 0);
  assert.equal(p.boat, "kayak");
}));

test("Net: a throwing handler does not break message handling", () => withFakeWs(() => {
  const { n, ws } = onlineNet();
  let got = 0;
  n.on("join", () => { throw new Error("ui bug"); });
  n.on("join", () => got++);
  ws.msg({ t: "join", id: 3, name: "A" });
  assert.equal(got, 1);
}));

test("Net gives up on a connection that never opens, then retries", async () => {
  await withFakeWs(async () => {
    const realSet = globalThis.setTimeout;
    const timers = [];
    globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
    try {
      const n = new Net(netGame());
      n.urls = serverUrls("http://relay.test");
      n.connect();
      const ws = FakeWs.all[0];
      const t = timers.find((x) => x.ms === 8000);
      assert.ok(t, "a connect timeout is armed");
      t.f();
      assert.equal(n.ws, null);
      assert.ok(n.retryAt > 0);
      // A late close from the abandoned socket changes nothing.
      const before = n.retryAt; ws.drop();
      assert.equal(n.retryAt, before);
      n.retryAt = Date.now() - 1; n.tick(0.1);
      assert.equal(FakeWs.all.length, 2, "tick reconnects once the backoff has passed");
    } finally { globalThis.setTimeout = realSet; }
  });
});

test("Net backoff: doubles with jitter, caps at 30 s, is long after full/rate-limit closes, resets on welcome", () => withFakeWs(() => {
  const { n, ws } = onlineNet();
  const offline = [];
  n.on("offline", (e) => offline.push(e.code));
  ws.drop(1006);
  assert.equal(n.online, false);
  assert.deepEqual(offline, [1006]);
  assert.equal(n.players.size, 0);
  for (let i = 0; i < 10; i++) { n.connect(); FakeWs.all.at(-1).drop(1006); }
  assert.equal(n.backoff, 30_000);
  assert.ok(n.retryAt - Date.now() <= 30_000 * 1.25 + 50);
  n.connect(); const w2 = FakeWs.all.at(-1); w2.open();
  w2.msg({ t: "welcome", id: 4, now: Date.now() });
  assert.equal(n.backoff, 1000);
  w2.msg({ t: "error", code: "full" }); w2.drop(1013);
  assert.ok(n.backoff >= 30_000, `backoff ${n.backoff}`);
  // retrySoon (page visible again / device online) pulls the retry forward.
  n.retrySoon();
  assert.ok(n.retryAt <= Date.now() + 250);
  // disconnect() is final: no retry is scheduled.
  n.disconnect();
  n.retryAt = 0; n.tick(1);
  assert.equal(n.ws, null);
}));

// A real server on an ephemeral port, driven by raw WebSocket clients
// (node:net + hand-built frames) and fetch.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect as tcp } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { frame, FrameParser, acceptKey } from "../server/ws.js";
import { encode } from "../web/src/net/ghost.js";

const T = { timeout: 60_000 };
let app, port, dataDir;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "f2-server-test-"));
  app = createApp({ data: dataDir, static: new URL("../web", import.meta.url).pathname, hub: { lobbyMs: 400, tickMs: 50 }, postsPerMin: 1000 });
  port = await app.listen(0, "127.0.0.1");
});

after(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

// ------------------------------------------------------------ raw client

class RawClient {
  static open(path = "/ws?seed=7") {
    return new Promise((ok, fail) => {
      const key = randomBytes(16).toString("base64");
      const sock = tcp(port, "127.0.0.1");
      const c = new RawClient(sock);
      let head = Buffer.alloc(0), upgraded = false;
      sock.on("error", fail);
      sock.on("data", (d) => {
        if (upgraded) return c.parser.push(d);
        head = Buffer.concat([head, d]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        const text = head.subarray(0, end).toString();
        if (!/^HTTP\/1.1 101/.test(text)) return fail(new Error(text));
        if (!text.includes(`Sec-WebSocket-Accept: ${acceptKey(key)}`)) return fail(new Error("bad accept"));
        upgraded = true;
        const rest = head.subarray(end + 4);
        if (rest.length) c.parser.push(rest);
        ok(c);
      });
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
  }
  constructor(sock) {
    this.sock = sock; this.inbox = []; this.waiters = []; this.closed = null; this.pongs = 0;
    this.parser = new FrameParser({
      requireMask: false, maxFrame: 1 << 20,
      onFrame: ({ opcode, payload }) => {
        if (opcode === 1) { this.inbox.push(JSON.parse(payload.toString())); this.flush(); }
        else if (opcode === 10) this.pongs++;
        else if (opcode === 8) { this.closed = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; this.flush(); }
      },
      onError: (code) => { this.closed = code; },
    });
    sock.on("close", () => { if (this.closed == null) this.closed = 1006; this.flush(); });
  }
  raw(opcode, payload) { this.sock.write(frame(opcode, payload, randomBytes(4))); }
  send(msg) { this.raw(1, JSON.stringify(msg)); }
  flush() { for (const w of [...this.waiters]) w(); }
  // Next message matching pred (consumed), or the close code if closed first.
  next(pred = () => true, ms = 15_000) {
    return new Promise((ok, fail) => {
      const check = () => {
        const i = this.inbox.findIndex(pred);
        if (i >= 0) { done(); ok(this.inbox.splice(i, 1)[0]); return; }
        if (this.closed != null) { done(); fail(new Error(`closed ${this.closed}`)); }
      };
      const timer = setTimeout(() => { done(); fail(new Error(`timeout waiting for ${pred.label || "message"}; inbox: ${this.inbox.map((m) => m.t).join(",")}`)); }, ms);
      const done = () => { clearTimeout(timer); this.waiters = this.waiters.filter((w) => w !== check); };
      this.waiters.push(check);
      check();
    });
  }
  waitClose(ms = 15_000) {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("not closed")), ms);
      const check = () => { if (this.closed != null) { clearTimeout(timer); ok(this.closed); } };
      this.waiters.push(check); check();
    });
  }
  end() { this.sock.destroy(); }
}

const type = (t, extra = () => true) => Object.assign((m) => m.t === t && extra(m), { label: t });

// ------------------------------------------------------------ HTTP basics

test("healthz, static MIME types and CORS", T, async () => {
  let r = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  r = await fetch(`http://127.0.0.1:${port}/engine/forward-two.wasm`, { method: "HEAD" });
  assert.equal(r.headers.get("content-type"), "application/wasm");
  r = await fetch(`http://127.0.0.1:${port}/src/net/ghost.js`);
  assert.match(r.headers.get("content-type"), /^text\/javascript/);
  await r.text();
  r = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(r.headers.get("content-type"), /^text\/html/);
  await r.text();
  r = await fetch(`http://127.0.0.1:${port}/%2e%2e/package.json`);
  assert.notEqual(r.status, 200);
  await r.text();
  r = await fetch(`http://127.0.0.1:${port}/api/board/some-course`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

// ------------------------------------------------------------ live rooms

test("two clients: hello, join, states, emotes, leave", T, async () => {
  const a = await RawClient.open(), b = await RawClient.open();
  a.send({ t: "hello", name: "  Heron 42 ", colour: [0.1, 0.2, 0.3], boat: "kayak" });
  const wa = await a.next(type("welcome"));
  assert.equal(wa.name, "Heron 42");
  assert.equal(wa.seed, "7");
  assert.equal(wa.room, "river");
  b.send({ t: "hello", name: "\u0001evil\u0002", boat: "yacht" });
  const wb = await b.next(type("welcome"));
  assert.equal(wb.name, "Paddler");
  assert.equal(wb.players.length, 1);
  assert.equal(wb.players[0].name, "Heron 42");
  const j = await a.next(type("join"));
  assert.equal(j.id, wb.id);
  assert.equal(j.boat, "raft");

  // Clock sync.
  b.send({ t: "time", c: 123 });
  const tm = await b.next(type("time"));
  assert.equal(tm.c, 123);
  assert.ok(Math.abs(tm.s - Date.now()) < 5000);

  // States relay (batched); bad states are dropped.
  a.send({ t: "state", x: 1200, z: 900, y: 12, h: 1.5, vx: 2, vz: -1, boat: "kayak", swim: false });
  b.send({ t: "state", x: 5000, z: 900, y: 12, h: 0, vx: 0, vz: 0 }); // out of the world
  b.send({ t: "state", x: 10, z: 10, y: 1, h: 0, vx: 40, vz: 0 });     // too fast
  const st = await b.next(type("states", (m) => m.list.some((s) => s.id === wa.id)));
  const s = st.list.find((x) => x.id === wa.id);
  assert.deepEqual([s.x, s.z, s.boat, s.swim], [1200, 900, "kayak", false]);
  assert.ok(Number.isFinite(st.at));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!a.inbox.some((m) => m.t === "states" && m.list.some((x) => x.id === wb.id)), "invalid states must not relay");

  // Emotes: known kinds only.
  b.send({ t: "emote", kind: "flare" });
  const em = await a.next(type("emote"));
  assert.deepEqual([em.id, em.kind], [wb.id, "flare"]);
  b.send({ t: "emote", kind: "hello everyone" });
  b.send({ t: "chat", text: "hi" });

  // Ping/pong at the frame level.
  a.raw(9, Buffer.from("hi"));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(a.pongs, 1);

  // Leave.
  b.end();
  const lv = await a.next(type("leave"));
  assert.equal(lv.id, wb.id);
  a.end();
});

test("rooms are keyed by seed and name", T, async () => {
  const a = await RawClient.open("/ws?seed=1&room=alpha"), b = await RawClient.open("/ws?seed=2&room=alpha");
  a.send({ t: "hello", name: "A" });
  b.send({ t: "hello", name: "B" });
  await a.next(type("welcome"));
  const wb = await b.next(type("welcome"));
  assert.equal(wb.players.length, 0);
  a.end(); b.end();
});

test("group race: lobby, start, finishes, results", T, async () => {
  const a = await RawClient.open("/ws?seed=7&room=racing"), b = await RawClient.open("/ws?seed=7&room=racing");
  a.send({ t: "hello", name: "Alpha" });
  const wa = await a.next(type("welcome"));
  b.send({ t: "hello", name: "Bravo" });
  const wb = await b.next(type("welcome"));
  a.send({ t: "race-ready", course: "BAD COURSE" }); // ignored
  a.send({ t: "race-ready", course: "first-rapid" });
  const lob = await b.next(type("race-lobby"));
  assert.equal(lob.course, "first-rapid");
  assert.deepEqual(lob.ready, [wa.id]);
  b.send({ t: "race-ready", course: "first-rapid" });
  const lob2 = await a.next(type("race-lobby", (m) => m.ready.length === 2));
  assert.equal(lob2.at, lob.at);
  const start = await a.next(type("race-start"));
  await b.next(type("race-start"));
  assert.deepEqual(start.racers.sort(), [wa.id, wb.id].sort());
  // A time faster than the server clock allows is refused.
  b.send({ t: "race-finish", course: "first-rapid", ms: 999_999 });
  await new Promise((r) => setTimeout(r, 1200));
  b.send({ t: "race-finish", course: "first-rapid", ms: 1100 });
  const r1 = await a.next(type("race-results"));
  assert.equal(r1.final, false);
  assert.deepEqual(r1.results.map((x) => [x.name, x.ms, x.place]), [["Bravo", 1100, 1]]);
  a.send({ t: "race-finish", course: "first-rapid", ms: 1150 });
  const r2 = await b.next(type("race-results", (m) => m.final));
  assert.deepEqual(r2.results.map((x) => x.name), ["Bravo", "Alpha"]);
  a.end(); b.end();
});

test("abuse: unmasked, oversized and binary frames close; floods are cut", T, async () => {
  const a = await RawClient.open();
  a.sock.write(frame(1, JSON.stringify({ t: "time", c: 1 }))); // unmasked
  assert.equal(await a.waitClose(), 1002);
  a.end();

  const b = await RawClient.open();
  b.raw(1, "x".repeat(70 * 1024));
  assert.equal(await b.waitClose(), 1009);
  b.end();

  const c = await RawClient.open();
  c.raw(2, Buffer.from([1, 2, 3]));
  assert.equal(await c.waitClose(), 1003);
  c.end();

  const d = await RawClient.open();
  d.send({ t: "hello", name: "Flood" });
  await d.next(type("welcome"));
  for (let i = 0; i < 300; i++) d.send({ t: "emote", kind: "bell" });
  assert.equal(await d.waitClose(), 1008);
  d.end();
});

test("room cap", T, async () => {
  const conns = [];
  for (let i = 0; i < 32; i++) {
    const c = await RawClient.open("/ws?seed=9&room=full");
    c.send({ t: "hello", name: `P${i}` });
    await c.next(type("welcome"));
    conns.push(c);
  }
  const extra = await RawClient.open("/ws?seed=9&room=full");
  extra.send({ t: "hello", name: "Late" });
  const err = await extra.next(type("error"));
  assert.equal(err.code, "full");
  assert.equal(await extra.waitClose(), 1013);
  for (const c of conns) c.end();
  extra.end();
});

// ------------------------------------------------------------ ghosts over HTTP

function run(n, speed = 4, x0 = 500) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ t: i * 100, x: x0 + i * speed * 0.1, z: 800, h: 0 });
  return out;
}

async function post(course, body) {
  const r = await fetch(`http://127.0.0.1:${port}/api/ghosts/${course}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cors: r.headers.get("access-control-allow-origin") };
}

test("ghost POST validates, ranks and stores; GET returns top N and boards", T, async () => {
  const ghost = encode(run(101));  // 10 s
  let r = await post("first-rapid", { name: "Heron 42", ms: 10_000, ghost });
  assert.equal(r.status, 201);
  assert.equal(r.body.rank, 1);
  assert.equal(r.cors, "*");
  r = await post("first-rapid", { name: "Otter 11", ms: 8000, ghost: encode(run(81, 5)) });
  assert.equal(r.body.rank, 1);
  // Slower run by the same name does not displace the best.
  r = await post("first-rapid", { name: "Otter 11", ms: 10_000, ghost });
  assert.equal(r.body.rank, null);

  // Rejections.
  const tele = run(101).map((s, i) => (i === 50 ? { ...s, x: s.x + 80 } : s));
  r = await post("first-rapid", { name: "Cheat", ms: 10_000, ghost: encode(tele) });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /fast/);
  r = await post("first-rapid", { name: "Liar", ms: 4000, ghost });
  assert.equal(r.status, 422);
  r = await post("First_Rapid", { name: "x", ms: 10_000, ghost });
  assert.equal(r.status, 400);
  r = await post("first-rapid", { name: "x", ms: 10_000, ghost: "%%%" });
  assert.equal(r.status, 422);
  r = await post("first-rapid", { name: "x", ms: 10_000, ghost: "A".repeat(70_000) });
  assert.equal(r.status, 413);

  // Bad names are stored as Paddler.
  r = await post("first-rapid", { name: "☃ snowman", ms: 9000, ghost: encode(run(91, 4.4)) });
  assert.equal(r.body.rank, 2);

  let g = await (await fetch(`http://127.0.0.1:${port}/api/ghosts/first-rapid?n=2`)).json();
  assert.equal(g.ghosts.length, 2);
  assert.deepEqual(g.ghosts.map((x) => x.name), ["Otter 11", "Paddler"]);
  assert.equal(typeof g.ghosts[0].ghost, "string");
  const b = await (await fetch(`http://127.0.0.1:${port}/api/board/first-rapid`)).json();
  assert.deepEqual(b.board.map((x) => [x.rank, x.name, x.ms]), [[1, "Otter 11", 8000], [2, "Paddler", 9000], [3, "Heron 42", 10_000]]);
  assert.ok(b.board.every((x) => !("ghost" in x)));

  // Persisted atomically to the data dir.
  const file = JSON.parse(await readFile(join(dataDir, "ghosts", "first-rapid.json"), "utf8"));
  assert.equal(file.length, 3);

  // Top 20 only.
  const res = await Promise.all(Array.from({ length: 25 }, (_, i) => post("busy", { name: `P${i}`, ms: 10_000 + i * 10, ghost })));
  assert.ok(res.every((x) => x.status === 201 || x.status === 200));
  const bb = await (await fetch(`http://127.0.0.1:${port}/api/board/busy`)).json();
  assert.equal(bb.board.length, 20);
  assert.equal(bb.board[19].name, "P19");
});

test("ghost POSTs are rate limited per IP", T, async () => {
  const dir = await mkdtemp(join(tmpdir(), "f2-limit-"));
  const small = createApp({ data: dir, postsPerMin: 3 });
  const p2 = await small.listen(0, "127.0.0.1");
  try {
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`http://127.0.0.1:${p2}/api/ghosts/c`, { method: "POST", body: JSON.stringify({ name: `P${i}`, ms: 10_000, ghost: encode(run(101)) }) });
      statuses.push(r.status); await r.text();
    }
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
  } finally { await small.close(); await rm(dir, { recursive: true, force: true }); }
});

test("GhostStore keeps the top 20", T, async () => {
  const { GhostStore } = await import("../server/ghosts.js");
  const dir = await mkdtemp(join(tmpdir(), "f2-store-"));
  try {
    const s = new GhostStore(dir);
    const ghost = encode(run(101));
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.submit("c", { name: `P${i}`, ms: 10_000 + (i % 5) * 100 - Math.floor(i / 5), ghost })));
    const board = await s.board("c");
    assert.equal(board.length, 20);
    for (let i = 1; i < board.length; i++) assert.ok(board[i].ms >= board[i - 1].ms);
    const again = new GhostStore(dir);
    assert.equal((await again.board("c")).length, 20);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------ the real client

test("Net client against the server: online, players, emotes, ghosts", T, async () => {
  const { Net, serverUrls } = await import("../web/src/net/net.js");
  const { decode } = await import("../web/src/net/ghost.js");
  const mkGame = (x) => ({ world: { seed: 31 }, time: 0, boat: { x, z: 700, y: 5, heading: 0.5, vx: 1, vz: 0, kind: "canoe", swimming: false, spec: { colour: [0.2, 0.5, 0.35] } } });
  const until = async (cond, ms = 15_000) => {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error("condition timed out"); await new Promise((r) => setTimeout(r, 25)); }
  };
  const g1 = mkGame(1000), g2 = mkGame(1010);
  const n1 = new Net(g1), n2 = new Net(g2);
  for (const n of [n1, n2]) { n.urls = serverUrls(`http://127.0.0.1:${port}`); n.room = "client-test"; }
  const emotes = [];
  n2.on("emote", (e) => emotes.push(e));
  n1.connect(); n2.connect();
  await until(() => n1.online && n2.online);
  // Drive the 10 Hz send loop.
  const pump = setInterval(() => { n1.tick(0.1); n2.tick(0.1); }, 50);
  try {
    await until(() => n2.players.get(n1.id)?.samples.length > 0);
    const p = n2.players.get(n1.id);
    assert.equal(p.boat, "canoe");
    assert.equal(p.samples.at(-1).x, 1000);
    await until(() => n1.rtt < Infinity);
    assert.ok(Math.abs(n1.serverTimeOffset) < 5000);
    n1.emote("bell");
    assert.equal(n1.emote("shout"), false);
    await until(() => emotes.length > 0);
    assert.deepEqual([emotes[0].id, emotes[0].kind], [n1.id, "bell"]);

    const ghost = encode(run(51));
    const sub = await n1.submitGhost("client-course", { name: "Kingfisher 7", ms: 5000, ghost });
    assert.equal(sub.ok, true);
    assert.equal(sub.rank, 1);
    const gs = await n2.fetchGhosts("client-course", 5);
    assert.equal(gs.length, 1);
    assert.equal(gs[0].decoded.length, decode(ghost).length);
    const board = await n2.board("client-course");
    assert.deepEqual(board.map((r) => [r.name, r.ms]), [["Kingfisher 7", 5000]]);

    const id1 = n1.id;
    const left = new Promise((r) => n2.on("leave", r));
    n1.disconnect();
    const who = await left;
    assert.equal(who.id, id1);
    assert.equal(n2.players.size, 0);
  } finally { clearInterval(pump); n1.disconnect(); n2.disconnect(); }
});

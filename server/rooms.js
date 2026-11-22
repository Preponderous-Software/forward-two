// Live rooms: hello, boat states relayed at ~10 Hz, emotes, group races and
// clock sync. Transport-agnostic: a "conn" only needs send(text), close(code,
// reason) and an 'message' / 'close' event emitter interface.
import {
  cleanName, cleanColour, cleanBoat, cleanRoom, cleanSeed, cleanState,
  validCourse, validEmote, validRaceMs,
} from "./validate.js";

export const DEFAULTS = {
  maxPerRoom: 32,
  tickMs: 100,            // state relay period
  lobbyMs: 10_000,        // race lobby before the start
  raceMaxMs: 30 * 60_000, // a race is closed this long after its start
  rate: 20,               // messages per second, sustained
  burst: 40,              // token bucket size
  strikes: 60,            // dropped messages before the connection is cut
  emoteGapMs: 1000,
  maxMessage: 4096,       // client messages are small; anything bigger is abuse
};

export class Hub {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.now = opts.now || (() => Date.now());
    this.rooms = new Map();   // key -> Room
    this.nextId = 1;
    this.timer = setInterval(() => this.tick(), this.o.tickMs);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); for (const r of this.rooms.values()) for (const p of r.players.values()) p.conn.close(1001, "server stopping"); }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.size;
    return { rooms: this.rooms.size, players };
  }

  // Attach a connection. defaults: {seed, room} from the URL query.
  attach(conn, defaults = {}) {
    const c = { conn, id: 0, room: null, tokens: this.o.burst, last: this.now(), strikes: 0, lastEmote: 0 };
    conn.on("message", (text) => this.onMessage(c, text, defaults));
    conn.on("close", () => this.leave(c));
    return c;
  }

  send(c, msg) { c.conn.send(JSON.stringify(msg)); }

  // Token bucket. Returns false when the message should be dropped.
  allow(c) {
    const t = this.now();
    c.tokens = Math.min(this.o.burst, c.tokens + (t - c.last) / 1000 * this.o.rate);
    c.last = t;
    if (c.tokens >= 1) { c.tokens -= 1; return true; }
    return this.strike(c, "rate limit");
  }
  strike(c, why) {
    c.strikes++;
    if (c.strikes > this.o.strikes) c.conn.close(1008, why);
    return false;
  }

  onMessage(c, text, defaults) {
    if (!this.allow(c)) return;
    if (text.length > this.o.maxMessage) return this.strike(c, "message too large");
    let m;
    try { m = JSON.parse(text); } catch { return this.strike(c, "bad json"); }
    if (!m || typeof m !== "object" || typeof m.t !== "string") return this.strike(c, "bad message");
    if (m.t === "time") return this.send(c, { t: "time", c: Number.isFinite(m.c) ? m.c : 0, s: this.now() });
    if (m.t === "hello") return this.hello(c, m, defaults);
    const p = c.player;
    if (!p) return this.strike(c, "hello first");
    switch (m.t) {
      case "state": {
        const s = cleanState(m);
        if (!s) return this.strike(c, "bad state");
        if (s.boat === undefined) s.boat = p.boat;
        p.boat = s.boat; p.state = s; p.dirty = true;
        return;
      }
      case "emote": {
        if (!validEmote(m.kind)) return this.strike(c, "bad emote");
        const t = this.now();
        if (t - c.lastEmote < this.o.emoteGapMs) return;
        c.lastEmote = t;
        return this.broadcast(c.room, { t: "emote", id: p.id, kind: m.kind });
      }
      case "race-ready": return this.raceReady(c, m.course);
      case "race-finish": return this.raceFinish(c, m.course, m.ms);
      case "bye": return c.conn.close(1000, "bye");
      default: return this.strike(c, "unknown type");
    }
  }

  hello(c, m, defaults) {
    if (c.player) {
      // A second hello updates the profile (new boat or colour).
      const p = c.player;
      p.name = cleanName(m.name); p.colour = cleanColour(m.colour); p.boat = cleanBoat(m.boat);
      return this.broadcast(c.room, { t: "join", ...this.pub(p) });
    }
    const seed = cleanSeed(m.seed ?? defaults.seed), name = cleanRoom(m.room ?? defaults.room);
    const key = `${seed}/${name}`;
    let room = this.rooms.get(key);
    if (!room) { room = { key, seed, name, players: new Map(), races: new Map() }; this.rooms.set(key, room); }
    if (room.players.size >= this.o.maxPerRoom) {
      if (!room.players.size) this.rooms.delete(key);
      this.send(c, { t: "error", code: "full", msg: "This stretch of river is full." });
      return c.conn.close(1013, "room full");
    }
    const p = { id: this.nextId++, name: cleanName(m.name), colour: cleanColour(m.colour), boat: cleanBoat(m.boat), state: null, dirty: false, conn: c.conn };
    c.player = p; c.id = p.id; c.room = room;
    this.send(c, {
      t: "welcome", id: p.id, seed, room: name, now: this.now(), name: p.name,
      players: [...room.players.values()].map((q) => ({ ...this.pub(q), state: q.state })),
      races: [...room.races.values()].filter((r) => r.phase === "lobby").map((r) => ({ course: r.course, at: r.at, ready: [...r.ready] })),
    });
    room.players.set(p.id, p);
    this.broadcast(room, { t: "join", ...this.pub(p) }, p.id);
  }

  pub(p) { return { id: p.id, name: p.name, colour: p.colour, boat: p.boat }; }

  leave(c) {
    const room = c.room, p = c.player;
    if (!room || !p) return;
    c.room = null;
    room.players.delete(p.id);
    for (const r of room.races.values()) { r.ready.delete(p.id); r.racers?.delete(p.id); }
    this.broadcast(room, { t: "leave", id: p.id });
    if (!room.players.size) this.rooms.delete(room.key);
  }

  broadcast(room, msg, exceptId = 0) {
    if (!room) return;
    const text = JSON.stringify(msg);
    for (const p of room.players.values()) if (p.id !== exceptId) p.conn.send(text);
  }

  // ------------------------------------------------------------ races

  raceReady(c, course) {
    if (!validCourse(course)) return this.strike(c, "bad course");
    const room = c.room, t = this.now();
    let r = room.races.get(course);
    if (r && r.phase === "racing") {
      // A race is under way on this course; a new lobby can open after it.
      return this.send(c, { t: "race-busy", course, at: r.at });
    }
    if (!r) {
      r = { course, phase: "lobby", at: t + this.o.lobbyMs, ready: new Set(), racers: null, results: [] };
      room.races.set(course, r);
    }
    r.ready.add(c.player.id);
    this.broadcast(room, { t: "race-lobby", course, at: r.at, ready: [...r.ready], now: t });
  }

  raceFinish(c, course, ms) {
    if (!validCourse(course)) return this.strike(c, "bad course");
    const r = c.room.races.get(course);
    if (!r || r.phase !== "racing" || !r.racers.has(c.player.id)) return;
    if (!validRaceMs(ms)) return this.strike(c, "bad time");
    // The claimed time cannot beat the server's own clock (with 2 s slack for latency).
    if (ms > this.now() - r.at + 2000) return this.strike(c, "time from the future");
    if (r.results.some((x) => x.id === c.player.id)) return;
    r.results.push({ id: c.player.id, name: c.player.name, ms: Math.round(ms) });
    r.results.sort((a, b) => a.ms - b.ms);
    const done = r.results.length >= r.racers.size;
    this.sendResults(c.room, r, done);
  }

  sendResults(room, r, final) {
    this.broadcast(room, { t: "race-results", course: r.course, final, results: r.results.map((x, i) => ({ ...x, place: i + 1 })) });
    if (final) room.races.delete(r.course);
  }

  tickRaces(room, t) {
    for (const r of room.races.values()) {
      if (r.phase === "lobby" && t >= r.at) {
        if (!r.ready.size) { room.races.delete(r.course); continue; }
        r.phase = "racing"; r.racers = new Set(r.ready); r.at = t;
        this.broadcast(room, { t: "race-start", course: r.course, at: t, racers: [...r.racers] });
      } else if (r.phase === "racing" && (t - r.at > this.o.raceMaxMs || r.results.length >= r.racers.size)) {
        this.sendResults(room, r, true);
      }
    }
  }

  // ------------------------------------------------------------ relay

  tick() {
    const t = this.now();
    for (const room of this.rooms.values()) {
      this.tickRaces(room, t);
      const list = [];
      for (const p of room.players.values()) if (p.dirty) { p.dirty = false; list.push({ id: p.id, ...p.state }); }
      if (list.length) this.broadcast(room, { t: "states", at: t, list });
    }
  }
}

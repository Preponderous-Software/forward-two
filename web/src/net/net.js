// The live client and the ghost/board client.
//
// Server: <meta name="f2-server" content="..."> or ?server=..., either a ws(s)
// URL or an http(s) base; the other is derived. With neither the game runs
// offline: online=false, and ghosts and boards live in localStorage.
import { decode, checkGhost } from "./ghost.js";

const EMOTES = new Set(["wave", "flare", "bell"]);
const COURSE_RE = /^[a-z0-9-]{1,40}$/;
const LOCAL_KEEP = 10;
const okCourse = (c) => typeof c === "string" && COURSE_RE.test(c);
const CONNECT_MS = 8000;
export const QUEUE_KEY = "f2.ghosts.queue";   // runs waiting for the online board
const QUEUE_MAX = 10, QUEUE_DAYS = 7;              // give up on a connection that never opens
const BOAT_KINDS = new Set(["raft", "kayak", "canoe", "dory", "walker"]);
const PROFILE_KEY = "f2.profile";
const BIRDS = ["Heron", "Otter", "Kingfisher", "Dipper", "Osprey", "Beaver", "Salmon", "Merganser", "Egret", "Plover", "Wren", "Teal", "Grebe", "Trout", "Mink", "Loon"];

// ------------------------------------------------------------ storage helpers

function store() { try { return globalThis.localStorage || null; } catch { return null; } }
function readJson(key, fallback) {
  try { const s = store()?.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}
function writeJson(key, v) { try { store()?.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }

export function cleanName(name) {
  if (typeof name !== "string") return "Paddler";
  const t = name.trim();
  return t.length >= 1 && t.length <= 16 && /^[\x20-\x7e]+$/.test(t) ? t : "Paddler";
}

export function randomName(rand = Math.random) {
  return `${BIRDS[Math.floor(rand() * BIRDS.length)]} ${10 + Math.floor(rand() * 90)}`;
}

// Turns a server setting into {ws, http}. Accepts ws://, wss://, http://, https://,
// or a bare host. Returns null for empty input.
export function serverUrls(raw, pageProtocol = "https:") {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = (pageProtocol === "http:" ? "http://" : "https://") + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const secure = u.protocol === "wss:" || u.protocol === "https:";
  if (!/^(wss?|https?):$/.test(u.protocol)) return null;
  let path = u.pathname.replace(/\/+$/, "");
  const isWs = u.protocol.startsWith("ws");
  let base = path, wsPath = path;
  if (isWs) { base = path.replace(/\/ws$/, ""); wsPath = path || "/ws"; }
  else wsPath = `${path}/ws`;
  return {
    ws: `${secure ? "wss" : "ws"}://${u.host}${wsPath}`,
    http: `${secure ? "https" : "http"}://${u.host}${base}`,
  };
}

// ------------------------------------------------------------ local boards

const localKey = (course) => `f2.ghosts.${course}`;

export function localSubmit(course, { name, ms, ghost }) {
  const list = readJson(localKey(course), []);
  const arr = Array.isArray(list) ? list.filter((e) => e && Number.isFinite(e.ms) && typeof e.ghost === "string") : [];
  const entry = { name: cleanName(name), ms: Math.round(ms), at: Date.now(), ghost };
  arr.push(entry);
  arr.sort((a, b) => a.ms - b.ms || a.at - b.at);
  const kept = arr.slice(0, LOCAL_KEEP);
  const idx = kept.indexOf(entry);
  writeJson(localKey(course), kept);
  return { ok: true, local: true, rank: idx >= 0 ? idx + 1 : null };
}

export function localTop(course) {
  const list = readJson(localKey(course), []);
  return Array.isArray(list) ? list.filter((e) => e && Number.isFinite(e.ms) && typeof e.ghost === "string") : [];
}

function withDecoded(list) {
  const out = [];
  for (const e of list) {
    try { out.push({ ...e, decoded: decode(e.ghost) }); } catch { /* skip bad ghosts */ }
  }
  return out;
}

// ------------------------------------------------------------ Net

export class Net {
  constructor(game) {
    this.game = game;
    this.online = false;
    this.id = 0;
    this.players = new Map();         // id -> {id, name, colour, boat, samples[]}
    this.serverTimeOffset = 0;        // server ms - local ms
    this.rtt = Infinity;
    this.handlers = new Map();
    this.ws = null;
    this.backoff = 1000;
    this.retryAt = 0;
    this.sendAcc = 0;
    this.pingAcc = 0;
    this.timeSamples = [];
    this.races = new Map();           // course -> {phase, at, ready, racers, results}
    this.urls = this.findServer();
    this.room = this.query("room") || "river";
    this.profile = this.loadProfile();
    // Back in view or back online: try the relay again now, not after the backoff.
    if (typeof globalThis.addEventListener === "function" && globalThis.document) {
      globalThis.addEventListener("online", () => this.retrySoon());
      globalThis.document.addEventListener?.("visibilitychange", () => { if (globalThis.document.visibilityState === "visible") this.retrySoon(); });
    }
  }

  // ---------------------------------------------------------- setup

  query(k) {
    try { return new URLSearchParams(globalThis.location?.search || "").get(k); } catch { return null; }
  }

  findServer() {
    let raw = this.query("server");
    if (raw === "off") return null;          // ?server=off plays offline
    if (!raw) {
      try { raw = globalThis.document?.querySelector('meta[name="f2-server"]')?.getAttribute("content") || ""; } catch { raw = ""; }
    }
    return serverUrls(raw, globalThis.location?.protocol);
  }

  loadProfile() {
    const p = readJson(PROFILE_KEY, null);
    const name = p && typeof p.name === "string" ? cleanName(p.name) : null;
    const colour = p && Array.isArray(p.colour) && p.colour.length === 3 && p.colour.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ? p.colour : null;
    const prof = { name: name && name !== "Paddler" ? name : randomName(), colour };
    if (!p || prof.name !== p.name) writeJson(PROFILE_KEY, { name: prof.name, colour: prof.colour });
    return prof;
  }

  setProfile({ name, colour } = {}) {
    if (name !== undefined) this.profile.name = cleanName(name);
    if (colour !== undefined) this.profile.colour = colour;
    writeJson(PROFILE_KEY, this.profile);
    this.sendHello();
  }

  colour() {
    const g = this.game;
    return this.profile.colour || g.colour || g.boat?.spec?.colour || [0.85, 0.24, 0.12];
  }

  get serverNow() { return Date.now() + this.serverTimeOffset; }

  // ---------------------------------------------------------- events

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }
  emit(event, data) {
    for (const fn of this.handlers.get(event) || []) {
      try { fn(data); } catch (e) { console.warn("net handler", event, e); }
    }
  }

  // ---------------------------------------------------------- connection

  connect() {
    if (!this.urls || typeof globalThis.WebSocket !== "function") return;
    if (this.ws) return;
    let ws;
    const seed = this.game.world?.seed;
    const qs = `seed=${encodeURIComponent(String(seed ?? 0))}&room=${encodeURIComponent(this.room)}`;
    try { ws = new WebSocket(`${this.urls.ws}${this.urls.ws.includes("?") ? "&" : "?"}${qs}`); } catch { return this.scheduleRetry(); }
    this.ws = ws;
    // A connection that hangs (a black-holed relay) is given up after a while.
    const openTimer = setTimeout(() => { if (this.ws === ws && ws.readyState === 0) { try { ws.close(); } catch { /* ignore */ } this.lost(ws, 1006); } }, CONNECT_MS);
    ws.onopen = () => {
      clearTimeout(openTimer);
      this.sendHello();
      this.timeSamples = [];
      for (let i = 0; i < 3; i++) setTimeout(() => this.ping(), i * 300);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      try { this.handle(m); } catch (err) { console.warn("net message", err); }
    };
    ws.onclose = (e) => { clearTimeout(openTimer); this.lost(ws, e?.code); };
    ws.onerror = () => { /* onclose follows */ };
  }

  // The connection is gone (closed, refused or timed out): go offline and
  // schedule a retry. A relay that turned us away (full, busy, rate limit)
  // is left alone for longer.
  lost(ws, code) {
    if (this.ws !== ws) return;
    const was = this.online;
    this.ws = null; this.online = false; this.id = 0;
    this.players.clear(); this.races.clear();
    if (was) this.emit("offline", { code });
    if (code === 1008 || code === 1013) this.backoff = Math.max(this.backoff, 15_000);
    if (this.urls) this.scheduleRetry();
  }

  // Try again soon (the page came back into view, or the device came back online).
  retrySoon() { if (!this.ws && this.urls) this.retryAt = Math.min(this.retryAt || Infinity, Date.now() + 250); }

  scheduleRetry() {
    const jitter = 0.75 + Math.random() * 0.5;
    this.retryAt = Date.now() + this.backoff * jitter;
    this.backoff = Math.min(30_000, this.backoff * 2);
  }

  disconnect() {
    this.urls = null;
    const ws = this.ws;
    try { ws?.close(1000, "bye"); } catch { /* ignore */ }
    if (ws) this.lost(ws, 1000);
  }

  send(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  sendHello() {
    const g = this.game;
    this.send({ t: "hello", name: this.profile.name, colour: this.colour(), boat: g.walker?.active ? "walker" : (g.boat?.kind || "raft"), seed: g.world?.seed, room: this.room });
  }

  ping() { this.send({ t: "time", c: Date.now() }); }

  // ---------------------------------------------------------- messages

  handle(m) {
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;
    switch (m.t) {
      case "welcome":
        if (!Number.isInteger(m.id) || !Number.isFinite(m.now)) return;
        this.online = true; this.id = m.id; this.backoff = 1000;
        this.serverTimeOffset = this.timeSamples.length ? this.serverTimeOffset : m.now - Date.now();
        this.players.clear();
        for (const p of Array.isArray(m.players) ? m.players : []) {
          if (!p || !Number.isInteger(p.id)) continue;
          this.addPlayer(p);
          if (p.state) this.pushSample(p.id, m.now, p.state);
        }
        for (const r of Array.isArray(m.races) ? m.races : []) if (r && okCourse(r.course)) this.races.set(r.course, { phase: "lobby", at: r.at, ready: r.ready, racers: null, results: [] });
        this.emit("online", { id: m.id, name: m.name });
        this.flushGhosts().catch(() => { /* try again next time */ });
        return;
      case "join": {
        if (!Number.isInteger(m.id)) return;
        const had = this.players.has(m.id);
        this.addPlayer(m);
        if (!had) this.emit("join", this.players.get(m.id));
        return;
      }
      case "leave": {
        const p = this.players.get(m.id);
        this.players.delete(m.id);
        if (p) this.emit("leave", p);
        return;
      }
      case "states":
        if (!Array.isArray(m.list) || !Number.isFinite(m.at)) return;
        for (const s of m.list) if (s && s.id !== this.id) this.pushSample(s.id, m.at, s);
        return;
      case "emote":
        if (EMOTES.has(m.kind) && m.id !== this.id) this.emit("emote", { id: m.id, kind: m.kind, player: this.players.get(m.id) });
        return;
      case "time": {
        const now = Date.now(), rtt = now - m.c;
        if (!(rtt >= 0 && rtt < 30_000)) return;
        this.timeSamples.push({ rtt, off: m.s + rtt / 2 - now });
        if (this.timeSamples.length > 8) this.timeSamples.shift();
        const best = this.timeSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.serverTimeOffset = best.off; this.rtt = best.rtt;
        return;
      }
      case "race-lobby":
        if (!okCourse(m.course) || !Number.isFinite(m.at)) return;
        this.races.set(m.course, { phase: "lobby", at: m.at, ready: m.ready, racers: null, results: [] });
        this.emit("race-lobby", { course: m.course, at: m.at, ready: m.ready, startsIn: m.at - this.serverNow });
        return;
      case "race-start": {
        if (!okCourse(m.course) || !Number.isFinite(m.at) || !Array.isArray(m.racers)) return;
        this.races.set(m.course, { phase: "racing", at: m.at, ready: [], racers: m.racers, results: [] });
        this.emit("race-start", { course: m.course, at: m.at, racers: m.racers, mine: (m.racers || []).includes(this.id), elapsed: this.serverNow - m.at });
        return;
      }
      case "race-results": {
        if (!okCourse(m.course) || !Array.isArray(m.results)) return;
        const r = this.races.get(m.course);
        if (r) r.results = m.results;
        if (m.final) this.races.delete(m.course);
        this.emit("race-results", { course: m.course, final: !!m.final, results: m.results });
        return;
      }
      case "race-busy":
        this.emit("race-busy", { course: m.course, at: m.at });
        return;
      case "error":
        this.emit("error", m);
        return;
    }
  }

  addPlayer(p) {
    const old = this.players.get(p.id);
    const entry = old || { id: p.id, samples: [] };
    const okColour = Array.isArray(p.colour) && p.colour.length === 3 && p.colour.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
    entry.name = cleanName(p.name); entry.colour = okColour ? p.colour : [0.85, 0.24, 0.12]; entry.boat = BOAT_KINDS.has(p.boat) ? p.boat : "raft";
    this.players.set(p.id, entry);
    return entry;
  }

  pushSample(id, at, s) {
    const p = this.players.get(id);
    if (!p || !s || ![s.x, s.z, s.y, s.h].every(Number.isFinite)) return;
    if (BOAT_KINDS.has(s.boat) && s.boat !== p.boat) p.boat = s.boat;
    const last = p.samples[p.samples.length - 1];
    if (last && at <= last.at) return;
    p.samples.push({ at, x: s.x, z: s.z, y: s.y, h: s.h, vx: Number.isFinite(s.vx) ? s.vx : 0, vz: Number.isFinite(s.vz) ? s.vz : 0, swim: !!s.swim });
    if (p.samples.length > 30) p.samples.splice(0, p.samples.length - 30);
  }

  // ---------------------------------------------------------- per frame

  tick(dt) {
    if (!this.ws && this.urls && Date.now() >= this.retryAt && this.retryAt !== 0) this.connect();
    if (!this.online) return;
    this.sendAcc += dt;
    if (this.sendAcc >= 0.1) {
      this.sendAcc = Math.min(this.sendAcc - 0.1, 0.1);
      const w = this.game.walker;
      const b = w && w.active ? { x: w.x, z: w.z, y: w.y, heading: w.heading, vx: w.vx, vz: w.vz, kind: "walker", swimming: false } : this.game.boat;
      if (b && [b.x, b.z, b.y, b.heading, b.vx, b.vz].every(Number.isFinite)) {
        const c = (v) => Math.min(3100, Math.max(0, v));
        let vx = b.vx, vz = b.vz;
        const sp = Math.hypot(vx, vz);
        if (sp >= 29) { vx *= 29 / sp; vz *= 29 / sp; }
        this.send({ t: "state", x: c(b.x), z: c(b.z), y: b.y, h: b.heading, vx, vz, boat: b.kind, swim: !!b.swimming });
      }
      if (b && b.kind !== this.lastKind) { if (this.lastKind) this.sendHello(); this.lastKind = b.kind; }
    }
    this.pingAcc += dt;
    if (this.pingAcc >= 5) { this.pingAcc = 0; this.ping(); }
  }

  // ---------------------------------------------------------- actions

  emote(kind) {
    if (!EMOTES.has(kind)) return false;
    return this.send({ t: "emote", kind });
  }

  readyRace(courseId) {
    if (!COURSE_RE.test(courseId)) return false;
    return this.send({ t: "race-ready", course: courseId });
  }

  finishRace(courseId, ms) {
    if (!COURSE_RE.test(courseId) || !Number.isFinite(ms)) return false;
    return this.send({ t: "race-finish", course: courseId, ms: Math.round(ms) });
  }

  // ---------------------------------------------------------- ghosts and boards

  async http(path, init) {
    if (!this.urls) throw new Error("offline");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    try {
      const res = await fetch(`${this.urls.http}${path}`, { ...init, signal: ctl?.signal });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    } finally { if (timer) clearTimeout(timer); }
  }

  // Saves locally always (your own best runs work offline) and posts to the
  // server when there is one. Returns {ok, rank, local, error?}.
  async submitGhost(courseId, { name, ms, ghost }) {
    if (!COURSE_RE.test(courseId) || !Number.isFinite(ms) || typeof ghost !== "string") return { ok: false, error: "bad input" };
    const nm = cleanName(name ?? this.profile.name);
    const local = localSubmit(courseId, { name: nm, ms, ghost });
    if (!this.urls) return local;
    const item = { course: courseId, name: nm, ms: Math.round(ms), ghost, at: Date.now() };
    try {
      const { status, body } = await this.http(`/api/ghosts/${courseId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nm, ms: Math.round(ms), ghost }),
      });
      if (status >= 200 && status < 300) return { ok: true, local: false, rank: body.rank ?? null, localRank: local.rank };
      if (status === 429 || status >= 500) { this.queueGhost(item); return { ...local, queued: true, error: body.error || `HTTP ${status}` }; }
      return { ok: false, local: false, error: body.error || `HTTP ${status}`, localRank: local.rank };
    } catch {
      // Unreachable or timed out (6 s): kept locally, uploaded when the relay is back.
      this.queueGhost(item);
      return { ...local, queued: true };
    }
  }

  queued() {
    const q = readJson(QUEUE_KEY, []);
    const old = Date.now() - QUEUE_DAYS * 86_400_000;
    return Array.isArray(q) ? q.filter((e) => e && okCourse(e.course) && Number.isFinite(e.ms) && typeof e.ghost === "string" && typeof e.name === "string" && e.at > old) : [];
  }

  queueGhost(item) {
    const same = (e) => e.course === item.course && e.name === item.name;
    let q = this.queued();
    if (q.some((e) => same(e) && e.ms <= item.ms)) return false;   // a better run is already waiting
    q = q.filter((e) => !same(e));
    q.push(item);
    return writeJson(QUEUE_KEY, q.slice(-QUEUE_MAX));
  }

  // Posts queued runs, oldest first. A run the board refuses (4xx) is dropped;
  // a busy or unreachable relay leaves the rest for next time.
  async flushGhosts() {
    if (this.flushing || !this.urls) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      for (const e of this.queued()) {
        let status;
        try {
          ({ status } = await this.http(`/api/ghosts/${e.course}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: e.name, ms: e.ms, ghost: e.ghost }),
          }));
        } catch { break; }
        if (status === 429 || status >= 500) break;
        writeJson(QUEUE_KEY, this.queued().filter((x) => !(x.course === e.course && x.name === e.name && x.ms === e.ms)));
        if (status >= 200 && status < 300) sent++;
      }
    } finally { this.flushing = false; }
    if (sent) this.emit("ghosts-sent", { n: sent });
    return sent;
  }

  // Top n ghosts, each {name, ms, ghost, decoded}. Server first, then local.
  async fetchGhosts(courseId, n = 5) {
    if (!COURSE_RE.test(courseId)) return [];
    n = Math.max(1, Math.min(20, n | 0 || 5));
    if (this.urls) {
      try {
        const { status, body } = await this.http(`/api/ghosts/${courseId}?n=${n}`);
        if (status === 200 && Array.isArray(body.ghosts)) return withDecoded(body.ghosts).slice(0, n);
      } catch { /* fall through to local */ }
    }
    return withDecoded(localTop(courseId).slice(0, n));
  }

  // Board rows {rank, name, ms, at}. Server first, then local.
  async board(courseId) {
    if (!COURSE_RE.test(courseId)) return [];
    if (this.urls) {
      try {
        const { status, body } = await this.http(`/api/board/${courseId}`);
        if (status === 200 && Array.isArray(body.board)) return body.board;
      } catch { /* fall through */ }
    }
    return localTop(courseId).map((e, i) => ({ rank: i + 1, name: e.name, ms: e.ms, at: e.at, local: true }));
  }
}

export { checkGhost };

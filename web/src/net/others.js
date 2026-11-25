// Other paddlers and ghosts: pooled boat meshes, name labels and emotes.
//
// Remote boats are drawn about 150 ms behind the server clock, interpolated
// between the 10 Hz states that Net collects. Ghosts are recorded runs drawn
// pale and translucent. Both are BoatRigs at the "lite" level (the hull and
// crew, and the paddles sweeping as a group). At most 16 remote boats and 5
// ghosts have rigs, and the pool never holds more than MAX_SLOTS meshes.
import { BoatRig } from "../render/boats.js";
import { POINT_SOFT } from "../render/bridge.js";
import { sampleAt } from "./ghost.js";
import { waterAt } from "../world/terrain.js";

export const MAX_REMOTE = 16, MAX_GHOSTS = 5, MAX_SLOTS = 48;
const DELAY_MS = 150;
const EXTRAPOLATE_MS = 300;
const EMOTE_S = 3;
const LABEL_RANGE = 260;
const KINDS = new Set(["raft", "kayak", "canoe", "dory", "walker"]);
const TURN = Math.PI * 2;
const wrap = (a) => a - TURN * Math.floor((a + Math.PI) / TURN);

function okColour(c) {
  return Array.isArray(c) && c.length === 3 && c.every((v) => Number.isFinite(v)) ? c : [0.85, 0.24, 0.12];
}
const pale = (c) => [0.55 + c[0] * 0.3, 0.6 + c[1] * 0.3, 0.65 + c[2] * 0.3];
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, "?");

// Interpolated pose from Net samples ({at, x, z, y, h, vx, vz, swim}) at server time t.
export function poseAt(samples, t) {
  const n = samples.length;
  if (!n) return null;
  if (t <= samples[0].at) return samples[0];
  const last = samples[n - 1];
  if (t >= last.at) {
    const dt = Math.min(t - last.at, EXTRAPOLATE_MS) / 1000;
    return { ...last, x: last.x + (last.vx || 0) * dt, z: last.z + (last.vz || 0) * dt };
  }
  let i = n - 1;
  while (i > 0 && samples[i - 1].at > t) i--;
  const a = samples[i - 1], b = samples[i];
  const u = (t - a.at) / Math.max(1, b.at - a.at);
  return {
    at: t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, y: a.y + (b.y - a.y) * u,
    h: wrap(a.h + wrap(b.h - a.h) * u), vx: b.vx, vz: b.vz, swim: u < 0.5 ? a.swim : b.swim,
  };
}

export class Others {
  constructor(game) {
    this.game = game;
    this.entries = [];          // {rig, key, owner|null}
    this.owned = new Map();     // owner -> entry
    this.near = [];             // remote ids that get meshes
    this.pickAcc = 1;
    this.emotes = new Map();    // "self" | id -> {kind, t}
    this.ghosts = [];           // {name, ms, decoded, colour}
    this.ghostStart = 0;
    this.ghostCourse = null;
    this.subscribed = null;
  }

  // ---------------------------------------------------------- mesh pool

  get bridge() { return this.game.bridge; }

  acquire(owner, kind, colour, ghost) {
    const b = this.bridge;
    if (!b) return null;
    const key = `${ghost ? "g" : "p"}:${kind}:${colour.map((v) => v.toFixed(2)).join(",")}`;
    const cur = this.owned.get(owner);
    if (cur && cur.key === key) return cur;
    if (cur) this.release(owner);
    let e = this.entries.find((x) => !x.owner && x.key === key);
    if (!e) {
      // Make room: drop idle rigs until a new one fits the mesh budget.
      const need = kind === "walker" ? 1 : 2;
      let used = this.entries.reduce((n, x) => n + x.rig.count, 0);
      while (used + need > MAX_SLOTS) {
        const i = this.entries.findIndex((x) => !x.owner);
        if (i < 0) return null;
        used -= this.entries[i].rig.count;
        this.entries[i].rig.dispose();
        this.entries.splice(i, 1);
      }
      const rig = new BoatRig(b, kind, ghost ? pale(colour) : colour, { level: "lite", ghost, seed: this.entries.length * 1.7 + colour[0] * 5 });
      if (rig.slots.some((s) => s == null || s < 0)) { rig.dispose(); return null; }
      e = { rig, key, owner: null };
      this.entries.push(e);
    }
    e.owner = owner;
    this.owned.set(owner, e);
    return e;
  }

  release(owner) {
    const e = this.owned.get(owner);
    if (!e) return;
    this.owned.delete(owner);
    e.owner = null;
    e.rig.setVisible(false);
  }

  // ---------------------------------------------------------- per frame

  subscribe() {
    const net = this.game.net;
    if (!net?.on || this.subscribed === net) return;
    this.subscribed = net;
    net.on("emote", ({ id, kind }) => { this.emotes.set(id, { kind, t: this.game.time }); });
    net.on("leave", (p) => { this.emotes.delete(p.id); this.release(`p:${p.id}`); });
    net.on("offline", () => { for (const o of [...this.owned.keys()]) if (o.startsWith("p:")) this.release(o); this.near = []; });
  }

  tick(dt) {
    this.subscribe();
    const now = this.game.time;
    for (const [k, e] of this.emotes) if (now - e.t > EMOTE_S) this.emotes.delete(k);
    this.pickAcc += dt;
    if (this.pickAcc >= 0.5) { this.pickAcc = 0; this.pickNear(); }
  }

  // The nearest MAX_REMOTE players with a known position get meshes.
  pickNear() {
    const net = this.game.net, me = this.game.boat;
    if (!net?.players) { this.near = []; return; }
    const list = [];
    for (const p of net.players.values()) {
      const s = p.samples?.[p.samples.length - 1];
      if (!s) continue;
      const d = me ? Math.hypot(s.x - me.x, s.z - me.z) : 0;
      list.push([d, p.id]);
    }
    list.sort((a, b) => a[0] - b[0]);
    this.near = list.slice(0, MAX_REMOTE).map((x) => x[1]);
    const keep = new Set(this.near.map((id) => `p:${id}`));
    for (const o of [...this.owned.keys()]) if (o.startsWith("p:") && !keep.has(o)) this.release(o);
  }

  selfEmote(kind) {
    if (kind === "wave" || kind === "flare" || kind === "bell") this.emotes.set("self", { kind, t: this.game.time });
  }

  showGhosts(courseId, ghosts, startTime) {
    this.clearGhosts();
    this.ghostCourse = courseId;
    this.ghostStart = startTime;
    this.ghosts = (ghosts || []).filter((g) => g && Array.isArray(g.decoded) && g.decoded.length > 1).slice(0, MAX_GHOSTS)
      .map((g, i) => ({ name: ascii(g.name || "Paddler").slice(0, 16), ms: g.ms, decoded: g.decoded, colour: okColour(g.colour), i }));
  }

  clearGhosts() {
    for (let i = 0; i < MAX_GHOSTS; i++) this.release(`g:${i}`);
    this.ghosts = []; this.ghostCourse = null;
  }

  draw(R, labelText, dt) {
    const g = this.game, b = this.bridge;
    if (!b) return;
    const me = g.boat;
    const net = g.net;
    const near = (x, z) => !me || Math.hypot(x - me.x, z - me.z) < LABEL_RANGE;

    // Remote paddlers.
    if (net?.players) {
      const t = (net.serverNow ?? Date.now() + (net.serverTimeOffset || 0)) - DELAY_MS;
      for (const id of this.near) {
        const p = net.players.get(id);
        if (!p) { this.release(`p:${id}`); continue; }
        const pose = poseAt(p.samples || [], t);
        if (!pose) continue;
        const kind = KINDS.has(p.boat) ? p.boat : "raft", col = okColour(p.colour);
        const e = this.acquire(`p:${id}`, kind, col, false);
        if (!e) continue;
        if (!e.rig.shown) e.rig.setVisible(true);
        e.rig.drive(pose, dt);
        if (near(pose.x, pose.z)) e.rig.fx(R.points, POINT_SOFT);
        if (near(pose.x, pose.z)) {
          R.labels.push(pose.x, pose.y + 2.7, pose.z, 14, 0.55 + col[0] * 0.45, 0.55 + col[1] * 0.45, 0.55 + col[2] * 0.45, 0.95);
          labelText.push(ascii(p.name || "Paddler"));
        }
        const em = this.emotes.get(id);
        if (em) this.drawEmote(R, labelText, em, pose.x, pose.y, pose.z);
      }
    }

    // Ghosts.
    if (this.ghosts.length) {
      const tMs = (g.time - this.ghostStart) * 1000;
      for (const gh of this.ghosts) {
        const owner = `g:${gh.i}`;
        const t0 = gh.decoded[0].t;
        const s = sampleAt(gh.decoded, tMs + t0);
        const end = gh.decoded[gh.decoded.length - 1].t - t0;
        if (!s || tMs < 0 || tMs > end + 3000) { this.release(owner); continue; }
        const e = this.acquire(owner, KINDS.has(me?.kind) && me.kind !== "walker" ? me.kind : "kayak", gh.colour, true);
        if (!e) continue;
        let y = me?.y ?? 0;
        try { if (g.world) y = waterAt(g.world, s.x, s.z); } catch { /* keep fallback */ }
        if (!e.rig.shown) e.rig.setVisible(true);
        e.rig.drive({ x: s.x, y, z: s.z, h: s.h, vx: e.vx, vz: e.vz }, dt);
        if (dt > 0 && e.last && Math.hypot(s.x - e.last.x, s.z - e.last.z) < 3) { e.vx = (s.x - e.last.x) / dt; e.vz = (s.z - e.last.z) / dt; }
        e.last = { x: s.x, z: s.z };
        if (near(s.x, s.z)) {
          R.labels.push(s.x, y + 2.5, s.z, 13, 0.82, 0.86, 0.9, 0.7);
          labelText.push(`ghost: ${gh.name}`);
        }
      }
    }

    // Our own emote.
    const mine = this.emotes.get("self");
    if (mine && me) this.drawEmote(R, labelText, mine, me.x, me.y, me.z);
  }

  drawEmote(R, labelText, em, x, y, z) {
    const age = this.game.time - em.t;
    if (age < 0 || age > EMOTE_S) return;
    const fade = Math.min(1, (EMOTE_S - age) / 0.6);
    if (em.kind === "wave") {
      R.labels.push(x, y + 3.4 + Math.sin(age * 9) * 0.12, z, 18, 1, 0.95, 0.6, fade);
      labelText.push("o/");
    } else if (em.kind === "bell") {
      R.labels.push(x, y + 3.4 + age * 0.3, z, 16, 1, 0.88, 0.35, fade);
      labelText.push("*ding*");
    } else if (em.kind === "flare") {
      const top = 1.2 + Math.min(age * 14, 32);
      const n = 12;
      for (let k = 0; k <= n; k++) {
        const u = k / n, py = y + 1.2 + (top - 1.2) * u;
        const jitter = (Math.random() - 0.5) * 0.25 * (1 - u);
        R.points.push(x + jitter, py, z + jitter, 6 + u * 10, 0.3 + u * 0.5, 1, 0.45 + u * 0.3, 0.2 + u * 0.2, (0.4 + u * 0.6) * fade, POINT_SOFT);
      }
      R.points.push(x, y + top, z, 26, 1.6, 1, 0.8, 0.5, fade, POINT_SOFT);
      R.lights.push(x, y + top, z, 35, 1, 0.5, 0.25, 3 * fade, 2, 0, 0, 0);
    }
  }
}

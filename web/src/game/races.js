// Race courses: buoyed gates down a stretch of river, medal times, your best
// run kept as a ghost, the best ghosts from the server raced alongside, and
// group starts with whoever is at the start buoy.
import { POINT_SOFT, PRIM } from "../render/bridge.js";
import { clamp } from "../world/noise.js";

// river, start fraction, end fraction, gate spacing (m)
export const COURSES = [
  { id: "meadow-sprint", name: "Meadow Sprint", river: "long", f0: 0.345, f1: 0.47, gap: 55, ref: 2.6 },
  { id: "bright-chutes", name: "Brightwater Chutes", river: "bright", f0: 0.12, f1: 0.62, gap: 45, ref: 3.2 },
  { id: "throat-run", name: "Throat Run", river: "long", f0: 0.5, f1: 0.66, gap: 40, ref: 3.9 },
  { id: "coldwater", name: "Coldwater Run", river: "cold", f0: 0.3, f1: 0.75, gap: 60, ref: 3.0 },
  { id: "ferry-dash", name: "Ferry Dash", river: "long", f0: 0.73, f1: 0.86, gap: 50, ref: 3.3 },
  { id: "descent", name: "The Descent", river: "long", f0: 0.012, f1: 0.985, gap: 120, ref: 2.9 },
];

export class Races {
  constructor(game) { this.game = game; this.courses = []; this.best = {}; this.run = null; this.lobby = null; }

  restore(d) { if (d && d.best) this.best = d.best; }
  data() { return { best: this.best }; }

  build() {
    const w = this.game.world;
    for (const def of COURSES) {
      const r = w.rivers.find((x) => x.id === def.river), S = r.samples;
      const i0 = Math.round(def.f0 * (S.length - 1)), i1 = Math.round(def.f1 * (S.length - 1));
      const gates = [];
      let next = S[i0].s;
      for (let i = i0; i <= i1; i++) {
        const p = S[i];
        if (p.s >= next || i === i1) { gates.push({ x: p.x, z: p.z, y: p.level, tx: p.tx, tz: p.tz, half: p.width / 2 + 1, s: p.s }); next = p.s + def.gap; }
      }
      const length = S[i1].s - S[i0].s;
      const gold = length / def.ref, silver = gold * 1.18, bronze = gold * 1.4;
      this.courses.push({ ...def, river: r, gates, length, medals: { gold, silver, bronze } });
    }
  }

  startNear() {
    const b = this.game.boat;
    return this.courses.find((c) => Math.hypot(c.gates[0].x - b.x, c.gates[0].z - b.z) < 35) || null;
  }

  promptHtml() {
    if (this.run) return `<b>${this.run.course.name}</b> · gate ${this.run.next}/${this.run.course.gates.length} · ${(this.game.time - this.run.t0).toFixed(1)} s`;
    if (this.lobby) return `<b>${this.lobby.course.name}</b> · group start in ${Math.max(0, Math.ceil(this.lobby.at - this.game.time))} s`;
    const c = this.startNear();
    if (!c) return this.game.jobs?.hudLine() || null;
    const best = this.best[c.id];
    const t = this.game.input?.touch;
    return `<b>${c.name}</b> start${best ? ` · best ${fmt(best.ms / 1000)}` : ""} · paddle through the gate to race${t ? ` <button class="btn ghost" id="p-group">Group start</button>` : " · <kbd>R</kbd> group start"}`;
  }

  // R at a start buoy: ask the server for a group start (or start a solo countdown offline).
  interact() {
    const c = this.startNear();
    if (!c || this.run) return false;
    const net = this.game.net;
    if (net?.online) { net.readyRace(c.id); this.game.hud.toast("Waiting for others at the start…"); }
    else this.lobby = { course: c, at: this.game.time + 5 };
    return true;
  }

  async begin(c, t0) {
    const g = this.game;
    this.run = { course: c, t0, next: 1, samples: [], lastSample: -1 };
    g.hud.flash(`${c.name}: go!`);
    // Ghosts: yours and the best from the server.
    const ghosts = [];
    const mine = this.best[c.id];
    try {
      const { decode } = await import("../net/ghost.js");
      if (mine && mine.ghost) ghosts.push({ name: "your best", ms: mine.ms, decoded: decode(mine.ghost) });
      const top = (await g.net?.fetchGhosts?.(c.id, 3)) || [];
      for (const t of top) if (t.ghost) ghosts.push({ name: t.name, ms: t.ms, decoded: decode(t.ghost) });
    } catch (_) { /* no ghosts: race alone */ }
    if (this.run && this.run.course === c) g.others?.showGhosts?.(c.id, ghosts, t0);
  }

  tick() {
    const g = this.game, b = g.boat;
    if (this.lobby && g.time >= this.lobby.at) { const c = this.lobby.course; this.lobby = null; this.begin(c, g.time); }
    if (!this.run) {
      // Crossing the first gate starts a solo run.
      for (const c of this.courses) {
        const gt = c.gates[0];
        if (crossed(gt, b, this.prev)) { this.begin(c, g.time); break; }
      }
    } else {
      const r = this.run, gate = r.course.gates[r.next];
      const t = g.time - r.t0;
      if (t * 10 >= r.samples.length) r.samples.push({ t: Math.round(t * 1000), x: b.x, z: b.z, h: b.heading });
      if (crossed(gate, b, this.prev)) {
        r.next++;
        g.audio?.judgment?.("good");
        if (r.next >= r.course.gates.length) this.finish(t);
      } else if (Math.hypot(gate.x - b.x, gate.z - b.z) > 400 || t > r.course.medals.bronze * 4) {
        g.hud.toast(`${r.course.name}: abandoned.`); this.run = null; g.others?.clearGhosts?.();
      }
    }
    this.prev = { x: b.x, z: b.z };
  }

  async finish(t) {
    const g = this.game, r = this.run, c = r.course;
    this.run = null;
    const ms = Math.round(t * 1000);
    const medal = t <= c.medals.gold ? "gold" : t <= c.medals.silver ? "silver" : t <= c.medals.bronze ? "bronze" : null;
    const best = this.best[c.id];
    const pb = !best || ms < best.ms;
    let ghost = null;
    try { const { encode } = await import("../net/ghost.js"); ghost = encode(r.samples); } catch (_) { /* no codec */ }
    if (pb) this.best[c.id] = { ms, ghost, medal };
    g.hud.raceResult(c, t, medal, pb);
    if (medal === "gold") g.journal.feat("gold");
    g.journal.earn(medal === "gold" ? 40 : medal === "silver" ? 25 : medal === "bronze" ? 15 : 5, `${c.name} ${fmt(t)}`);
    g.net?.finishRace?.(c.id, ms);
    if (ghost && pb) g.net?.submitGhost?.(c.id, { name: g.net?.profile?.name || "Paddler", ms, ghost });
    g.others?.clearGhosts?.();
    g.save?.soon();
  }

  draw(R) {
    const g = this.game, b = g.boat, t = g.time;
    for (const c of this.courses) {
      const active = this.run && this.run.course === c;
      const near = Math.hypot(c.gates[0].x - b.x, c.gates[0].z - b.z) < 500;
      if (!active && !near) continue;
      c.gates.forEach((gt, i) => {
        if (!active && i > 0) return;
        if (active && (i < this.run.next - 1 || i > this.run.next + 3)) return;
        const isNext = active && i === this.run.next;
        const col = i === 0 ? [0.3, 1, 0.4] : i === c.gates.length - 1 ? [1, 1, 1] : isNext ? [1, 0.75, 0.15] : [1, 0.4, 0.15];
        for (const s of [-1, 1]) {
          const x = gt.x - gt.tz * gt.half * s, z = gt.z + gt.tx * gt.half * s;
          const bob = Math.sin(t * 2 + i + s) * 0.08;
          R.items.push(PRIM.SPHERE, x, gt.y + 0.3 + bob, z, 0.9, 0.9, 0.9, col[0], col[1], col[2]);
          R.items.push(PRIM.CYLINDER, x, gt.y + 1.4 + bob, z, 0.08, 1.1, 0.08, 0.9, 0.9, 0.9);
          if (isNext || i === 0) R.points.push(x, gt.y + 2.6 + bob, z, 14, 0.7, col[0], col[1], col[2], 0.9, POINT_SOFT);
        }
        if (isNext) R.wide.push(gt.x - gt.tz * gt.half, gt.y + 0.15, gt.z + gt.tx * gt.half, gt.x + gt.tz * gt.half, gt.y + 0.15, gt.z - gt.tx * gt.half, 1, 0.8, 0.2, 0.5, 3, 0.25, 1);
      });
      if (!active && near) { R.labels.push(c.gates[0].x, c.gates[0].y + 4, c.gates[0].z, 15, 0.5, 1, 0.6, 1); g.labelText.push(c.name); }
    }
  }
}

function crossed(gate, b, prev) {
  if (!prev) return false;
  const d0 = (prev.x - gate.x) * gate.tx + (prev.z - gate.z) * gate.tz;
  const d1 = (b.x - gate.x) * gate.tx + (b.z - gate.z) * gate.tz;
  if (!(d0 < 0 && d1 >= 0)) return false;
  const lat = (b.x - gate.x) * -gate.tz + (b.z - gate.z) * gate.tx;
  return Math.abs(lat) <= gate.half + 1.5;
}

export function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)} s`;
}
void clamp;

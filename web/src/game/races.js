// Race courses: buoyed gates down a stretch of river, medal times, your best
// run kept as a ghost, the best ghosts from the server raced alongside, and
// group starts with whoever is at the start buoy.
import { POINT_SOFT, PRIM } from "../render/bridge.js";
import { COURSES, buildCourses, crossed } from "./courses.js";

export { COURSES };
import { clamp } from "../world/noise.js";


export class Races {
  constructor(game) { this.game = game; this.courses = []; this.best = {}; this.run = null; this.lobby = null; }

  restore(d) { if (d && d.best) this.best = d.best; }
  data() { return { best: this.best }; }

  build() {
    const w = this.game.world;
    this.listen();
    this.courses = buildCourses(w.rivers);
  }

  // Group races through the server.
  listen() {
    const g = this.game;
    if (this.listening || !g.net?.on) return;
    this.listening = true;
    const byId = (id) => this.courses.find((c) => c.id === id);
    g.net.on("race-lobby", (m) => { const c = byId(m.course); if (c) g.hud.toast(`${c.name}: ${m.ready} ready · start in ${Math.ceil(m.startsIn ?? 10)} s`); });
    g.net.on("race-start", (m) => {
      const c = byId(m.course); if (!c || !m.mine || this.run) return;
      const b = g.boat, gt = c.gates[0];
      if (Math.hypot(gt.x - b.x, gt.z - b.z) > 60) return;
      this.begin(c, g.time - Math.max(0, m.elapsed || 0));
    });
    g.net.on("race-results", (m) => {
      const c = byId(m.course); if (!c || !m.final) return;
      const top = (m.results || []).slice(0, 3).map((r) => `${r.place}. ${r.name} ${fmt(r.ms / 1000)}`).join("  ");
      if (top) g.hud.toast(`${c.name} results: ${top}`, 6);
    });
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
      for (const t of top) if (t.ghost && !(mine && t.ghost === mine.ghost)) ghosts.push({ name: t.name, ms: t.ms, decoded: decode(t.ghost) });
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

export function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)} s`;
}
void clamp;

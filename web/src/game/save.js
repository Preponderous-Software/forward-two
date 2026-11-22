// Saves to localStorage (one slot). Every access is wrapped: a private
// window or blocked storage just means no save.
const KEY = "f2.save.v1";

export class Save {
  constructor(game) { this.game = game; this.timer = 20; this.pending = false; }

  load() {
    if (this.game.params.get("new") === "1") return null;
    try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (_) { return null; }
  }

  apply(d) {
    const g = this.game;
    if (typeof d.clock === "number") g.clock = d.clock;
    if (d.boatsOwned) g.boatsOwned = new Set(d.boatsOwned);
    if (d.hull != null) g.boat.hull = d.hull;
    if (d.colour) g.colour = d.colour;
    g.jobs?.restore(d.jobs);
    g.races?.restore(d.races);
  }

  data() {
    const g = this.game, b = g.boat;
    return {
      v: 1, seed: g.world.seed, boat: b.kind, pos: { x: b.x, z: b.z, heading: b.heading }, clock: g.clock, hull: b.hull,
      boatsOwned: [...(g.boatsOwned || ["raft"])], colour: g.colour || null,
      journal: g.journal.data(), jobs: g.jobs?.data(), races: g.races?.data(), at: Date.now(),
    };
  }

  write() {
    if (this.game.params.get("nosave") === "1") return;
    try { localStorage.setItem(KEY, JSON.stringify(this.data())); } catch (_) { /* storage blocked */ }
    this.pending = false; this.timer = 20;
  }

  soon() { this.pending = true; this.timer = Math.min(this.timer, 2); }

  wipe() { try { localStorage.removeItem(KEY); } catch (_) { /* nothing */ } }

  tick(dt) {
    this.timer -= dt;
    if (this.timer <= 0) { const b = this.game.boat; if (!b.swimming && !this.game.caller.rapid) this.write(); else this.timer = 3; }
  }
}

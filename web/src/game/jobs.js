// Deliveries: camps post loads to carry to other camps. Upstream and
// overnight runs pay more; fragile loads lose value every time you're hit,
// and a swim costs a fragile load outright.
import { mulberry32 } from "../world/rng.js";
import { POINT_SOFT } from "../render/bridge.js";

const GOODS = [
  { name: "mail sacks", fragile: false }, { name: "fresh bread", fragile: false }, { name: "lantern oil", fragile: true },
  { name: "a crate of eggs", fragile: true }, { name: "seed bags", fragile: false }, { name: "medicine", fragile: true },
  { name: "rope coils", fragile: false }, { name: "smoked fish", fragile: false }, { name: "a fiddle", fragile: true },
];

export class Jobs {
  constructor(game) { this.game = game; this.active = null; this.day = -1; this.boards = new Map(); }

  restore(d) { if (d && d.active) this.active = d.active; }
  data() { return { active: this.active }; }

  // The jobs a camp offers today (stable for the in-game day).
  board(camp) {
    const g = this.game, day = Math.floor(g.dayCount || 0);
    const key = camp.id + ":" + day;
    if (this.boards.has(key)) return this.boards.get(key);
    const camps = g.places.camps;
    const rnd = mulberry32(g.world.seed * 101 + camps.indexOf(camp) * 17 + day * 7919);
    const list = [];
    const others = camps.filter((c) => c !== camp);
    for (let k = 0; k < 3; k++) {
      const to = others[Math.floor(rnd() * others.length)];
      const good = GOODS[Math.floor(rnd() * GOODS.length)];
      const dist = Math.hypot(to.x - camp.x, to.z - camp.z);
      const upstream = to.level > camp.level + 4;
      const pay = Math.round((20 + dist / 30) * (upstream ? 1.8 : 1) * (good.fragile ? 1.4 : 1) / 5) * 5;
      const hours = Math.max(3, Math.round(dist / 260 * (upstream ? 2.2 : 1) + 3));
      list.push({ id: `${key}:${k}`, from: camp.id, to: to.id, toName: to.name, good: good.name, fragile: good.fragile, pay, hours, upstream, dist: Math.round(dist) });
    }
    this.boards.set(key, list);
    return list;
  }

  take(job) {
    const g = this.game;
    const capacity = g.boat.spec.cargo;
    if (capacity < 1) { g.hud.toast("No room aboard."); return false; }
    this.active = { ...job, dueClock: (g.dayCount || 0) + g.clock + job.hours / 24, value: job.pay, startedAt: g.time };
    g.hud.toast(`Carry ${job.good} to ${job.toName}. ${job.hours} hours.`);
    g.save?.soon();
    return true;
  }

  abandon() { if (this.active) { this.game.hud.toast(`You leave the ${this.active.good} on the bank.`); this.active = null; } }

  dest() { return this.active ? this.game.places.camps.find((c) => c.id === this.active.to) : null; }

  onHit(amount) { if (this.active && this.active.fragile) this.active.value = Math.max(0, Math.round(this.active.value - this.active.pay * amount * 0.6)); }
  onFlip() { if (this.active && this.active.fragile) { this.active.value = 0; this.game.hud.toast(`The ${this.active.good} went in the river.`); } }
  onWashAshore() {}

  interact() { return false; }

  tick() {
    const g = this.game, a = this.active;
    if (!a) return;
    const d = this.dest();
    if (d && Math.hypot(d.x - g.boat.x, d.z - g.boat.z) < 30) {
      const now = (g.dayCount || 0) + g.clock, late = now > a.dueClock;
      const pay = Math.round(late ? a.value * 0.5 : a.value);
      g.journal.earn(pay, `${a.good} delivered to ${a.toName}${late ? " (late)" : ""}`);
      g.journal.deliveries++;
      if (g.journal.deliveries >= 5) g.journal.feat("courier");
      this.active = null;
      g.save?.soon();
    }
  }

  draw(R) {
    const d = this.dest();
    if (!d) return;
    const g = this.game, t = g.time;
    for (let k = 0; k < 12; k++) R.points.push(d.x, d.y + 4 + k * 4 + Math.sin(t * 2 + k) * 0.5, d.z, 18 - k, 2.5, 1, 0.82, 0.3, 0.75 - k * 0.05, POINT_SOFT);
  }

  hudLine() {
    const a = this.active; if (!a) return "";
    const g = this.game, d = this.dest();
    const left = (a.dueClock - ((g.dayCount || 0) + g.clock)) * 24;
    const dist = d ? Math.round(Math.hypot(d.x - g.boat.x, d.z - g.boat.z)) : 0;
    return `${a.good} → ${a.toName} · ${dist} m · ${left > 0 ? `${Math.floor(left)}h ${Math.floor((left % 1) * 60)}m` : "late"} · ${a.value} pay`;
  }
}

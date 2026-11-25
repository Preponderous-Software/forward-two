// Jobs: camps post work on their boards. Deliveries carry loads to other
// camps (upstream and fragile loads pay more; fragile loads lose value every
// time you're hit, and a swim costs them outright). As your rank grows the
// boards add rush jobs (short deadlines, big pay), passengers (who enjoy a
// clean line and hate a swim, and may want a landmark rather than a camp) and
// surveys (sketch a landmark and bring it back). A saved job from 0.1.0 has
// no `kind` and is a delivery.
import { mulberry32 } from "../world/rng.js";
import { POINT_SOFT } from "../render/bridge.js";

const GOODS = [
  { name: "mail sacks", fragile: false }, { name: "fresh bread", fragile: false }, { name: "lantern oil", fragile: true },
  { name: "a crate of eggs", fragile: true }, { name: "seed bags", fragile: false }, { name: "medicine", fragile: true },
  { name: "rope coils", fragile: false }, { name: "smoked fish", fragile: false }, { name: "a fiddle", fragile: true },
];

const PASSENGERS = ["a birdwatcher", "the miller's niece", "a travelling fiddler", "a fisherman and his rods", "the schoolteacher", "a painter with an easel", "two hikers"];
// Landmarks a passenger or a surveyor can be sent to (not the Throat or the Falls).
const SIGHTS = ["spring", "arch", "hotspring", "bridge", "isle", "wheel", "rookery", "lighthouse"];
export const JOB_KINDS = { delivery: 0, rush: 1, passenger: 2, survey: 3 };   // kind: rank that opens it

export class Jobs {
  constructor(game) { this.game = game; this.active = null; this.day = -1; this.boards = new Map(); this.taken = new Set(); }

  restore(d) {
    if (d && d.active && typeof d.active === "object" && d.active.to) this.active = { kind: "delivery", ...d.active };
    if (d && Array.isArray(d.taken)) d.taken.forEach((id) => typeof id === "string" && this.taken.add(id));
  }
  // `taken`: today's jobs you've already taken, so a board can't hand out the same load twice.
  data() { return { active: this.active, taken: [...this.taken].slice(-40) }; }

  // The jobs a camp offers today (stable for the in-game day and your rank).
  // At rank 0 the board is exactly 0.1.0's.
  board(camp) {
    const g = this.game, day = Math.floor(g.dayCount || 0), rank = g.progress?.rank?.() ?? 0;
    const errand = g.progress?.errandTarget?.(camp) || null;
    const key = camp.id + ":" + day + ":" + rank + (errand ? ":" + errand.id : "");
    const open = (list) => list.filter((j) => !this.taken.has(j.id));
    if (this.boards.has(key)) return open(this.boards.get(key));
    const camps = g.places.camps;
    const rnd = mulberry32(g.world.seed * 101 + camps.indexOf(camp) * 17 + day * 7919);
    const list = [];
    // Never send anyone upstream to a camp they haven't found: the shuttle only
    // goes where you've been, and nobody paddles up the High Falls.
    const reachable = (p) => g.journal?.has?.(p.id) !== false || p.level <= camp.level + 4;
    let others = camps.filter((c) => c !== camp && reachable(c));
    // At the bottom of the river with nothing found: the nearest camp upstream.
    if (!others.length) others = camps.filter((c) => c !== camp).sort((a, b) => a.level - b.level).slice(0, 1);
    const kinds = Object.keys(JOB_KINDS).filter((k) => JOB_KINDS[k] <= rank);
    const bonus = rank >= 4 ? 1.15 : 1;
    const sights = (g.places.landmarks || []).filter((l) => SIGHTS.includes(l.id) && reachable(l) && (l.id !== "spring" || g.journal?.has?.("tarn")));
    for (let k = 0; k < (rank >= 3 ? 4 : 3); k++) {
      const to = others[Math.floor(rnd() * others.length)];
      const good = GOODS[Math.floor(rnd() * GOODS.length)];
      const kind = k > 0 && kinds.length > 1 ? kinds[Math.floor(rnd() * kinds.length)] : "delivery";
      const id = `${key}:${k}`;
      if ((kind === "passenger" || kind === "survey") && sights.length) {
        const sight = kind === "survey" || rnd() < 0.5 ? sights[Math.floor(rnd() * sights.length)] : null;
        const dest = sight || to;
        const dist = Math.hypot(dest.x - camp.x, dest.z - camp.z) * (kind === "survey" ? 2 : 1);
        const upstream = dest.level > camp.level + 4;
        const pay = Math.round((kind === "survey" ? 35 : 30) + dist / 25) * (upstream ? 1.5 : 1) * bonus / 5;
        const hours = Math.max(4, Math.round(dist / 240 * (upstream ? 2 : 1) + 4));
        if (kind === "passenger") {
          const who = PASSENGERS[Math.floor(rnd() * PASSENGERS.length)];
          list.push({ id, kind, from: camp.id, fromName: camp.name, to: dest.id, toName: dest.name, toKind: sight ? "landmark" : "camp", good: who, fragile: false, pay: Math.round(pay) * 5, hours, upstream, dist: Math.round(dist), label: `Take ${who} to ${dest.name}` });
        } else {
          list.push({ id, kind, from: camp.id, fromName: camp.name, to: dest.id, toName: dest.name, toKind: "landmark", good: `a sketch of ${dest.name}`, fragile: false, pay: Math.round(pay) * 5, hours, upstream, dist: Math.round(dist), label: `Sketch ${dest.name} and bring it back here` });
        }
        continue;
      }
      const dist = Math.hypot(to.x - camp.x, to.z - camp.z);
      const upstream = to.level > camp.level + 4;
      let pay = Math.round((20 + dist / 30) * (upstream ? 1.8 : 1) * (good.fragile ? 1.4 : 1) * bonus / 5) * 5;
      let hours = Math.max(3, Math.round(dist / 260 * (upstream ? 2.2 : 1) + 3));
      if (kind === "rush") { pay = Math.round(pay * 1.5 / 5) * 5; hours = Math.max(2, Math.round(hours * 0.55)); }
      list.push({ id, kind: kind === "rush" ? "rush" : "delivery", from: camp.id, to: to.id, toName: to.name, good: good.name, fragile: good.fragile, pay, hours, upstream, dist: Math.round(dist), ...(kind === "rush" ? { label: `Rush ${good.name} to ${to.name}` } : {}) });
    }
    // Wren's errand: a parcel for her next stop, so working the boards also
    // moves the story on. It pays a little better than a plain delivery.
    if (errand) {
      const dist = Math.hypot(errand.x - camp.x, errand.z - camp.z), upstream = errand.level > camp.level + 4;
      const pay = Math.round((40 + dist / 20) * (upstream ? 1.6 : 1) * 1.3 * bonus / 5) * 5;
      const hours = Math.max(4, Math.round(dist / 240 * (upstream ? 2.2 : 1) + 4));
      list.unshift({ id: `${key}:w`, kind: "delivery", errand: true, from: camp.id, fromName: camp.name, to: errand.id, toName: errand.name, toKind: errand.flag ? "camp" : "landmark", good: "Wren's parcel", fragile: false, pay, hours, upstream, dist: Math.round(dist), label: `Wren's errand: a parcel for ${errand.name}` });
    }
    this.boards.set(key, list);
    return open(list);
  }

  take(job) {
    const g = this.game;
    const capacity = g.boat.spec.cargo;
    if (capacity < 1) { g.hud.toast("No room aboard."); return false; }
    if (job.kind === "passenger" && capacity < 2) { g.hud.toast(`There's no room for ${job.good} in a ${g.boat.spec.name.toLowerCase()}.`); return false; }
    this.taken.add(job.id);
    this.active = { ...job, dueClock: (g.dayCount || 0) + g.clock + job.hours / 24, value: job.pay, startedAt: g.time, ...(job.kind === "passenger" ? { mood: 1 } : {}), ...(job.kind === "survey" ? { stage: "out" } : {}) };
    g.hud.toast(job.kind === "passenger" ? `${cap(job.good)} climbs aboard for ${job.toName}. ${job.hours} hours.` : job.kind === "survey" ? `Sketch ${job.toName} and bring it back. ${job.hours} hours.` : `Carry ${job.good} to ${job.toName}. ${job.hours} hours.`);
    g.save?.soon();
    return true;
  }

  abandon() {
    const a = this.active; if (!a) return;
    this.game.hud.toast(a.kind === "passenger" ? `You set ${a.good} down on the bank.` : a.kind === "survey" ? "You give up on the sketch." : `You leave the ${a.good} on the bank.`);
    this.active = null; this.game.save?.soon();
  }

  // Where the job is headed now: a camp, a landmark, or (a survey's second
  // leg) back to the camp that posted it.
  dest() {
    const a = this.active; if (!a) return null;
    const P = this.game.places;
    if (a.kind === "survey" && a.stage === "back") return P.camps.find((c) => c.id === a.from) || null;
    if (a.toKind === "landmark") return (P.landmarks || []).find((l) => l.id === a.to) || null;
    return P.camps.find((c) => c.id === a.to) || null;
  }

  onHit(amount) {
    const a = this.active; if (!a) return;
    if (a.fragile) a.value = Math.max(0, Math.round(a.value - a.pay * amount * 0.6 * (this.game.progress?.has?.("dry-bags") ? 0.5 : 1)));
    if (a.kind === "passenger") a.mood = Math.max(0, (a.mood ?? 1) - amount);
  }
  onFlip() {
    const a = this.active; if (!a) return;
    if (a.fragile) {
      if (this.game.progress?.has?.("dry-bags")) { a.value = Math.round(a.value * 0.5); this.game.hud.toast(`The dry bags kept the ${a.good} mostly dry.`); }
      else { a.value = 0; this.game.hud.toast(`The ${a.good} went in the river.`); }
    }
    if (a.kind === "passenger") { a.mood = Math.max(0, (a.mood ?? 1) - 0.4); this.game.hud.toast(`${cap(a.good)} is soaked and not amused.`); }
  }
  // The shuttle truck hauls your load too, but the driver takes half the pay,
  // and it no longer counts as paddled upstream.
  onShuttle() {
    const a = this.active; if (!a || a.shuttled) return;
    if (a.errand) { this.game.hud.toast("Wren has paid the driver for her parcel."); return; }
    a.shuttled = true; a.value = Math.round(a.value * 0.5);
    this.game.hud.toast(`The driver takes half the pay for hauling the ${a.kind === "passenger" ? "passenger" : "load"}.`, 4);
  }

  // A clean rapid cheers a passenger up.
  onRapid(rapid, stats) {
    const a = this.active;
    if (a?.kind === "passenger" && stats.miss === 0 && stats.perfect + stats.good >= 3) { a.mood = Math.min(1.25, (a.mood ?? 1) + 0.1); this.game.hud.toast(`${cap(a.good)} whoops. That was a good line.`); }
  }
  onWashAshore() {}

  interact() { return false; }

  tick() {
    const g = this.game, a = this.active;
    if (!a) return;
    const d = this.dest(), b = g.pos();
    const reach = a.toKind === "landmark" && !(a.kind === "survey" && a.stage === "back") ? 45 : 30;
    if (!d || Math.hypot(d.x - b.x, d.z - b.z) >= reach) return;
    if (a.kind === "survey" && a.stage === "out") {
      a.stage = "back";
      g.hud.toast(`You sketch ${a.toName}. Take it back to ${a.fromName}.`, 4);
      g.save?.soon();
      return;
    }
    const now = (g.dayCount || 0) + g.clock, late = now > a.dueClock;
    let pay = late ? a.value * (a.kind === "rush" ? 0.25 : 0.5) : a.value;
    if (a.kind === "passenger") pay *= Math.max(0.3, Math.min(1.25, a.mood ?? 1));
    pay = Math.round(pay);
    const what = a.kind === "passenger" ? `${a.good} dropped at ${a.toName}` : a.kind === "survey" ? `sketch of ${a.toName} delivered` : `${a.good} delivered to ${a.toName}`;
    g.journal.earn(pay, `${what}${late ? " (late)" : ""}`);
    g.journal.deliveries++;
    if (g.journal.deliveries >= 5) g.journal.feat("courier");
    if (!late) {
      if (a.fragile && a.value >= a.pay && !a.shuttled) g.journal.feat("gentle");
      if (a.upstream && a.kind !== "survey" && !a.shuttled) g.journal.feat("uphill");
      if (a.kind === "rush") g.journal.feat("rush");
      if (a.kind === "passenger" && (a.mood ?? 1) >= 0.8) g.journal.feat("passenger");
      if (a.kind === "survey") g.journal.feat("survey");
      if (g.night > 0.6) g.journal.feat("night-run");
    }
    this.active = null;
    g.save?.soon();
  }

  draw(R) {
    const d = this.dest();
    if (!d) return;
    const g = this.game, t = g.time;
    for (let k = 0; k < 12; k++) R.points.push(d.x, d.y + 4 + k * 4 + Math.sin(t * 2 + k) * 0.5, d.z, 18 - k, 2.5, 1, 0.82, 0.3, 0.75 - k * 0.05, POINT_SOFT);
  }

  hudLine() {
    const a = this.active; if (!a) return "";
    const g = this.game, d = this.dest(), b = g.pos();
    const left = (a.dueClock - ((g.dayCount || 0) + g.clock)) * 24;
    const dist = d ? Math.round(Math.hypot(d.x - b.x, d.z - b.z)) : 0;
    const what = a.kind === "survey" ? (a.stage === "back" ? `sketch → ${a.fromName}` : `sketch ${a.toName}`) : `${a.good} → ${a.toName}`;
    const mood = a.kind === "passenger" ? ` · ${(a.mood ?? 1) >= 1 ? "happy" : (a.mood ?? 1) >= 0.6 ? "uneasy" : "miserable"}` : "";
    return `${what}${mood} · ${dist} m · ${left > 0 ? `${Math.floor(left)}h ${Math.floor((left % 1) * 60)}m` : "late"} · ${a.value} pay`;
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

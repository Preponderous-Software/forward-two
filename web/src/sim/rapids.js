// Rapids: the rocks, holes and pour-overs in whitewater, the named rapids
// they make up, and the guide who calls them on the beat.
import { mulberry32 } from "../world/rng.js";

export const SPACING = [0, 0, 30, 22, 17, 13];     // metres between features, by class
export const BPM = [0, 0, 66, 78, 92, 108];
export const WINDOW = { perfect: 0.1, good: 0.2, late: 0.3 };
export const LEAD = 1.6;                              // seconds a call is shown before its beat

const CALL_FOR = { hole: "forward", wave: "forward", pour: "back" };

export const RAPID_NAMES = {
  long: ["Tarn Steps", "Shelf Run", "Ledge Drop", "Meander Riffle", "Gorge Gate", "Lantern Chute", "Ferry Rapids", "Last Riffle", "Saltmouth Bar"],
  bright: ["Glint Chutes", "Bright Stair", "Fork Riffle"],
  cold: ["Frost Riffle", "Coldwater Steps", "Millrace", "Reed Riffle"],
};

// Features along every river: [{kind, call, x, z, y, s, river, lateral, r}]
export function buildFeatures(world) {
  const out = [];
  world.rivers.forEach((river, ri) => {
    const rnd = mulberry32(world.seed * 7 + ri * 101 + 3);
    const S = river.samples;
    let next = 0;
    for (const p of S) {
      if (p.cls < 2) { next = p.s + 8; continue; }
      if (p.s < next) continue;
      next = p.s + SPACING[p.cls] * (0.8 + rnd() * 0.5);
      const roll = rnd();
      const kind = roll < 0.5 ? "rock" : roll < (p.cls <= 2 ? 0.92 : 0.78) ? (p.cls <= 2 ? "wave" : "hole") : (p.cls >= 4 ? "pour" : "wave");
      const half = p.width / 2;
      let lateral = 0, call = CALL_FOR[kind], r = 0;
      if (kind === "rock") {
        const side = rnd() < 0.5 ? -1 : 1;
        lateral = side * half * (0.12 + rnd() * 0.3);
        call = side > 0 ? "left" : "right";   // rock on river-right: steer left
        r = 0.7 + rnd() * 0.7 + p.cls * 0.08;
      } else lateral = (rnd() - 0.5) * half * 0.3;
      out.push({
        kind, call, river: ri, s: p.s, lateral, r, cls: p.cls,
        x: p.x - p.tz * lateral, z: p.z + p.tx * lateral, y: p.level, called: false, cleared: false, id: out.length,
      });
    }
  });
  return out;
}

// Contiguous whitewater stretches, named.
export function buildRapids(world) {
  const out = [];
  world.rivers.forEach((river, ri) => {
    const S = river.samples, mine = [];
    let cur = null;
    const close = () => { if (cur && cur.s1 - cur.s0 > 20) mine.push(cur); cur = null; };
    for (let i = 0; i < S.length; i++) {
      const p = S[i];
      const drop = i > 0 ? S[i - 1].level - p.level : 0;
      if (p.cls >= 2) {
        // A rapid ends at a big drop (the falls get their own) or after 320 m.
        if (cur && (cur.s1 - cur.s0 > 320 || drop > 0.45 !== cur.falls)) close();
        if (!cur) cur = { river: ri, riverId: river.id, s0: p.s, s1: p.s, cls: p.cls, x: p.x, z: p.z, falls: drop > 0.45 };
        cur.s1 = p.s; cur.cls = Math.max(cur.cls, p.cls);
      } else if (cur && p.s - cur.s1 > 25) close();
    }
    close();
    const names = RAPID_NAMES[river.id] || [];
    let n = 0;
    for (const r of mine) {
      if (r.falls) r.name = "The High Falls";
      else if (river.id === "long" && r.cls === 5 && r.s0 / river.length > 0.45 && !out.some((o) => o.name === "The Throat")) r.name = "The Throat";
      else { while (names[n] && (names[n] === "The High Falls" || names[n] === "The Throat")) n++; r.name = names[n++] || `${river.name} Rapid ${n}`; }
      out.push(r);
    }
  });
  return out;
}

export function rapidAt(rapids, river, s) {
  for (const r of rapids) if (r.river === river && s >= r.s0 - 6 && s <= r.s1 + 6) return r;
  return null;
}

// The guide: schedules calls for features the boat is about to reach, on
// the beat, and judges strokes against them.
export class Caller {
  constructor(features, rapids) {
    this.byRiver = new Map();
    for (const f of features) {
      if (!this.byRiver.has(f.river)) this.byRiver.set(f.river, []);
      this.byRiver.get(f.river).push(f);
    }
    this.rapids = rapids;
    this.calls = [];          // pending: {feature, call, time, state}
    this.recent = [];         // resolved, for the HUD: {call, judgment, time}
    this.rapid = null;
    this.beat = 0;            // time of the last beat
    this.interval = 1;
    this.flow = 0;
    this.streak = 0;
    this.stats = { perfect: 0, good: 0, miss: 0 };
    this.swim = null;         // {needed, misses, next}
  }

  // Called each frame. Returns events: {type: "enter"|"leave"|"miss"|"call", ...}
  update(now, boat) {
    const ev = [];
    const hit = boat.current && boat.current.hit;
    const s = hit ? hit.sample.s : null, ri = hit ? hit.sample.river : -1;
    const rapid = hit && hit.dist < hit.sample.width / 2 + 6 ? rapidAt(this.rapids, ri, s) : null;
    if (rapid !== this.rapid) {
      if (this.rapid) ev.push({ type: "leave", rapid: this.rapid, stats: { ...this.stats } });
      if (rapid) {
        ev.push({ type: "enter", rapid });
        this.stats = { perfect: 0, good: 0, miss: 0 };
        this.beat = now;
      }
      this.rapid = rapid;
    }
    const cls = rapid ? rapid.cls : 0;
    this.interval = cls ? 60 / BPM[cls] : 1;
    // Schedule calls for features ahead, at the next free beat.
    if (rapid && !boat.swimming && hit) {
      const down = (boat.vx * hit.sample.tx + boat.vz * hit.sample.tz);
      const list = this.byRiver.get(ri) || [];
      const lastTime = this.calls.length ? this.calls[this.calls.length - 1].time : now;
      let slot = Math.max(now + LEAD, lastTime + this.interval);
      slot = this.beat + Math.ceil((slot - this.beat) / this.interval) * this.interval;
      for (const f of list) {
        if (f.called || f.s < s - 2) continue;
        const ahead = f.s - s;
        if (ahead > Math.max(10, down * (LEAD + 1.2))) break;
        f.called = true;
        this.calls.push({ feature: f, call: f.call, time: slot, state: "pending" });
        ev.push({ type: "call", call: f.call, time: slot, feature: f });
        slot += this.interval;
      }
    }
    // Swim recovery calls: "forward" on the beat until two land or two miss.
    if (boat.swimming && this.swim && now >= this.swim.next) {
      this.calls.push({ feature: null, call: "forward", time: now + LEAD, state: "pending", swim: true });
      ev.push({ type: "call", call: "forward", time: now + LEAD, feature: null });
      this.swim.next = now + LEAD + 1.1;
    }
    // Misses: calls whose window has passed.
    while (this.calls.length && this.calls[0].time + WINDOW.late < now) {
      const c = this.calls.shift();
      this.resolve(c, "miss", now);
      ev.push({ type: "miss", call: c });
    }
    return ev;
  }

  // A stroke the player made. Returns {judgment, call} or null if no call was near.
  judge(kind, now) {
    if (!this.calls.length) return null;
    // The earliest pending call whose window is open.
    for (let i = 0; i < this.calls.length; i++) {
      const c = this.calls[i], dt = now - c.time;
      if (dt < -WINDOW.late) break;
      if (Math.abs(dt) <= WINDOW.late) {
        if (c.call !== kind) { this.calls.splice(i, 1); this.resolve(c, "wrong", now); return { judgment: "wrong", call: c, dt }; }
        const j = Math.abs(dt) <= WINDOW.perfect ? "perfect" : Math.abs(dt) <= WINDOW.good ? "good" : "late";
        this.calls.splice(i, 1);
        this.resolve(c, j, now);
        return { judgment: j, call: c, dt };
      }
    }
    return null;
  }

  resolve(c, judgment, now) {
    c.state = judgment;
    const ok = judgment === "perfect" || judgment === "good" || judgment === "late";
    if (c.feature) c.feature.cleared = ok;
    if (c.swim && this.swim) {
      if (ok) { this.swim.landed++; this.swim.misses = 0; } else this.swim.misses++;
    }
    if (judgment === "perfect") { this.flow = Math.min(1, this.flow + 0.14); this.streak++; this.stats.perfect++; }
    else if (judgment === "good" || judgment === "late") { this.flow = Math.min(1, this.flow + 0.07); this.streak++; this.stats.good++; }
    else { this.flow = Math.max(0, this.flow - 0.5); this.streak = 0; this.stats.miss++; }
    this.recent.push({ call: c.call, judgment, time: now });
    if (this.recent.length > 8) this.recent.shift();
  }

  startSwim(now) { this.calls = []; this.swim = { landed: 0, misses: 0, next: now + 0.6 }; }
  endSwim() { this.swim = null; this.calls = this.calls.filter((c) => !c.swim); }

  // Clear pending calls (e.g. after a shuttle or a reset).
  reset() { this.calls = []; this.rapid = null; this.flow = 0; this.streak = 0; this.swim = null; }
}

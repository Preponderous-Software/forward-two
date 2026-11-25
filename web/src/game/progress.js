// Progress: what pulls you down the river. Standing and ranks (earned from
// the journal, never saved, so every old save gets the rank it deserves),
// gear bought with pay, the Keeper's letters (a light story of regional
// goals), river finds along the banks, and "what next".
//
// The pure parts (tables, standing, rankFor, gearedSpec, placeFinds,
// chapterDone, nextGoals, normalize) take plain data, so the tests run them in
// node. The Progress class wires them to the game.
import { POINT_SOFT, PRIM } from "../render/bridge.js";
import { BOATS } from "../sim/boat.js";
import { waterAt, heightAt } from "../world/terrain.js";

// Standing needed for each rank, and what the rank opens.
export const RANKS = [
  { name: "Greenhorn", at: 0, opens: "Deliveries on every job board." },
  { name: "Deckhand", at: 20, opens: "Rush jobs. The Patch Kit and Dry Bags." },
  { name: "Paddler", at: 45, opens: "Passengers. The Long Paddle and the Chart Case." },
  { name: "River Hand", at: 80, opens: "Survey jobs, a fourth job on every board, and the Spray Deck." },
  { name: "Guide", at: 130, opens: "Jobs pay 15% more. The Keeper's last letter." },
  { name: "River Master", at: 190, opens: "Your name on the river." },
];

// Gear: bought with pay at any camp's boat rack. Fits every boat you own.
export const GEAR = [
  { id: "patch-kit", name: "Patch Kit", price: 40, rank: 1, icon: "patch", text: "Your hull takes 30% less damage." },
  { id: "dry-bags", name: "Dry Bags", price: 60, rank: 1, icon: "bag", text: "Fragile loads lose half as much in a hit, and a swim no longer sinks them." },
  { id: "long-paddle", name: "Long Paddle", price: 90, rank: 2, icon: "blade", text: "Every stroke pulls 8% harder." },
  { id: "chart-case", name: "Chart Case", price: 70, rank: 2, icon: "map", text: "Marks places you haven't found yet on the map, and the finds you've missed." },
  { id: "spray-deck", name: "Spray Deck", price: 120, rank: 3, icon: "deck", text: "15% steadier in rough water." },
];

// The Keeper's letters. Wren keeps Saltmouth Light; she writes to whoever has
// the raft at Meadow Fork. Each letter is a goal; `targets` are place ids the
// map marks.
export const CHAPTERS = [
  { id: "first-water", title: "The Fork", reward: 15, targets: [], goal: "Run any rapid.",
    letter: "To whoever has the raft at Meadow Fork: I keep the light at Saltmouth, at the bottom of this river. I'm too old to paddle it now, so learn it for me. Start small: run a rapid. — Wren",
    done: (s) => s.feats.has("first-rapid") },
  { id: "honest-work", title: "Honest Work", reward: 20, targets: [], goal: "Deliver a load from any camp's job board.",
    letter: "The camps pay for carrying. Take a load off a job board and see it through. You'll meet everyone that way. — W.",
    done: (s) => s.deliveries >= 1 },
  { id: "brightwater", title: "Up the Brightwater", reward: 25, targets: ["lodge"], goal: "Find Brightwater Lodge, up the Brightwater from Meadow Fork.",
    letter: "Paddle up the Brightwater to the Lodge. The stove's always on, and the creek is the clearest water you'll ever see. — W.",
    done: (s) => s.found.has("lodge") },
  { id: "gorge", title: "Scout the Gorge", reward: 25, targets: ["lookout"], goal: "Find Gorge Lookout, below the Meadows.",
    letter: "Below the Meadows the valley closes in. Stop at Gorge Lookout and look before you leap. — W.",
    done: (s) => s.found.has("lookout") },
  { id: "mirror", title: "Across the Mirror", reward: 30, targets: ["dock", "isle"], goal: "Find Mirror Dock and Lone Pine Isle.",
    letter: "Past the Gorge the river rests in Mirror Lake. There's one pine on one rock out there. I planted it, a long time ago. — W.",
    done: (s) => s.found.has("dock") && s.found.has("isle") },
  { id: "coldwater", title: "The Cold Valley", reward: 30, targets: ["mill", "hotspring"], goal: "Find Coldwater Mill and the Hot Spring, up the Coldwater from the lake.",
    letter: "Abel keeps the mill on the Coldwater. Tell him the light still turns. Soak in the hot spring on the way; you'll have earned it. — W.",
    done: (s) => s.found.has("mill") && s.found.has("hotspring") },
  { id: "saltmouth", title: "The Keeper's Light", reward: 40, targets: ["lighthouse"], goal: "Reach Saltmouth Light, where the river meets the sea.",
    letter: "Come down to the sea. I'll leave the door open and the kettle on. — W.",
    done: (s) => s.found.has("lighthouse") },
  { id: "tarn", title: "The Top of the World", reward: 30, targets: ["tarn", "spring"], goal: "Find Tarn Spring, where the Long Water begins.",
    letter: "Now go to the beginning. Tarn Spring, under the stone. Everyone should see where their river starts. Nobody paddles up the High Falls: ask the shuttle driver for Tarn Hut. I've told him to expect you. — W.",
    done: (s) => s.found.has("spring") },
  { id: "throat", title: "Through the Throat", reward: 50, targets: ["throat"], goal: "Run the Throat without swimming.",
    letter: "The Throat is the river at its worst and its best. Run it on the guide's calls, and stay in the boat. — W.",
    done: (s) => s.feats.has("throat") },
  { id: "sea", title: "Source to Sea", reward: 60, targets: ["spring", "lighthouse"], goal: "Start at Tarn Spring and paddle all the way to the sea.",
    letter: "One last run before the last letter. Start at the spring and don't stop until you taste salt. — W.",
    done: (s) => s.feats.has("sea") },
  { id: "keeper", title: "Keeper of the Long Water", reward: 100, targets: [], goal: "Earn the rank of Guide.",
    letter: "You know this river better than I do now. Earn the guides' trust, and the light is yours to keep. — W.",
    done: (s) => rankFor(standing(s)) >= 4 },
];

// River finds: things the river carries, waiting in calm water near the bank.
// Abel's bottles drift down the Coldwater, through the lake and out to sea.
export const FINDS = [
  { id: "cup", name: "A Tin Cup", river: "long", f: 0.06, side: 1, icon: "cup", text: "Dented, with W. scratched on the bottom. Someone camped at the spring, once." },
  { id: "blade", name: "A Carved Paddle Blade", river: "long", f: 0.395, side: -1, icon: "blade", text: "Herons carved down the shaft. Snapped clean at the throat." },
  { id: "toy", name: "A Wooden Boat", river: "long", f: 0.44, side: 1, icon: "toy", text: "A child's toy, still afloat. It has a paper sail." },
  { id: "compass", name: "A Brass Compass", river: "bright", f: 0.2, side: 1, icon: "compass", text: "The needle sticks a little, but it still finds north." },
  { id: "feather", name: "A Heron Feather", river: "bright", f: 0.92, side: -1, icon: "feather", text: "Long and grey. The herons nest down at the delta." },
  { id: "bottle-1", name: "Abel's Bottle (I)", river: "cold", f: 0.5, side: 1, icon: "bottle", text: "\"Wren — the wheel froze this winter, then turned again in March. So did I. — Abel\"" },
  { id: "bottle-2", name: "Abel's Bottle (II)", river: "cold", f: 0.9, side: -1, icon: "bottle", text: "\"Wren — I saw your light from the ridge last night. Twenty miles, and it still finds me. — A.\"" },
  { id: "bottle-3", name: "Abel's Bottle (III)", river: "lake", f: 0, side: 0, icon: "bottle", text: "\"Wren — the pine on the island is taller than both of us now. — A.\"" },
  { id: "float", name: "A Fishing Float", river: "long", f: 0.76, side: 1, icon: "float", text: "Red and white cork. The line's long gone." },
  { id: "bottle-4", name: "Abel's Bottle (IV)", river: "long", f: 0.88, side: -1, icon: "bottle", text: "\"Wren — when the miller's lad is grown I'll come down the river for good. Keep the kettle on. — A.\"" },
  { id: "token", name: "A Ferry Token", river: "long", f: 0.82, side: 1, icon: "token", text: "Good for one crossing. The ferry hasn't run in years." },
  { id: "bottle-5", name: "Abel's Last Bottle", river: "long", f: 0.95, side: 1, icon: "bottle", text: "\"Wren — I'm coming down. Leave the door open. — A.\"" },
];

// Saltmouth Light, restored in stages with your pay. Each stage is something you can see at the light.
export const LIGHT = [
  { id: "dock", name: "The Keeper's Dock", price: 100, text: "A plank dock below the light, with a lantern at the end." },
  { id: "flags", name: "Signal Flags", price: 120, text: "A line of bright pennants from the lamp down to the shore." },
  { id: "cottage", name: "The Keeper's Cottage", price: 200, text: "Wren's cottage rebuilt by the tower, its window lit at night." },
  { id: "lens", name: "A New Lens", price: 250, text: "A gold beam twice as long; you'll see it from the lake." },
];
// Open once Wren has written twice (or you've been to the light): a long
// sink for pay, and a reason to go and see it.
export const lightOpen = (claimed, found) => claimed.has("honest-work") || !!found?.has?.("lighthouse");

// Standing: what the journal adds up to. `s` is a snapshot (see Progress.snap).
export function standing(s) {
  const medal = { gold: 6, silver: 4, bronze: 2 };
  let m = 0;
  for (const b of Object.values(s.best || {})) m += medal[b && b.medal] || 0;
  return s.found.size * 2 + s.feats.size * 4 + Math.min(s.deliveries || 0, 40) * 3 + m + (s.finds?.size || 0) * 3;
}

export function rankFor(points) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i].at) r = i;
  return r;
}

// A boat's spec with your gear fitted.
// Gear never lifts a stat past these (the kayak's stroke with the Long Paddle
// is 1.67; the dory's steadiness with the Spray Deck would be 1.44). Top speed
// is never touched, so a stronger stroke gets you up to speed sooner, not faster.
export const GEAR_CAPS = { stroke: 1.7, stability: 1.4 };
export function gearedSpec(base, gear) {
  const has = (id) => gear.has(id);
  return {
    ...base,
    stroke: Math.min(GEAR_CAPS.stroke, base.stroke * (has("long-paddle") ? 1.08 : 1)),
    stability: Math.max(base.stability, Math.min(GEAR_CAPS.stability, base.stability * (has("spray-deck") ? 1.15 : 1))),
    hullWear: has("patch-kit") ? 0.7 : 1,
  };
}

// Where each find rests: the calmest water near its spot on its river.
export function placeFinds(world) {
  const out = [];
  for (const def of FINDS) {
    if (def.river === "lake") {
      const L = world.lake, a = 2.3, r = L.R * 0.55;
      out.push({ ...def, x: L.cx + Math.cos(a) * r, z: L.cz + Math.sin(a) * r, y: L.level });
      continue;
    }
    const river = world.rivers.find((r) => r.id === def.river);
    if (!river) continue;
    const S = river.samples, i0 = Math.round(def.f * (S.length - 1)), span = Math.round(S.length * 0.15);
    let p = null;
    for (const maxCls of [1, 2]) {
      for (let d = 0; d <= span && !p; d++) for (const i of [i0 + d, i0 - d]) if (!p && S[i] && S[i].cls <= maxCls && S[i].width >= 5) p = S[i];
      if (p) break;
    }
    p = p || S[Math.max(0, Math.min(S.length - 1, i0))];
    // Toward its bank, but never off the water's grid (narrow rivers on the small worlds).
    let x = p.x, z = p.z;
    for (const k of [0.3, 0.18, 0.08]) {
      const off = p.width * k * (def.side || 0), qx = p.x - p.tz * off, qz = p.z + p.tx * off;
      if (!world.water || !Number.isNaN(waterAt(world, qx, qz))) { x = qx; z = qz; break; }
    }
    out.push({ ...def, x, z, y: p.level, s: p.s });
  }
  return out;
}

export const chapterDone = (ch, s) => !!ch.done(s);

// The first chapter not yet claimed, or null when the story is over.
export function currentChapter(claimed) { return CHAPTERS.find((c) => !claimed.has(c.id)) || null; }

// "What next": up to three suggestions, most useful first. `s` is a snapshot
// with pay, rank, owned boats, gear, the active job and the claimed chapters.
export function nextGoals(s) {
  const out = [];
  if (s.job) out.push({ kind: "job", text: s.job });
  const ch = currentChapter(s.claimed);
  if (ch) out.push({ kind: "story", text: `Wren's letter: ${ch.goal}${s.storyHint ? ` ${s.storyHint}` : ""}`, targets: ch.targets });
  // Something to buy, or to save up for.
  const prices = { kayak: 60, canoe: 90, dory: 180 };
  const wants = [
    ...GEAR.filter((x) => !s.gear.has(x.id) && x.rank <= s.rank).map((x) => ({ name: x.name, price: x.price })),
    ...Object.entries(prices).filter(([k]) => !s.owned.has(k)).map(([k, p]) => ({ name: `the ${BOATS[k].name.toLowerCase()}`, price: p })),
  ].sort((a, b) => a.price - b.price);
  // Saltmouth Light comes after your own kit.
  if (!wants.length && lightOpen(s.claimed, s.found) && (s.light || 0) < LIGHT.length) { const L = LIGHT[s.light || 0]; wants.push({ name: `${L.name} for Saltmouth Light`, price: L.price }); }
  const buy = wants.find((w) => w.price <= s.pay);
  if (buy) out.push({ kind: "buy", text: `You can afford ${buy.name} (${buy.price} pay) at any camp.` });
  else if (wants[0]) out.push({ kind: "save", text: `${wants[0].price - s.pay} more pay for ${wants[0].name}.` });
  const r = s.rank;
  if (r < RANKS.length - 1) out.push({ kind: "rank", text: `${RANKS[r + 1].at - s.points} standing to ${RANKS[r + 1].name}: ${RANKS[r + 1].opens}` });
  if (!s.job && out.length < 3) out.push({ kind: "tip", text: "Every camp's job board has work. Rest by the fire to see tomorrow's." });
  return out.slice(0, 3);
}

// A saved `progress` block (or nothing, from a 0.1.0 save) made safe to use.
export function normalize(d) {
  const ids = (a, ok) => new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && ok(x)));
  const gearIds = new Set(GEAR.map((x) => x.id)), chIds = new Set(CHAPTERS.map((c) => c.id)), findIds = new Set(FINDS.map((f) => f.id));
  if (!d || typeof d !== "object") return { fresh: true, gear: new Set(), claimed: new Set(), finds: new Set(), rivers: new Set(), seenRank: null, light: 0 };
  return {
    fresh: false,
    gear: ids(d.gear, (x) => gearIds.has(x)),
    claimed: ids(d.chapters, (x) => chIds.has(x)),
    finds: ids(d.finds, (x) => findIds.has(x)),
    rivers: ids(d.rivers, () => true),
    seenRank: Number.isInteger(d.rank) ? d.rank : null,
    light: Number.isInteger(d.light) ? Math.max(0, Math.min(LIGHT.length, d.light)) : 0,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export class Progress {
  constructor(game) {
    this.game = game;
    Object.assign(this, normalize(undefined));
    this.finds = new Set();
    this.placed = null;
    this.acc = 0;
  }

  restore(d) {
    const n = normalize(d);
    this.fresh = n.fresh; this.gear = n.gear; this.claimed = n.claimed; this.finds = n.finds; this.rivers = n.rivers; this.seenRank = n.seenRank; this.light = n.light;
    this.loaded = true;
  }

  data() { return { gear: [...this.gear], chapters: [...this.claimed], finds: [...this.finds], rivers: [...this.rivers], rank: this.rank(), light: this.light }; }

  has(id) { return this.gear.has(id); }

  // Where Wren's errand from this camp goes: her next letter's first unfound
  // stop, if a paddler can get there from here (nothing above the High Falls,
  // and never the Throat itself).
  errandTarget(camp) {
    const g = this.game, ch = currentChapter(this.claimed);
    if (!ch || !g.places) return null;
    const all = [...g.places.camps, ...(g.places.landmarks || [])];
    const options = ch.targets.filter((id) => !["tarn", "spring", "throat", "falls"].includes(id) && !g.journal?.has?.(id))
      .map((id) => all.find((q) => q.id === id)).filter((p) => p && p !== camp)
      .map((p) => ({ p, d: Math.hypot(p.x - camp.x, p.z - camp.z) }))
      // Not a long paddle upstream to a landmark. A camp on the letter is fine
      // however far: the shuttle goes there, and Wren pays the driver.
      .filter((o) => o.d > 150 && !(o.p.level > camp.level + 4 && o.d > 800 && !o.p.flag))
      .sort((a, b) => (b.p.flag ? 1 : 0) - (a.p.flag ? 1 : 0) || a.d - b.d);   // a camp first: its board sends you on
    return options[0]?.p || null;
  }

  // The shuttle goes to camps you've found, and to any camp Wren's current
  // letter sends you to (the driver has been told to expect you).
  shuttleOK(campId) { return !!currentChapter(this.claimed)?.targets.includes(campId); }

  snap() {
    const g = this.game, j = g.journal;
    return { found: j.found, feats: j.feats, deliveries: j.deliveries, pay: j.pay, best: g.races?.best || {}, finds: this.finds };
  }

  points() { return standing(this.snap()); }
  rank() { return this.game.journal ? rankFor(this.points()) : 0; }

  // Fit your gear to a boat (after loading, buying, or changing boats).
  fit(boat) { if (boat) boat.spec = gearedSpec(BOATS[boat.kind] || BOATS.raft, this.gear); }

  buy(id) {
    const g = this.game, item = GEAR.find((x) => x.id === id);
    if (!item || this.gear.has(id)) return false;
    if (this.rank() < item.rank) { g.hud.toast(`The ${item.name} is for a ${RANKS[item.rank].name} or better.`); return false; }
    if (g.journal.pay < item.price) { g.hud.toast(`You need ${item.price} pay.`); return false; }
    g.journal.pay -= item.price;
    this.gear.add(id);
    this.fit(g.boat);
    g.hud.toast(`You fit the ${item.name}.`);
    if (GEAR.every((x) => this.gear.has(x.id))) g.journal.feat("kitted");
    g.save?.soon();
    return true;
  }

  // Put pay toward the next stage of Saltmouth Light.
  fund() {
    const g = this.game, L = LIGHT[this.light];
    if (!L || !lightOpen(this.claimed, g.journal.found)) return false;
    if (g.journal.pay < L.price) { g.hud.toast(`You need ${L.price} pay.`); return false; }
    g.journal.pay -= L.price;
    this.light++;
    g.hud.card(`<div class="kicker">Saltmouth Light</div><b>${esc(L.name)}</b><span>${esc(L.text)} Wren says thank you.</span>`);
    if (this.light >= LIGHT.length) g.journal.feat("lightkeeper");
    g.save?.soon();
    return true;
  }

  goals() {
    const g = this.game, s = this.snap(), pts = standing(s);
    return nextGoals({ ...s, points: pts, rank: rankFor(pts), owned: g.boatsOwned || new Set(["raft"]), gear: this.gear, claimed: this.claimed, light: this.light, storyHint: this.shuttleHint(), job: g.jobs?.active ? g.jobs.hudLine().split(" · ").slice(0, 2).join(" · ") : null });
  }

  // When Wren's next stop is far off and a camp you've found is much nearer
  // to it, say so: paddling back down water you know is the slow way.
  shuttleHint() {
    const g = this.game, ch = currentChapter(this.claimed), P = g.places;
    if (!ch || !P) return "";
    const all = [...P.camps, ...(P.landmarks || [])], b = g.pos();
    const t = ch.targets.map((id) => all.find((q) => q.id === id)).find((q) => q && !g.journal.has(q.id));
    if (!t || !b) return "";
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    if (d < 900) return "";
    const near = P.camps.filter((c) => g.journal.has(c.id) || this.shuttleOK(c.id)).map((c) => ({ c, d: Math.hypot(t.x - c.x, t.z - c.z) })).sort((a, b2) => a.d - b2.d)[0];
    if (!near) return "";
    if (near.c.id === t.id) return `The shuttle can take you to ${t.name}.`;
    return near.d < d * 0.5 ? `The shuttle to ${near.c.name} saves the paddle.` : "";
  }

  tick(dt) {
    const g = this.game;
    if (!g.journal) return;
    // River finds: pick them up as you pass.
    if (!this.placed) this.placed = placeFinds(g.world);
    const b = g.pos();
    for (const f of this.placed) {
      if (this.finds.has(f.id) || Math.abs(f.x - b.x) > 10 || Math.abs(f.z - b.z) > 10) continue;
      if (Math.hypot(f.x - b.x, f.z - b.z) < 9) this.pickUp(f);
    }
    const hit = !g.walker?.active && g.boat.current?.hit;
    if (hit && !this.rivers.has(hit.river.id)) { this.rivers.add(hit.river.id); if (["long", "bright", "cold"].every((r) => this.rivers.has(r))) g.journal.feat("three-rivers"); }
    // Wren's first letter, once you're on the water (until it's done).
    if (!this.introShown && !this.claimed.size && g.time > 6 && !g.hud.anyOpen?.()) {
      this.introShown = true;
      g.hud.card(`<div class="kicker">A letter at Meadow Fork</div><b>${esc(CHAPTERS[0].title)}</b><span>${esc(CHAPTERS[0].letter)}</span>`);
    }
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    this.check();
    this.hudGoal();
  }

  pickUp(f) {
    const g = this.game;
    this.finds.add(f.id);
    g.hud.card(`<div class="kicker">River find</div><b>${esc(f.name)}</b><span>${esc(f.text)}</span>`);
    g.journal.earn(10, null);
    g.audio?.judgment?.("perfect");
    if (FINDS.every((x) => this.finds.has(x.id))) g.journal.feat("beachcomber");
    g.save?.soon();
  }

  // Feats that follow from state, chapters, and rank-ups. On the first check
  // after loading a save from before progress existed, everything already
  // earned is caught up quietly, with one toast.
  check() {
    const g = this.game, j = g.journal, s = this.snap();
    const quiet = this.fresh && this.loaded;
    const owed = [];
    const owned = g.boatsOwned || new Set(["raft"]);
    if (["kayak", "canoe", "dory"].every((k) => owned.has(k))) owed.push("fleet");
    const best = g.races?.best || {}, courses = g.races?.courses || [];
    if (courses.length && courses.every((c) => best[c.id]?.medal)) owed.push("podium");
    if (courses.length && courses.every((c) => best[c.id]?.medal === "gold")) owed.push("golden");
    if (best.descent) owed.push("descent");
    let newFeats = 0, newChapters = 0;
    for (const id of owed) if (!j.feats.has(id)) { if (quiet) { j.feats.add(id); j.pay += 25; newFeats++; } else j.feat(id); }
    for (let ch = currentChapter(this.claimed); ch && chapterDone(ch, s); ch = currentChapter(this.claimed)) {
      this.claimed.add(ch.id);
      newChapters++;
      if (quiet) { j.pay += ch.reward; continue; }
      const next = currentChapter(this.claimed);
      g.hud.card(`<div class="kicker">Wren's letters · ${CHAPTERS.indexOf(ch) + 1} of ${CHAPTERS.length}</div><b>${esc(ch.title)}</b><span>Done. +${ch.reward} pay.${next ? ` A new letter: ${esc(next.goal)}` : " The light is yours."}</span>`);
      j.earn(ch.reward, null);
      if (!next) j.feat("keeper");
    }
    if (quiet && !currentChapter(this.claimed) && !j.feats.has("keeper")) { j.feats.add("keeper"); newFeats++; }
    const r = this.rank();
    if (this.seenRank == null || quiet) this.seenRank = r;
    else if (r > this.seenRank) {
      this.seenRank = r;
      g.jobs?.boards?.clear?.();
      g.hud.card(`<div class="kicker">New rank</div><b>${RANKS[r].name}</b><span>${esc(RANKS[r].opens)}</span>`);
      g.save?.soon();
    }
    if (quiet) {
      this.fresh = false;
      if (newFeats || newChapters) g.hud.toast(`Your journal caught up: ${[newChapters && `${newChapters} of Wren's letters`, newFeats && `${newFeats} new feat${newFeats > 1 ? "s" : ""}`].filter(Boolean).join(" and ")}.`, 6);
      g.save?.soon();
    } else if (newChapters) g.save?.soon();
  }

  // One quiet line under the place name: the most useful next thing.
  hudGoal() {
    const g = this.game;
    if (typeof document === "undefined") return;
    if (!this.el) {
      const sub = document.getElementById("h-sub");
      if (!sub) return;
      this.el = document.createElement("button");
      this.el.className = "where-goal"; this.el.id = "h-goal"; this.el.title = "What next (J opens the journal)";
      this.el.onclick = () => g.hud.action("journal");
      sub.after(this.el);
    }
    const busy = g.caller?.rapid || g.races?.run || g.boat.swimming;
    // With a job on, Wren's letter still gets 10 seconds in every 30.
    const goals = busy ? [] : this.goals(), story = goals.find((x) => x.kind === "story");
    const goal = goals[0]?.kind === "job" && story && (g.time % 30) > 20 ? story : goals[0];
    const text = goal ? `→ ${goal.text}` : "";
    if (text !== this.goalText) { this.el.textContent = text; this.el.hidden = !text; this.goalText = text; }
  }

  draw(R) {
    const g = this.game, b = g.pos(), t = g.time, night = g.night || 0;
    this.drawLight(R);
    if (!this.placed) return;
    for (const f of this.placed) {
      if (this.finds.has(f.id)) continue;
      const d = Math.hypot(f.x - b.x, f.z - b.z);
      if (d > 260) continue;
      const bob = Math.sin(t * 1.8 + f.x) * 0.12;
      const bottle = f.icon === "bottle";
      R.items.push(PRIM.CAPSULE, f.x, f.y + 0.2 + bob, f.z, 0.3, bottle ? 0.7 : 0.5, 0.3, bottle ? 0.45 : 0.8, bottle ? 0.75 : 0.55, bottle ? 0.55 : 0.3);
      // A glint you can spot from upstream, brighter at night.
      const tw = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3 + f.z));
      R.points.push(f.x, f.y + 1.1 + bob, f.z, 34, 1.1 + night * 0.5, 1, 0.95, 0.7, tw * (0.7 + night * 0.3), POINT_SOFT);
      // A ring of ripples round it, so it reads as "something in the water".
      if (d < 120) for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + t * 0.6; R.points.push(f.x + Math.cos(a) * 1.4, f.y + 0.08, f.z + Math.sin(a) * 1.4, 8, 0.35, 0.85, 1, 0.95, 0.6, POINT_SOFT); }
    }
  }

  // The map's extra layer: Wren's next stop, finds, race starts, rumours.
  drawMap(ctx, k) {
    const g = this.game, j = g.journal, P = g.places;
    const all = [...P.camps, ...P.landmarks];
    const label = (text, x, y, col) => { ctx.font = "bold 15px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#000b"; ctx.strokeText(text, x, y); ctx.fillStyle = col; ctx.fillText(text, x, y); };
    // Race starts, tinted by your medal.
    for (const c of g.races?.courses || []) {
      const gt = c.gates[0], m = g.races.best[c.id]?.medal, x = gt.x * k, y = gt.z * k;
      if (!j.explored[Math.floor(gt.z / g.world.size * 64) * 64 + Math.floor(gt.x / g.world.size * 64)]) continue;
      ctx.fillStyle = { gold: "#ffd166", silver: "#d8dde3", bronze: "#cd8a4b" }[m] || "#3fd16b";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 16); ctx.lineTo(x + 11, y - 12); ctx.lineTo(x, y - 8); ctx.fill();
      ctx.strokeStyle = "#000a"; ctx.lineWidth = 2; ctx.stroke();
    }
    // Finds you have, and (with the Chart Case) the ones still out there.
    for (const f of this.placed || []) {
      const got = this.finds.has(f.id);
      if (!got && !this.has("chart-case")) continue;
      const x = f.x * k, y = f.z * k;
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath();
      ctx.fillStyle = got ? "#9be7c4" : "#0000"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = got ? "#0009" : "#9be7c4"; ctx.stroke();
    }
    if (this.has("chart-case")) for (const p of all) if (!j.has(p.id)) label("?", p.x * k, p.z * k + 5, "#cfe");
    // Wren's next stop.
    const ch = currentChapter(this.claimed);
    for (const id of ch?.targets || []) {
      const p = all.find((q) => q.id === id);
      if (!p || (id !== "throat" && j.has(id) && ch.id !== "sea")) continue;
      const x = p.x * k, y = p.z * k, r = 22 + Math.sin(g.time * 3) * 3;
      ctx.setLineDash([6, 5]); ctx.lineWidth = 3; ctx.strokeStyle = "#7fe0ff";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      label(j.has(id) ? p.name : "Wren's letter: ?", x, y - r - 6, "#7fe0ff");
    }
  }

  mapLegend() {
    return `<span style="color:#ff9a3c">●</span> camp · <span style="color:#ffd166">●</span> landmark · <span style="color:#3fd16b">⚑</span> race start · <span style="color:#9be7c4">◆</span> river find · <span style="color:#7fe0ff">◌</span> Wren's next letter`;
  }

  // Journal sections: what next, standing, Wren's letters, river finds.
  journalHtml(badge) {
    const s = this.snap(), pts = standing(s), r = rankFor(pts), nx = RANKS[r + 1];
    const pct = nx ? Math.round((pts - RANKS[r].at) / (nx.at - RANKS[r].at) * 100) : 100;
    const goals = this.goals().map((x) => `<div class="item"><span>${esc(x.text)}</span></div>`).join("");
    const cur = currentChapter(this.claimed);
    const letters = CHAPTERS.filter((c) => this.claimed.has(c.id) || c === cur).map((c, i) => `<details class="item" ${c === cur ? "open" : ""}><summary><b>${i + 1}. ${esc(c.title)}</b> ${c === cur ? '<span class="tag">now</span>' : '<span class="tag">done</span>'}</summary><p class="small">${esc(c.letter)}</p>${c === cur ? `<p><b>Goal:</b> ${esc(c.goal)}</p>` : ""}</details>`).join("");
    const finds = FINDS.map((f) => { const on = this.finds.has(f.id); return `<div class="tile ${on ? "" : "locked"}" tabindex="0">${badge(f.icon, on)}<b>${on ? esc(f.name) : "Unknown"}</b>${on ? `<span class="small">${esc(f.text)}</span>` : ""}</div>`; }).join("");
    return `<h3>What next</h3><div class="list">${goals}</div>
      <h3>Standing: ${RANKS[r].name}</h3><div class="bar" style="height:8px;background:#0004;border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:#ffd166"></i></div>
      <p class="small">${pts} standing${nx ? ` · ${nx.at - pts} more for ${nx.name}: ${esc(nx.opens)}` : " · the top of the river."} Places, feats, deliveries, medals and finds all count.</p>
      <h3>Wren's letters <span class="small">${this.claimed.size} of ${CHAPTERS.length}</span></h3><div class="list">${letters}</div>
      <h3>River finds <span class="small">${this.finds.size} of ${FINDS.length}</span></h3><div class="tiles">${finds}</div>`;
  }

  // The camp's Gear tab.
  gearHtml() {
    const g = this.game, r = this.rank();
    return `<p class="small">Gear fits every boat you own. You are a <b>${RANKS[r].name}</b> with ${g.journal.pay} pay.</p><div class="tiles">${GEAR.map((x) => {
      const own = this.gear.has(x.id), locked = r < x.rank;
      return `<button class="tile ${own ? "sel" : ""} ${locked && !own ? "locked" : ""}" data-gear="${x.id}" ${own || locked ? "disabled" : ""}><b>${esc(x.name)}</b>${own ? "fitted" : locked ? `for a ${RANKS[x.rank].name}` : `${x.price} pay`}<br><span class="small">${esc(x.text)}</span></button>`;
    }).join("")}</div>${this.lightHtml()}`;
  }

  lightHtml() {
    if (!lightOpen(this.claimed, this.game.journal.found)) return `<h3>Saltmouth Light</h3><p class="small">Wren at Saltmouth Light could use help. Do some work for her first.</p>`;
    return `<h3>Saltmouth Light <span class="small">${this.light} of ${LIGHT.length}</span></h3><p class="small">Send pay down the river and Wren will put it to work. Go and see it at the light.</p><div class="tiles">${LIGHT.map((L, i) => {
      const done = i < this.light, next = i === this.light;
      return `<button class="tile ${done ? "sel" : ""} ${!done && !next ? "locked" : ""}" ${next ? 'data-light="1"' : "disabled"}><b>${esc(L.name)}</b>${done ? "done" : next ? `${L.price} pay` : "later"}<br><span class="small">${esc(L.text)}</span></button>`;
    }).join("")}</div>`;
  }

  // What you've paid for at Saltmouth Light, drawn each frame near the light.
  drawLight(R) {
    const g = this.game, P = g.places;
    if (!this.light || !P?.landmarks) return;
    const l = P.landmarks.find((q) => q.id === "lighthouse");
    if (!l) return;
    const b = g.pos(), d = Math.hypot(l.x - b.x, l.z - b.z);
    if (d > (this.light >= 4 ? 2400 : 700)) return;
    const W = g.world, t = g.time, night = g.night || 0;
    if (!this.lightGeo) {
      // Toward the nearest water: where the dock runs out.
      let best = null;
      for (let r = 10; r <= 70 && !best; r += 4) for (let k = 0; k < 24 && !best; k++) {
        const a = k / 24 * Math.PI * 2, x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r;
        if (!Number.isNaN(waterAt(W, x, z))) best = { ux: Math.cos(a), uz: Math.sin(a), r };
      }
      best = best || { ux: -0.7, uz: -0.7, r: 20 };
      const gy = heightAt(W, l.x, l.z);
      // The cottage stands inland of the tower, on dry ground.
      let home = null;
      for (let k = 9; k <= 40 && !home; k += 2) for (const side of [5, -5, 0]) {
        const x = l.x - best.ux * k - best.uz * side, z = l.z - best.uz * k + best.ux * side;
        if (!home && Number.isNaN(waterAt(W, x, z)) && heightAt(W, x, z) > 0.5) home = { x, z };
      }
      this.lightGeo = { ...best, gy, home: home || { x: l.x - best.ux * 10, z: l.z - best.uz * 10 }, lamp: l.lamp || { x: l.x, y: gy + 14, z: l.z } };
    }
    const G = this.lightGeo, ux = G.ux, uz = G.uz, px = -uz, pz = ux;
    if (this.light >= 1) {          // the dock: planks from the shore out over the water
      for (let k = 0; k < 9; k++) {
        const x = l.x + ux * (G.r - 3 + k * 1.3), z = l.z + uz * (G.r - 3 + k * 1.3);
        const wl = waterAt(W, x, z), y = Number.isNaN(wl) ? heightAt(W, x, z) + 0.15 : wl + 0.35;
        R.items.push(PRIM.CUBE, x, y, z, 1.3, 0.12, 1.3, k % 2 ? 0.47 : 0.42, k % 2 ? 0.32 : 0.28, k % 2 ? 0.19 : 0.16);
        if (k === 8) {
          R.items.push(PRIM.CYLINDER, x, y + 0.9, z, 0.08, 0.9, 0.08, 0.3, 0.2, 0.12);
          R.points.push(x, y + 1.9, z, 16, 0.5, 1, 0.8, 0.4, 0.4 + night * 0.6, POINT_SOFT);
          if (night > 0.2) R.lights.push(x, y + 1.9, z, 10, 1, 0.75, 0.4, night, 1, 0, 0, 0);
        }
      }
    }
    if (this.light >= 2) {          // pennants on a line from the lamp to the end of the dock
      const ex = l.x + ux * (G.r + 7.4), ez = l.z + uz * (G.r + 7.4), ew = waterAt(W, ex, ez);
      const sx = ex, sz = ez, sy = (Number.isNaN(ew) ? heightAt(W, ex, ez) : ew) + 2.6;
      const L = G.lamp, cols = [[0.9, 0.2, 0.15], [1, 0.85, 0.2], [0.2, 0.5, 0.95], [0.95, 0.95, 0.92]];
      R.lines.push(L.x, L.y - 1, L.z, sx, sy, sz, 0.25, 0.2, 0.15, 1);
      for (let k = 1; k < 12; k++) {
        const u = k / 12, c = cols[k % 4], sway = Math.sin(t * 2 + k) * 0.15;
        R.items.push(PRIM.CUBE, L.x + (sx - L.x) * u + px * sway, L.y - 1 + (sy - L.y + 1) * u - 0.35, L.z + (sz - L.z) * u + pz * sway, 0.45, 0.5, 0.45, c[0], c[1], c[2]);
      }
    }
    if (this.light >= 3) {          // the cottage beside the tower
      const cx = G.home.x, cz = G.home.z, cy = heightAt(W, cx, cz);
      R.items.push(PRIM.CUBE, cx, cy + 1.8, cz, 3.6, 1.8, 3.0, 0.92, 0.9, 0.84);
      R.items.push(PRIM.CUBE, cx, cy + 3.9, cz, 4.0, 0.45, 3.4, 0.55, 0.22, 0.16);
      R.items.push(PRIM.CUBE, cx + ux * 3.05, cy + 1.9, cz + uz * 3.05, 0.6, 0.55, 0.6, 1, 0.85, 0.45 * (0.4 + night));
      if (night > 0.2) R.lights.push(cx + ux * 4, cy + 2, cz + uz * 4, 9, 1, 0.75, 0.4, 1.1 * night, 1, 0, 0, 0);
    }
    if (this.light >= 4 && night > 0.2) {   // the new lens: a long gold beam
      const L = G.lamp, a = t * 1.2 + Math.PI;
      for (let k = 1; k < 60; k++) R.points.push(L.x + Math.cos(a) * k * 9, L.y - k * 0.06, L.z + Math.sin(a) * k * 9, 34 - k * 0.4, 3 + k * 0.4, 1, 0.82, 0.35, 0.5 * night * (1 - k / 60), POINT_SOFT);
      R.points.push(L.x, L.y, L.z, 60, 3, 1, 0.85, 0.4, night, POINT_SOFT);
    } else if (this.light >= 4) R.points.push(G.lamp.x, G.lamp.y, G.lamp.z, 24, 1.5, 1, 0.9, 0.5, 0.8, POINT_SOFT);
  }
}


// A headless 30-minute session: a model player paddles, takes jobs, explores
// and spends pay, using the game's real job boards, journal, progress and
// places (no engine, no DOM). Travel is modelled, not simulated: distance
// along the valley over a boat speed, slower upstream; the shuttle when the
// way is upstream and the camp is known.
//   node docs/playtests/0.2.0/content/pacing.mjs [--old | --wave1] [--explorer] [--minutes 30] [--seed 1]
// --old: 0.1.0 rules. --wave1: this branch without the shuttle hint and the
// light (errands stay on the boards). --explorer: a job every other camp.
import { generateWorld, riverAt } from "../../../../web/src/world/terrain.js";
import { makeBoat, BOATS } from "../../../../web/src/sim/boat.js";
import { Places, CAMPS, LANDMARKS } from "../../../../web/src/game/places.js";
import { Journal, FEATS } from "../../../../web/src/game/journal.js";
import { Jobs } from "../../../../web/src/game/jobs.js";
import { Progress, GEAR, RANKS, CHAPTERS, placeFinds, currentChapter } from "../../../../web/src/game/progress.js";
import { mulberry32 } from "../../../../web/src/world/rng.js";

const args = process.argv.slice(2);
const OLD = args.includes("--old");
const EXPLORER = args.includes("--explorer");
const WAVE2 = !OLD && !args.includes("--wave1");          // wave 2: errands, light, shuttle hints (errands are on the boards either way)              // follows "what next": a job only every other camp                       // 0.1.0 behaviour: no progress system
const MINUTES = Number(args[args.indexOf("--minutes") + 1]) || 30;
const SEED = Number(args[args.indexOf("--seed") + 1]) || 1;
const rnd = mulberry32(SEED * 7);
const world = generateWorld(1, "small");
const places = new Places({ world });
const events = [];
let T = 0;                                                // real seconds
const log = (kind, text) => events.push({ t: T, kind, text });
const g = {
  world, places, params: new URLSearchParams(), clock: 8.5 / 24, dayCount: 0, time: 0, night: 0, placesDefs: { CAMPS, LANDMARKS },
  hud: { toast: () => {}, card: (h) => log("card", h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()), discovery: (p) => log("found", p.name), featCard: (f) => log("feat", f.name), action: () => {} },
  races: { best: {}, courses: [] }, caller: { rapid: null }, pos() { return this.boat; },
};
places.game = g;
g.boat = makeBoat("raft", places.camps[0].x, places.camps[0].z, 0);
g.boatsOwned = new Set(["raft"]);
g.journal = new Journal(g);
g.jobs = new Jobs(g);
if (!OLD) g.progress = new Progress(g);
g.save = { soon() {}, write() {} };
const finds = OLD ? [] : placeFinds(world);
const all = [...places.camps, ...places.landmarks];
const COURSE_STARTS = []; // races modelled loosely below
let at = places.camps[0], visits = 0;
const FALLS_TOP = places.landmarks.find((l) => l.id === "falls").level + 17;   // the top of the sixteen-metre drop
const speedDown = { raft: 3.2, kayak: 4.4, canoe: 3.9, dory: 4.2 };

function advance(secs) { T += secs; g.clock += secs / 1440; while (g.clock >= 1) { g.clock -= 1; g.dayCount++; } g.night = (g.clock < 6 / 24 || g.clock > 20.5 / 24) ? 1 : 0; }
function tick() { g.progress?.check(); }

// Travel from `at` to place p: time, discoveries and rapids on the way.
function travel(p) {
  const known = !!p.flag && (g.journal.has(p.id) || g.progress?.shuttleOK(p.id)) && p.id !== at.id;
  const up = (p.level ?? 0) > (at.level ?? 0) + 4;
  const d = Math.hypot(p.x - at.x, p.z - at.z) * 1.35;
  // The shuttle: always for known camps upstream; downstream too when it's far
  // and nothing is being hauled (what the "what next" hint suggests).
  if (known && (up || (WAVE2 && !g.jobs.active && d > 900))) { if (!OLD) g.jobs.onShuttle(); g.clock += 3 / 24; advance(20); log("shuttle", `${at.name} → ${p.name}`); }
  else {
    const v = up ? 1.3 : speedDown[g.boat.kind];
    // Walk the straight line in 25 m steps: discoveries, finds, rapids.
    const n = Math.max(1, Math.round(d / 1.35 / 25));
    let rough = 0;
    for (let i = 1; i <= n; i++) {
      const x = at.x + (p.x - at.x) * i / n, z = at.z + (p.z - at.z) * i / n;
      advance(d / v / n);
      for (const q of all) if (Math.hypot(q.x - x, q.z - z) < (q.kind ? 60 : 45)) g.journal.discover(q);
      for (const f of finds) if (!g.progress.finds.has(f.id) && Math.hypot(f.x - x, f.z - z) < 40) g.progress.pickUp(f);
      const hit = riverAt(world, x, z);
      if (hit && hit.sample.cls >= 2) rough += 25;
      if (hit && !OLD) { const id = hit.river.id; if (!g.progress.rivers.has(id)) { g.progress.rivers.add(id); if (["long", "bright", "cold"].every((r) => g.progress.rivers.has(r))) g.journal.feat("three-rivers"); } }
      if (hit?.river.id === "long" && hit.sample.s < 40) g.journal.fromSource = true;
      if (rough >= 200 && !up) { rough = 0; rapid(hit); }
      if (g.journal.fromSource && x + z > world.size * 1.82) g.journal.feat("sea");
      g.boat.x = x; g.boat.z = z;
      tick();
    }
  }
  at = p; g.boat.x = p.x; g.boat.z = p.z;
  g.journal.discover(p);
  g.jobs.tick();
  tick();
}
function rapid(hit) {
  g.journal.feat("first-rapid");
  const r = rnd();
  if (r < 0.12) { g.journal.onFlip(); g.jobs.onFlip(); return; }
  if (r < 0.55 && hit.sample.cls >= 3) g.journal.feat("clean-line");
  if (r < 0.3) g.journal.feat("flow");
  if (hit.sample.cls === 5 && r >= 0.12) g.journal.feat("throat");
  g.jobs.onRapid({}, { miss: r < 0.5 ? 0 : 2, perfect: 3, good: 1 });
  if (r > 0.8) g.jobs.onHit(0.15);
}
function shop() {
  if (OLD) {
    for (const [k, p] of [["kayak", 60], ["canoe", 90], ["dory", 180]]) if (!g.boatsOwned.has(k) && g.journal.pay >= p) { g.journal.pay -= p; g.boatsOwned.add(k); log("buy", BOATS[k].name); if (k !== "kayak") g.boat = makeBoat(k, g.boat.x, g.boat.z, 0); }
    return;
  }
  for (const it of [...GEAR].sort((a, b) => a.price - b.price)) if (!g.progress.gear.has(it.id) && it.rank <= g.progress.rank() && g.journal.pay >= it.price) { g.progress.buy(it.id); log("buy", it.name); }
  for (const [k, p] of [["canoe", 90], ["kayak", 60], ["dory", 180]]) if (!g.boatsOwned.has(k) && g.journal.pay >= p + 20) { g.journal.pay -= p; g.boatsOwned.add(k); log("buy", BOATS[k].name); if (k !== "kayak") { g.boat = makeBoat(k, g.boat.x, g.boat.z, 0); g.progress.fit(g.boat); } }
  if (["kayak", "canoe", "dory"].every((k) => g.boatsOwned.has(k))) g.journal.feat("fleet");
  // Then Saltmouth Light, once everything else is bought.
  if (WAVE2 && GEAR.every((x) => g.progress.gear.has(x.id) || x.rank > g.progress.rank()) && ["kayak", "canoe", "dory"].every((k) => g.boatsOwned.has(k))) while (g.progress.light < 4 && g.progress.fund()) log("buy", `Saltmouth Light stage ${g.progress.light}`);
}

// The player's loop: a job if one is near our way, else the story's (or the nearest unknown) place.
while (T < MINUTES * 60) {
  if (at.id === "tarn" && g.journal.has("tarn") && !g.journal.has("spring")) { travel(all.find((p) => p.id === "spring")); continue; }
  if (at.flag) { shop(); }
  let skip = false;
  if (EXPLORER) { visits = (visits || 0) + 1; skip = visits % 2 === 0; }
  if (!g.jobs.active && at.flag && !skip) {
    const board = g.jobs.board(at).filter((j) => !(j.kind === "passenger" && g.boat.spec.cargo < 2));
    const best = board.sort((a, b) => b.pay / (b.dist + 300) - a.pay / (a.dist + 300))[0];
    if (best) { g.jobs.take(best); log("job", `${best.kind || "delivery"}: ${best.label || best.good + " → " + best.toName} (${best.pay})`); }
  }
  let target = g.jobs.dest();
  if (!target) {
    const ch = OLD ? null : currentChapter(g.progress.claimed);
    const storyT = ch?.targets.map((id) => all.find((p) => p.id === id)).find((p) => p && !g.journal.has(p.id));
    // Above the High Falls is out of reach by paddle (unless the shuttle goes there).
    const above = (p) => p.level > FALLS_TOP + 0 && !(p.flag && (g.journal.has(p.id) || g.progress?.shuttleOK(p.id))) && !(p.id === "spring" && g.journal.has("tarn"));
    const unknown = all.filter((p) => !g.journal.has(p.id) && !above(p)).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    // Follow the shuttle hint: hop to the found camp nearest a far-off stop.
    let hop = null;
    if (WAVE2 && storyT && !above(storyT) && Math.hypot(storyT.x - at.x, storyT.z - at.z) > 900) {
      hop = places.camps.filter((c) => c !== at && (g.journal.has(c.id) || g.progress.shuttleOK(c.id))).sort((a, b) => Math.hypot(a.x - storyT.x, a.z - storyT.z) - Math.hypot(b.x - storyT.x, b.z - storyT.z))[0];
      if (hop && Math.hypot(hop.x - storyT.x, hop.z - storyT.z) > Math.hypot(storyT.x - at.x, storyT.z - at.z) * 0.5) hop = null;
    }
    target = hop || (storyT && !above(storyT) ? storyT : null) || unknown || places.camps[Math.floor(rnd() * places.camps.length)];
  }
  if (target === at) { advance(30); g.jobs.active = null; continue; }
  travel(target);
  if (!g.jobs.active && at.flag) advance(25);            // time at the board, resting, reading
}

// Report.
const m = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
const milestones = events.filter((e) => e.kind !== "job" && e.kind !== "shuttle");
let gap = { len: 0 }, last = 0;
for (const e of milestones) { if (e.t - last > gap.len) gap = { len: e.t - last, from: last, to: e.t }; last = e.t; }
if (MINUTES * 60 - last > gap.len) gap = { len: MINUTES * 60 - last, from: last, to: MINUTES * 60 };
console.log(`# ${OLD ? "0.1.0 rules" : WAVE2 ? "0.2.0 wave 2" : "0.2.0 wave 1 (errands on)"}${EXPLORER ? " · explorer" : " · worker"} · seed ${SEED} · ${MINUTES} min`);
for (const e of events) console.log(`${m(e.t)}  ${e.kind.padEnd(7)} ${e.text}`);
const lastBuy = events.filter((e) => e.kind === "buy").at(-1);
console.log(`\npay ${g.journal.pay} · deliveries ${g.journal.deliveries} · found ${g.journal.found.size}/18 · feats ${g.journal.feats.size}/${FEATS.length}` +
  (OLD ? "" : ` · rank ${RANKS[g.progress.rank()].name} (${g.progress.points()}) · letters ${g.progress.claimed.size}/${CHAPTERS.length} · finds ${g.progress.finds.size} · gear ${g.progress.gear.size}/${GEAR.length} · light ${g.progress.light}/4`));
console.log(`milestones ${milestones.length} · longest gap without one ${m(gap.len)} (${m(gap.from)}–${m(gap.to)}) · last purchase ${lastBuy ? m(lastBuy.t) : "none"} · nothing left to buy: ${OLD ? ["kayak", "canoe", "dory"].every((k) => g.boatsOwned.has(k)) : ["kayak", "canoe", "dory"].every((k) => g.boatsOwned.has(k)) && g.progress.gear.size === GEAR.length && (!WAVE2 || g.progress.light >= 4)}`);

// Progress: ranks, gear, Wren's letters, river finds, job kinds, and the save
// compatibility promise (a 0.1.0 save still loads, and loads well).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, waterAt } from "../web/src/world/terrain.js";
import { makeBoat, BOATS, stroke, stepBoat } from "../web/src/sim/boat.js";
import { Places, CAMPS, LANDMARKS } from "../web/src/game/places.js";
import { Journal, FEATS } from "../web/src/game/journal.js";
import { Jobs } from "../web/src/game/jobs.js";
import { Save } from "../web/src/game/save.js";
import { Progress, RANKS, GEAR, CHAPTERS, FINDS, standing, rankFor, gearedSpec, placeFinds, nextGoals, normalize, currentChapter, LIGHT, GEAR_CAPS } from "../web/src/game/progress.js";

const world = generateWorld(1, "tiny");
const places = new Places({ world });

// A game with everything but the engine and the DOM.
function fakeGame(params = "") {
  const log = { toasts: [], cards: [] };
  const g = {
    world, places, params: new URLSearchParams(params), clock: 0.35, dayCount: 0, time: 0, night: 0,
    placesDefs: { CAMPS, LANDMARKS }, log,
    hud: { toast: (t) => log.toasts.push(t), card: (h) => log.cards.push(h), discovery: () => {}, featCard: (f) => log.cards.push(f.name), action: () => {}, anyOpen: () => false },
    races: { best: {}, courses: [{ id: "a" }, { id: "b" }], restore(d) { if (d && d.best) this.best = d.best; }, data() { return { best: this.best }; } },
    caller: { rapid: null },
    pos() { return this.boat; },
  };
  places.game = g;
  g.boat = makeBoat("raft", places.camps[0].x, places.camps[0].z, 0);
  g.boatsOwned = new Set(["raft"]);
  g.journal = new Journal(g);
  g.jobs = new Jobs(g);
  g.progress = new Progress(g);
  g.save = new Save(g);
  g.save.soon = () => {};
  return g;
}

// Exactly what Save.data() wrote in 0.1.0 (no day, no progress, no journal.night).
const SAVE_010 = {
  v: 1, seed: 1, boat: "canoe", pos: { x: 1200, z: 1300, heading: 0.5 }, clock: 0.6, hull: 0.8,
  boatsOwned: ["raft", "kayak", "canoe"], colour: [0.2, 0.4, 0.9],
  journal: { found: ["fork", "lodge", "lookout", "dock", "isle", "bridge"], feats: ["first-rapid", "swim", "courier"], visited: ["fork"], pay: 37, deliveries: 6, explored: btoa("\x01".repeat(64)), fromSource: false },
  jobs: { active: { id: "fork:0:1", from: "fork", to: "lodge", toName: "Brightwater Lodge", good: "seed bags", fragile: false, pay: 45, hours: 5, upstream: true, dist: 600, dueClock: 0.9, value: 45, startedAt: 12 } },
  races: { best: { "meadow-sprint": { ms: 50000, ghost: null, medal: "silver" } } },
  at: 1763800000000,
};

function load(g, saved) {
  g.boat = makeBoat(saved.boat, saved.pos.x, saved.pos.z, saved.pos.heading);
  g.save.apply(saved);
  g.journal.restore(saved.journal);
}

test("a 0.1.0 save loads with sensible defaults", () => {
  const g = fakeGame();
  load(g, JSON.parse(JSON.stringify(SAVE_010)));
  assert.equal(g.boat.kind, "canoe");
  assert.equal(g.boat.hull, 0.8);
  assert.equal(g.dayCount, 0);
  assert.deepEqual([...g.boatsOwned], ["raft", "kayak", "canoe"]);
  assert.equal(g.journal.pay, 37);
  assert.equal(g.journal.nightTime, 0);
  assert.equal(g.jobs.active.kind, "delivery");             // an old job is a delivery
  assert.equal(g.jobs.dest().id, "lodge");
  assert.equal(g.progress.gear.size, 0);
  assert.equal(g.progress.finds.size, 0);
  assert.equal(g.boat.spec.stroke, BOATS.canoe.stroke);     // no gear, no change
  assert.equal(g.races.best["meadow-sprint"].medal, "silver");
});

test("an old save catches up quietly: letters it has already earned, one toast, no card flood", () => {
  const g = fakeGame();
  load(g, JSON.parse(JSON.stringify(SAVE_010)));
  g.progress.check();
  // first-water, honest-work, brightwater, gorge, mirror are done; coldwater isn't.
  assert.deepEqual([...g.progress.claimed], ["first-water", "honest-work", "brightwater", "gorge", "mirror"]);
  assert.equal(currentChapter(g.progress.claimed).id, "coldwater");
  assert.equal(g.log.cards.length, 0);
  assert.equal(g.log.toasts.length, 1);
  assert.match(g.log.toasts[0], /5 of Wren's letters/);
  assert.equal(g.journal.pay, 37 + 15 + 20 + 25 + 25 + 30);
  // A second check does nothing more.
  g.progress.check();
  assert.equal(g.log.toasts.length, 1);
});

test("a new save round-trips, and its extra fields survive a reload", () => {
  const g = fakeGame();
  load(g, JSON.parse(JSON.stringify(SAVE_010)));
  g.progress.check();
  g.journal.pay = 500;
  g.dayCount = 3;
  g.journal.nightTime = 64;
  // Earn a rank that opens gear, then buy some.
  for (const id of ["tarn", "spring", "mill", "hotspring", "ferry", "town", "arch", "wheel", "rookery", "lighthouse"]) g.journal.found.add(id);
  ["clean-line", "flow", "night", "falls"].forEach((f) => g.journal.feats.add(f));
  assert.ok(g.progress.rank() >= 2, `rank ${g.progress.rank()}`);
  assert.ok(g.progress.buy("patch-kit"));
  assert.ok(g.progress.buy("long-paddle"));
  g.progress.finds.add("cup");
  const data = JSON.parse(JSON.stringify(g.save.data()));
  assert.equal(data.v, 1);
  assert.equal(data.day, 3);
  assert.deepEqual(data.progress.gear, ["patch-kit", "long-paddle"]);

  const h = fakeGame();
  load(h, data);
  assert.equal(h.dayCount, 3);
  assert.equal(h.journal.nightTime, 64);
  assert.ok(h.progress.has("patch-kit") && h.progress.has("long-paddle"));
  assert.ok(h.progress.finds.has("cup"));
  assert.ok(Math.abs(h.boat.spec.stroke - BOATS.canoe.stroke * 1.08) < 1e-9);
  assert.equal(h.boat.spec.hullWear, 0.7);
  h.progress.check();
  assert.equal(h.log.toasts.length, 0, "a save with progress never catches up again");
});

test("garbage in a save's progress block is dropped, not trusted", () => {
  const n = normalize({ gear: ["patch-kit", "laser", 7, null], chapters: "nope", finds: ["cup", "x"], rank: "high" });
  assert.deepEqual([...n.gear], ["patch-kit"]);
  assert.equal(n.claimed.size, 0);
  assert.deepEqual([...n.finds], ["cup"]);
  assert.equal(n.seenRank, null);
  assert.equal(normalize(null).fresh, true);
  assert.equal(normalize(undefined).fresh, true);
});

test("ranks rise with standing and open in order", () => {
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].at > RANKS[i - 1].at);
  assert.equal(rankFor(0), 0);
  assert.equal(rankFor(RANKS[2].at), 2);
  assert.equal(rankFor(RANKS[2].at - 1), 1);
  assert.equal(rankFor(1e6), RANKS.length - 1);
  const s = { found: new Set(["a", "b"]), feats: new Set(["x"]), deliveries: 2, best: { c: { medal: "gold" }, d: { medal: null } }, finds: new Set(["cup"]) };
  assert.equal(standing(s), 2 * 2 + 4 + 2 * 3 + 6 + 3);
  // Every gear item is reachable, and River Master is reachable without grinding deliveries forever.
  for (const x of GEAR) assert.ok(x.rank < RANKS.length);
  const max = standing({ found: new Set(Array(18).fill(0).map((_, i) => i)), feats: new Set(FEATS.map((f) => f.id)), deliveries: 40, best: Object.fromEntries(Array(6).fill(0).map((_, i) => [i, { medal: "gold" }])), finds: new Set(FINDS.map((f) => f.id)) });
  assert.ok(max > RANKS.at(-1).at + 60, `max standing ${max}`);
});

test("gear changes the boat's spec only by its stated amounts", () => {
  const base = BOATS.kayak;
  assert.deepEqual({ ...gearedSpec(base, new Set()), hullWear: undefined }, { ...base, hullWear: undefined });
  const all = gearedSpec(base, new Set(GEAR.map((x) => x.id)));
  assert.ok(Math.abs(all.stroke / base.stroke - 1.08) < 1e-9);
  assert.ok(Math.abs(all.stability / base.stability - 1.15) < 1e-9);
  assert.equal(all.hullWear, 0.7);
  assert.equal(all.top, base.top);
});

test("buying gear needs the rank and the pay", () => {
  const g = fakeGame();
  g.journal.pay = 1000;
  assert.equal(g.progress.buy("patch-kit"), false);            // a Greenhorn can't
  assert.match(g.log.toasts.at(-1), /Deckhand/);
  for (const id of ["fork", "lodge", "lookout", "dock", "isle", "bridge", "arch"]) g.journal.found.add(id);
  ["first-rapid", "swim"].forEach((f) => g.journal.feats.add(f));
  assert.equal(g.progress.rank(), 1);
  g.journal.pay = 10;
  assert.equal(g.progress.buy("patch-kit"), false);
  g.journal.pay = 45;
  assert.equal(g.progress.buy("patch-kit"), true);
  assert.equal(g.journal.pay, 5);
  assert.equal(g.progress.buy("patch-kit"), false);            // once
  assert.equal(g.boat.spec.hullWear, 0.7);
});

test("river finds rest on the water, in calm-ish places, the same way every time", () => {
  const small = generateWorld(1, "small");
  const a = placeFinds(small), b = placeFinds(small);
  assert.equal(a.length, FINDS.length);
  assert.deepEqual(a.map((f) => [f.x, f.z]), b.map((f) => [f.x, f.z]));
  for (const f of a) {
    assert.ok(!Number.isNaN(waterAt(small, f.x, f.z)), `${f.id} is not on water`);
    assert.ok(f.x > 0 && f.z > 0 && f.x < small.size && f.z < small.size);
  }
  // Spread out: no two finds within 60 m.
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) > 60, `${a[i].id} near ${a[j].id}`);
});

test("paddling past a find picks it up once", () => {
  const g = fakeGame();
  const f = placeFinds(world)[0];
  g.boat.x = f.x + 3; g.boat.z = f.z;
  g.progress.tick(0.1);
  assert.ok(g.progress.finds.has(f.id));
  assert.equal(g.journal.pay, 10);
  g.progress.tick(0.1);
  assert.equal(g.journal.pay, 10);
});

test("Wren's letters: each chapter is claimable, in order, with a card and pay", () => {
  const g = fakeGame();
  g.progress.check();                 // nothing yet
  assert.equal(g.log.cards.length, 0);
  g.journal.feats.add("first-rapid");
  g.progress.check();
  assert.ok(g.progress.claimed.has("first-water"));
  assert.equal(g.log.cards.length, 1);
  assert.match(g.log.cards[0], /The Fork/);
  assert.match(g.log.cards[0], /A new letter: Deliver a load/);
  for (const c of CHAPTERS) { assert.ok(c.goal && c.letter && c.reward > 0); for (const t of c.targets) assert.ok([...places.camps, ...places.landmarks].some((p) => p.id === t), t); }
});

test("what next always has something, and points at the story", () => {
  const base = { pay: 0, rank: 0, points: 0, owned: new Set(["raft"]), gear: new Set(), claimed: new Set(), job: null, found: new Set(), feats: new Set() };
  const n = nextGoals(base);
  assert.ok(n.length >= 2 && n.length <= 3);
  assert.equal(n[0].kind, "story");
  assert.match(n[0].text, /run any rapid/i);
  const rich = nextGoals({ ...base, pay: 70, job: "seed bags → Saltmouth · 900 m" });
  assert.equal(rich[0].kind, "job");
  assert.ok(rich.some((x) => x.kind === "buy" && /kayak/.test(x.text)));
  const done = nextGoals({ ...base, claimed: new Set(CHAPTERS.map((c) => c.id)), rank: RANKS.length - 1, owned: new Set(["raft", "kayak", "canoe", "dory"]), gear: new Set(GEAR.map((x) => x.id)) });
  assert.ok(done.length >= 1);
});

test("job boards: 0.1.0's three deliveries for a Greenhorn, more kinds as you rise", () => {
  const g = fakeGame();
  const camp = places.camps[0];
  const b0 = g.jobs.board(camp);
  assert.equal(b0.length, 3);
  assert.ok(b0.every((j) => j.kind === "delivery" && !j.label));
  g.progress.rank = () => 3;
  const kinds = new Set();
  for (let day = 0; day < 12; day++) { g.dayCount = day; const b = g.jobs.board(camp); assert.equal(b.length, 4); b.forEach((j) => kinds.add(j.kind)); }
  for (const k of ["delivery", "rush", "passenger", "survey"]) assert.ok(kinds.has(k), `no ${k} in 12 days`);
});

test("a passenger needs room, likes a clean line and pays by mood; a survey has two legs", () => {
  const g = fakeGame();
  g.progress.rank = () => 3;
  let passenger, survey;
  for (let day = 0; day < 20 && !(passenger && survey); day++) {
    g.dayCount = day;
    for (const c of places.camps) for (const j of g.jobs.board(c)) { if (j.kind === "passenger" && !passenger) passenger = j; if (j.kind === "survey" && !survey) survey = j; }
  }
  g.dayCount = 0;
  g.boat = makeBoat("kayak", 0, 0, 0);
  assert.equal(g.jobs.take(passenger), false);
  g.boat = makeBoat("raft", 0, 0, 0);
  assert.equal(g.jobs.take(passenger), true);
  g.jobs.onRapid({}, { miss: 0, perfect: 3, good: 1 });
  assert.ok(g.jobs.active.mood > 1);
  g.jobs.onFlip();
  assert.ok(g.jobs.active.mood < 0.8);
  const d = g.jobs.dest();
  g.boat.x = d.x; g.boat.z = d.z;
  const before = g.journal.pay;
  g.jobs.tick();
  assert.equal(g.jobs.active, null);
  assert.ok(g.journal.pay - before < passenger.pay, "a soaked passenger tips less");
  assert.ok(!g.journal.feats.has("passenger"));

  assert.equal(g.jobs.take(survey), true);
  const sight = g.jobs.dest();
  assert.equal(sight.id, survey.to);
  g.boat.x = sight.x; g.boat.z = sight.z;
  g.jobs.tick();
  assert.equal(g.jobs.active.stage, "back");
  const home = g.jobs.dest();
  assert.equal(home.id, survey.from);
  g.boat.x = home.x; g.boat.z = home.z;
  g.jobs.tick();
  assert.equal(g.jobs.active, null);
  assert.ok(g.journal.feats.has("survey"));
});

test("dry bags save a fragile load from a swim", () => {
  const g = fakeGame();
  g.jobs.active = { kind: "delivery", to: "lodge", toName: "Brightwater Lodge", good: "eggs", fragile: true, pay: 50, value: 50, dueClock: 1 };
  g.progress.gear.add("dry-bags");
  g.jobs.onHit(0.2);
  assert.equal(g.jobs.active.value, 47);
  g.jobs.onFlip();
  assert.ok(g.jobs.active.value > 20);
});

test("feat ids are unique and every feat has an icon name", () => {
  const ids = FEATS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of FEATS) assert.ok(f.icon && f.name && f.text);
  // 0.1.0's ids are still here (they are saved).
  for (const id of ["first-rapid", "clean-line", "throat", "falls", "swim", "flow", "night", "camps", "landmarks", "courier", "gold", "sea"]) assert.ok(ids.includes(id));
});

test("boards never send you upstream to a camp you haven't found", () => {
  const g = fakeGame();
  g.progress.rank = () => 3;
  const byId = Object.fromEntries([...places.camps, ...places.landmarks].map((p) => [p.id, p]));
  for (let day = 0; day < 15; day++) {
    g.dayCount = day;
    for (const c of places.camps) for (const j of g.jobs.board(c)) {
      const to = byId[j.to];
      const lowest = places.camps.filter((x) => x !== c).sort((a, b) => a.level - b.level)[0];
      assert.ok(to.level <= c.level + 4 || to === lowest, `${c.id} → ${j.to} on day ${day} is upstream and unknown`);
    }
  }
  // Once Tarn Hut is found, it's fair game.
  g.journal.found.add("tarn");
  let seen = false;
  for (let day = 0; day < 30 && !seen; day++) { g.dayCount = day; seen = g.jobs.board(places.camps[0]).some((j) => j.to === "tarn"); }
  assert.ok(seen);
});

test("the shuttle takes half a job's pay, and goes where Wren's letter sends you", () => {
  const g = fakeGame();
  g.jobs.active = { kind: "delivery", to: "lodge", toName: "Brightwater Lodge", good: "rope", upstream: true, fragile: false, pay: 80, value: 80, dueClock: 1 };
  g.jobs.onShuttle();
  g.jobs.onShuttle();                  // once per job
  assert.equal(g.jobs.active.value, 40);
  const lodge = places.camps.find((c) => c.id === "lodge");
  g.boat.x = lodge.x; g.boat.z = lodge.z;
  g.jobs.tick();
  assert.ok(!g.journal.feats.has("uphill"), "a shuttled load wasn't paddled upstream");
  assert.equal(g.progress.shuttleOK("lodge"), false);
  g.progress.claimed = new Set(["first-water", "honest-work"]);
  assert.equal(g.progress.shuttleOK("lodge"), true);
  g.progress.claimed = new Set(CHAPTERS.slice(0, 7).map((c) => c.id));
  assert.equal(currentChapter(g.progress.claimed).id, "tarn");
  assert.equal(g.progress.shuttleOK("tarn"), true);
});

test("any 0.1.0 save with fields missing still loads", () => {
  const keys = Object.keys(SAVE_010).filter((k) => k !== "boat" && k !== "pos");
  for (const k of keys) {
    const g = fakeGame(), d = JSON.parse(JSON.stringify(SAVE_010));
    delete d[k];
    assert.doesNotThrow(() => { load(g, d); g.progress.check(); g.progress.tick(0.6); g.save.data(); }, `without ${k}`);
  }
  const g = fakeGame();
  assert.doesNotThrow(() => { g.save.apply({}); g.journal.restore(undefined); g.progress.check(); });
  // A job saved mid-survey or with a passenger round-trips.
  const h = fakeGame();
  h.jobs.restore({ active: { kind: "survey", stage: "back", from: "fork", fromName: "Meadow Fork", to: "arch", toName: "Stone Arch", toKind: "landmark", good: "a sketch", pay: 60, value: 60, dueClock: 2 } });
  assert.equal(h.jobs.dest().id, "fork");
  h.jobs.restore({ active: "garbage" });
  assert.equal(h.jobs.dest().id, "fork", "garbage doesn't replace a job");
});

test("a new player gets Wren's first letter once, a few seconds in", () => {
  const g = fakeGame();
  g.time = 2; g.progress.tick(0.1);
  assert.equal(g.log.cards.length, 0);
  g.time = 7; g.progress.tick(0.1); g.progress.tick(0.1);
  assert.equal(g.log.cards.filter((c) => /A letter at Meadow Fork/.test(c)).length, 1);
});

test("gear stays sane on every boat: capped stats, top speed untouched", () => {
  const all = new Set(GEAR.map((x) => x.id));
  for (const [k, base] of Object.entries(BOATS)) {
    const sp = gearedSpec(base, all);
    assert.ok(sp.stroke <= GEAR_CAPS.stroke && sp.stroke >= base.stroke, `${k} stroke ${sp.stroke}`);
    assert.ok(sp.stability <= Math.max(base.stability, GEAR_CAPS.stability) && sp.stability >= base.stability, `${k} stability ${sp.stability}`);
    assert.equal(sp.top, base.top);
    assert.equal(sp.turn, base.turn);
    assert.equal(sp.beam, base.beam);
  }
  assert.equal(gearedSpec(BOATS.dory, all).stability, GEAR_CAPS.stability);
});

test("on the lake, the Long Paddle gets you up to speed a little sooner, never past top speed", () => {
  const L = world.lake;
  const run = (gear) => {
    const b = makeBoat("kayak", L.cx, L.cz, 0);
    b.spec = gearedSpec(BOATS.kayak, gear);
    b.y = L.level;
    let early = 0, peak = 0;
    for (let i = 0; i < 60 * 20; i++) {
      if (i % 30 === 0) stroke(b, "forward", 1.35, i / 60);
      stepBoat(world, b, 1 / 60, null);
      const v = Math.hypot(b.vx, b.vz);
      if (i === 75) early = v;
      peak = Math.max(peak, v);
    }
    return { early, peak };
  };
  const plain = run(new Set()), geared = run(new Set(["long-paddle"]));
  assert.ok(geared.early > plain.early, "stronger early");
  assert.ok(geared.early / plain.early < 1.12, `early ratio ${geared.early / plain.early}`);
  assert.ok(geared.peak <= BOATS.kayak.top + 0.6, `peak ${geared.peak}`);
});

test("Saltmouth Light: opens after Wren's second letter (or a visit), funds in order, saves, and old saves default to 0", () => {
  const g = fakeGame();
  g.journal.pay = 2000;
  assert.equal(g.progress.fund(), false);              // Wren hasn't asked yet
  g.progress.claimed = new Set(["first-water", "honest-work"]);
  let spent = 0;
  for (const L of LIGHT) { assert.equal(g.progress.fund(), true); spent += L.price; }
  assert.equal(g.progress.fund(), false);              // all done
  assert.equal(g.progress.light, LIGHT.length);
  assert.equal(g.journal.pay, 2000 - spent + 25);   // + the Lightkeeper feat
  assert.ok(g.journal.feats.has("lightkeeper"));
  assert.equal(JSON.parse(JSON.stringify(g.save.data())).progress.light, LIGHT.length);
  assert.equal(normalize({ gear: [] }).light, 0);
  assert.equal(normalize({ light: 99 }).light, LIGHT.length);
  assert.equal(normalize({ light: -3 }).light, 0);
  assert.equal(normalize(undefined).light, 0);
  // It shows up in "what next" once your own kit is bought.
  const n = nextGoals({ pay: 500, rank: 5, points: 999, owned: new Set(["raft", "kayak", "canoe", "dory"]), gear: new Set(GEAR.map((x) => x.id)), claimed: new Set(), found: new Set(["lighthouse"]), light: 1, job: null });
  assert.ok(n.some((x) => /Signal Flags for Saltmouth Light/.test(x.text)), JSON.stringify(n));
  // Drawing doesn't throw (and draws something near the light).
  const l = places.landmarks.find((q) => q.id === "lighthouse");
  g.boat.x = l.x + 20; g.boat.z = l.z; g.night = 1;
  const rows = () => { const a = []; return { push: (...v) => a.push(...v), a }; };
  const R = { items: rows(), points: rows(), lines: rows(), lights: rows() };
  g.progress.drawLight(R);
  assert.ok(R.items.a.length > 0 && R.lines.a.length > 0 && R.points.a.length > 0);
});

test("Wren's errand: boards carry a parcel to her next stop, and it moves the story on", () => {
  const g = fakeGame();
  g.progress.claimed = new Set(["first-water", "honest-work", "brightwater"]);   // next: Gorge Lookout
  const fork = places.camps.find((c) => c.id === "fork");
  const board = g.jobs.board(fork);
  const w = board.find((j) => j.errand);
  assert.ok(w, JSON.stringify(board.map((j) => j.label || j.good)));
  assert.equal(w.to, "lookout");
  assert.ok(w.pay > 0 && w.hours >= 4);
  g.jobs.take(w);
  const lookout = places.camps.find((c) => c.id === "lookout");
  g.boat.x = lookout.x; g.boat.z = lookout.z;
  g.journal.discover(lookout);
  g.jobs.tick();
  assert.equal(g.jobs.active, null);
  g.progress.check();
  assert.ok(g.progress.claimed.has("gorge"));
  // No errand above the High Falls, and none once the stop is found.
  g.progress.claimed = new Set(CHAPTERS.slice(0, 7).map((c) => c.id));   // next: Tarn
  assert.equal(g.progress.errandTarget(fork), null);
});

test("the story line suggests the shuttle when a found camp is much nearer Wren's stop", () => {
  const g = fakeGame();
  const by = (id) => places.camps.find((c) => c.id === id);
  g.progress.claimed = new Set(CHAPTERS.slice(0, 5).map((c) => c.id));   // next: the Coldwater
  for (const id of ["fork", "lookout", "dock"]) g.journal.found.add(id);
  const tarn = by("tarn"); g.boat.x = tarn.x; g.boat.z = tarn.z;        // far away
  const story = g.progress.goals().find((x) => x.kind === "story");
  assert.match(story.text, /shuttle/i, story.text);
});

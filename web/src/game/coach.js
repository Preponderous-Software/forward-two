// The coach: a player's first five minutes, then a nudge whenever the river
// goes quiet.
//
// A new player is walked through a short run that the world already lays
// out below Meadow Fork: stroke, steer, ride the current to the next thing
// downstream (the Sunken Bridge), run the first rapid on the guide's calls
// (with wider timing windows, once), then go ashore at a camp. Every step
// finishes itself from what the player does; nothing blocks or pauses.
//
// After that, if the boat sits still or nothing new turns up for a while, a
// hint names the next place downstream with an arrow and a distance.
//
// The step logic (Coach.step) reads a plain snapshot so tests drive it
// without a DOM; mount() and tick() wire it to the game.
import { riverAt } from "../world/terrain.js";

const KEY = "f2.coach.v1";
export const STEPS = ["paddle", "turn", "explore", "ashore", "done"];
export const FIRST_RAPID_LENIENCY = 1.4;
export const IDLE_HINT = 25;        // seconds sitting still before a hint
export const QUIET_HINT = 150;      // seconds with nothing new before a hint
export const HINT_COOLDOWN = 60;
export const CAMP_NEAR_AHEAD = 700;  // metres: after the first rapid, a camp further than this is not worth the detour

// Bearing of (tx, tz) from (x, z), relative to a camera looking along yaw
// (StrataKit's orbit: the eye sits at +cos/sin(yaw), so forward is -cos/-sin;
// the view is right-handed, so screen-right is (sin, -cos), checked with
// kit.project in the 0.2.0 feel playtest).
// Radians, clockwise on screen: 0 = straight ahead, +π/2 = to the right.
export function bearing(yaw, x, z, tx, tz) {
  const dx = tx - x, dz = tz - z;
  const fx = -Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = -Math.cos(yaw);
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

// The nearest thing ahead downstream on the boat's river: a place not yet
// found, or a rapid. pois: [{name, river, s, x, z, id?, rapid?}]
export function nextAhead(pois, river, s, found = () => false, min = 25) {
  let best = null;
  for (const p of pois) {
    if (p.river !== river || p.s - s < min) continue;
    if (p.id && found(p.id)) continue;
    if (!best || p.s < best.s) best = p;
  }
  return best;
}

export class Coach {
  constructor(state = "paddle") {
    this.state = STEPS.includes(state) ? state : "paddle";
    this.fresh = this.state !== "done";   // a new player: the first rapid is forgiving
    this.strokes = { forward: 0, back: 0, left: 0, right: 0 };
    this.rapidsRun = 0;
    this.idle = 0; this.quiet = 0; this.cool = 0;
    this.hint = null;          // {text, target, t}
    this.rapidTip = false;
  }

  // One step of the coach's logic. snap: {stroke?: kind, moved, inRapid,
  // leftRapid, hits, walking, speed, found (bool: something new found),
  // panel (a panel is open)}. Returns what to show: {text, target?} or null.
  step(snap, dt) {
    if (snap.stroke) this.strokes[snap.stroke]++;
    if (snap.leftRapid) this.rapidsRun++;
    this.rapidTip = !!snap.inRapid && this.rapidsRun === 0 && (snap.hits || 0) < 3;
    const S = this.state;
    if (S === "paddle" && (this.strokes.forward >= 3 || snap.moved > 30)) this.state = "turn";
    if (this.state === "turn" && this.strokes.left + this.strokes.right >= 3) this.state = "explore";
    // After the first rapid: go ashore at the next camp, if one is close downstream.
    if (this.state === "explore" && this.rapidsRun > 0) this.state = (snap.campAhead ?? Infinity) <= CAMP_NEAR_AHEAD ? "ashore" : "done";
    if (this.state !== "done" && this.state !== "paddle" && snap.walking) this.state = "done";
    // Hints once the tutorial is over.
    if (this.state === "done") {
      this.cool = Math.max(0, this.cool - dt);
      const still = snap.speed < 0.4 && !snap.walking && !snap.inRapid && !snap.panel;
      this.idle = still ? this.idle + dt : 0;
      this.quiet = snap.found || snap.inRapid ? 0 : this.quiet + dt;
      if (this.hint) { this.hint.t -= dt; if (this.hint.t <= 0 || snap.walking || snap.inRapid) this.hint = null; }
      if (!this.hint && this.cool <= 0 && (this.idle > IDLE_HINT || this.quiet > QUIET_HINT)) {
        this.hint = { t: 9 }; this.cool = HINT_COOLDOWN + 9; this.idle = 0; this.quiet = 0;
      }
    }
    return this.state;
  }

  // Leniency for the guide while the coach is still teaching the first rapid.
  leniency() { return this.fresh && this.rapidsRun === 0 ? FIRST_RAPID_LENIENCY : 1; }

  // The line to show for a step. touch: phone wording.
  static text(step, touch, target) {
    const to = target ? target.name : "the next bend";
    switch (step) {
      case "paddle": return touch ? "Tap <b>▲</b> to stroke forward. Hold it to keep paddling." : "Press <kbd>W</kbd> to stroke forward. Hold it to keep paddling.";
      case "turn": return touch ? "<b>◀</b> <b>▶</b> turn the bow. Try both." : "<kbd>A</kbd> and <kbd>D</kbd> turn the bow. Try both.";
      case "explore": return `Ride the current downstream to <b>${to}</b>.`;
      case "rapid": return touch ? "Whitewater! Tap the button the guide calls as its marker reaches the gate." : "Whitewater! Press the key the guide calls as its marker reaches the gate.";
      case "camp": return touch ? `You're at <b>${to}</b>. Tap <b>Go ashore</b> to look around.` : `You're at <b>${to}</b>. Press <kbd>E</kbd> to go ashore and look around.`;
      case "ashore": return touch ? `Through! Paddle to <b>${to}</b> and tap <b>Go ashore</b>.` : `Through! Paddle to <b>${to}</b> and press <kbd>E</kbd> to go ashore.`;
      case "hint": return `Next downstream: <b>${to}</b>.`;
      case "swim": return touch ? "Swimmer! Tap <b>▲</b> on the guide's calls to climb back in." : "Swimmer! Press <kbd>W</kbd> on the guide's calls to climb back in.";
      default: return "";
    }
  }
}

// The coach wired to the game: its banner, the arrow, saving progress.
export class GameCoach {
  constructor(game, root) {
    this.game = game;
    const p = game.params, force = p.get("coach");
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* blocked */ }
    // Returning players (a save, or the coach finished before) get hints only.
    const start = force === "1" ? "paddle" : force === "0" || saved === "done" || game.save?.load() ? "done" : "paddle";
    this.coach = new Coach(start);
    this.off = force === "0";
    this.el = document.createElement("div");
    this.el.className = "coach"; this.el.id = "h-coach";
    this.el.setAttribute("role", "status");
    this.el.innerHTML = `<svg class="coach-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l6 9h-4v9h-4v-9H6z"/></svg><span class="coach-text"></span><span class="coach-dist"></span>`;
    root.appendChild(this.el);
    this.$text = this.el.querySelector(".coach-text"); this.$dist = this.el.querySelector(".coach-dist"); this.$arrow = this.el.querySelector(".coach-arrow");
    this.lastStroke = -1; this.wasRapid = false; this.foundCount = -1; this.start = null; this.html = null;
  }

  // Everything worth steering toward, with its place along a river (once).
  pois() {
    if (this._pois) return this._pois;
    const g = this.game, w = g.world, out = [];
    const add = (p, extra) => { const h = riverAt(w, p.x, p.z); if (h) out.push({ name: p.name, id: p.id, x: p.x, z: p.z, river: h.sample.river, s: h.sample.s, ...extra }); };
    for (const c of g.places?.camps || []) add(c, { camp: true });
    for (const l of g.places?.landmarks || []) add(l, {});
    for (const r of g.rapids || []) {
      const S = w.rivers[r.river].samples, p = S.find((q) => q.s >= r.s0) || S[0];
      out.push({ name: r.name, x: p.x, z: p.z, river: r.river, s: r.s0, rapid: true });
    }
    return (this._pois = out);
  }

  target(campOnly = false) {
    const g = this.game, b = g.pos(), hit = g.boat.current?.hit;
    const found = (id) => g.journal?.has(id) || false;
    const pois = campOnly ? this.pois().filter((p) => p.camp) : this.pois();
    if (hit) {
      const t = nextAhead(pois, hit.sample.river, hit.sample.s, campOnly ? () => false : found);
      if (t) return t;
    }
    // Off the rivers (the lake, the sea): the nearest unfound place.
    let best = null, bd = Infinity;
    for (const p of pois) {
      if (p.rapid || (!campOnly && found(p.id))) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d > 30 && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  tick(dt) {
    const g = this.game, b = g.boat, c = this.coach;
    if (this.off) return;
    if (!this.start) { this.start = { x: b.x, z: b.z }; this.home = g.places?.campNear?.(b.x, b.z, 60) || null; }
    const stroke = b.lastStroke !== this.lastStroke && b.lastStroke >= 0 ? b.stroke : null;
    this.lastStroke = b.lastStroke;
    const inRapid = !!g.caller.rapid, leftRapid = this.wasRapid && !inRapid && !b.swimming;
    this.wasRapid = inRapid;
    const fc = g.journal?.found.size ?? 0, found = this.foundCount >= 0 && fc > this.foundCount;
    this.foundCount = fc;
    const before = c.state;
    const st = c.step({
      stroke, moved: Math.hypot(b.x - this.start.x, b.z - this.start.z), inRapid, leftRapid,
      hits: g.caller.stats.perfect + g.caller.stats.good + (g.caller.stats.drive || 0), walking: !!g.walker?.active,
      speed: Math.hypot(b.vx, b.vz), found, panel: g.hud.anyOpen(),
      campAhead: leftRapid ? this.campAheadDist() : undefined,
    }, dt);
    g.caller.leniency = c.leniency();
    if (st === "done" && before !== "done") {
      try { localStorage.setItem(KEY, "done"); } catch { /* blocked */ }
      g.hud.toast(g.input.touch ? "That's the river. The map and journal (top right) show where to go next." : "That's the river. M for the map, J for the journal: they show where to go next.", 6);
    }
  }

  // Metres along the river to the next camp downstream (Infinity if none).
  campAheadDist() {
    const hit = this.game.boat.current?.hit;
    if (!hit) return Infinity;
    const t = nextAhead(this.pois().filter((p) => p.camp), hit.sample.river, hit.sample.s, () => false, 0);
    return t ? t.s - hit.sample.s : Infinity;
  }

  // Called from the HUD's frame: the banner and its arrow.
  draw() {
    if (this.off) return;
    const g = this.game, c = this.coach, touch = g.input.touch;
    let step = c.rapidTip ? "rapid" : c.state, target = null;
    if (g.boat.swimming && g.boat.flips <= 2) step = "swim";   // the first swims, say how to get back in
    // Passing a camp while exploring: suggest going ashore there.
    const near = g.places?.near;
    if (step === "explore" && near && near !== this.home && !g.walker?.active) { step = "camp"; target = near; }
    else if (step === "explore" || step === "ashore") target = this.target(step === "ashore");
    if (step === "done") { step = c.hint ? "hint" : null; if (step) target = c.hint.target || (c.hint.target = this.target()); if (step && !target) step = null; }
    const hide = !step || g.hud.anyOpen() || (g.walker?.active && step !== "hint");
    const html = hide ? "" : Coach.text(step, touch, target);
    if (html !== this.html) { this.html = html; this.$text.innerHTML = html; this.el.classList.toggle("on", !!html); this.el.classList.toggle("tip", step === "rapid"); }
    const showArrow = !hide && !!target;
    this.$arrow.style.display = showArrow ? "" : "none";
    if (showArrow) {
      const p = g.pos(), cam = g.kit.cam;
      const a = bearing(cam.yaw, p.x, p.z, target.x, target.z);
      this.$arrow.style.transform = `rotate(${a.toFixed(2)}rad)`;
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      const dt = d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
      if (dt !== this.distText) { this.distText = dt; this.$dist.textContent = dt; }
    } else if (this.distText) { this.distText = ""; this.$dist.textContent = ""; }
  }
}

import { generateWorld } from "/root/wt/forward-two-feel/web/src/world/terrain.js";
import { makeBoat, stepBoat, stroke, featureIndex, dodge } from "/root/wt/forward-two-feel/web/src/sim/boat.js";
import { buildFeatures, buildRapids, Caller, HIT } from "/root/wt/forward-two-feel/web/src/sim/rapids.js";
const w = generateWorld(1, "small");
const name = process.argv[2] || "Gorge Gate", botMode = process.argv[3] || "perfect", useDodge = process.argv[4] !== "nododge";
const F = buildFeatures(w), R = buildRapids(w), idx = featureIndex(F);
const r = R.find((x) => x.name === name), S = w.rivers[r.river].samples;
const p0 = S.find((q) => q.s >= r.s0 - 40);
const b = makeBoat("raft", p0.x, p0.z, Math.atan2(p0.tz, p0.tx)); b.y = p0.level;
const c = new Caller(F, R); c.leniency = Number(process.argv[5] || 1);
const off = { perfect: 0, early: -0.24, late: 0.24, sloppy: null }[botMode];
let t = 0, pen = 0, flips = 0, rockHits = 0, callMiss = 0, j = {}, entered = false, left = false, gaps = [], lastCall = null;
const penalty = (a) => { b.stability = Math.max(0, b.stability - a / b.spec.stability); pen += a; if (b.stability <= 0 && !b.swimming) { b.swimming = true; flips++; c.startSwim(t); } };
while (t < 200 && !left) {
  t += 1 / 60;
  for (const cl of c.calls) if (!cl._d && botMode !== "none") {
    const o = off ?? (Math.random() - 0.5) * 0.5;
    if (t >= cl.time + o) { cl._d = true; const v = c.judge(cl.call, t); if (v) { j[v.judgment] = (j[v.judgment] || 0) + 1; const pw = v.judgment === "perfect" ? 1.35 : v.judgment === "good" ? 1.15 : 1; if (!b.swimming) stroke(b, cl.call, pw, t); if (useDodge && v.call.feature?.kind === "rock" && HIT.has(v.judgment)) dodge(b, v.call.feature, v.call.call); } break; }
  }
  const ev = stepBoat(w, b, 1 / 60, idx);
  for (const e of ev) { if (e.type === "rock") { rockHits++; penalty(Math.min(0.35, e.speed * 0.1)); } if (e.type === "bank") penalty(Math.min(0.25, (e.speed - 1.2) * 0.08)); }
  for (const e of c.update(t, b)) {
    if (e.type === "enter") entered = true;
    if (e.type === "leave" && entered) { left = true; console.log("stats", JSON.stringify(e.stats)); }
    if (e.type === "call") { if (lastCall != null) gaps.push(+(e.time - lastCall).toFixed(2)); lastCall = e.time; }
    if (e.type === "miss" && !e.call.swim && !e.call.fill) { callMiss++; j.miss = (j.miss || 0) + 1; const f = e.call.feature; penalty(f ? 0.1 + f.cls * 0.035 : 0.12); }
  }
  if (Math.abs(t % 10) < 1/60 && process.env.TRACE) { const h = b.current?.hit; console.log("t", t.toFixed(0), "s", h?.sample.s.toFixed(0), "lat", h?.lateral.toFixed(1), "w", h?.sample.width.toFixed(1), "sp", Math.hypot(b.vx,b.vz).toFixed(1), "cur", b.current?.speed.toFixed(1), "cls", b.current?.cls, "rapid", c.rapid?.name, "bumps", b.bumps); }
  if (b.swimming && c.swim && (c.swim.landed >= 2 || c.swim.misses >= 2)) { b.swimming = false; b.stability = 0.45; c.endSwim(); }
}
console.log(name, botMode, useDodge ? "dodge" : "nododge", "t", t.toFixed(1), "judged", JSON.stringify(j), "rockHits", rockHits, "pen", pen.toFixed(2), "flips", flips, "stab", b.stability.toFixed(2), "speed", Math.hypot(b.vx,b.vz).toFixed(1), "interval", c.interval.toFixed(2), "gaps", gaps.slice(0, 12).join(","));

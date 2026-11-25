import { generateWorld } from "/root/wt/forward-two-feel/web/src/world/terrain.js";
import { makeBoat, stepBoat, stroke, featureIndex, dodge } from "/root/wt/forward-two-feel/web/src/sim/boat.js";
import { buildFeatures } from "/root/wt/forward-two-feel/web/src/sim/rapids.js";
const w = generateWorld(1, "small");
const F = buildFeatures(w);
const rocks = F.filter((f) => f.kind === "rock").slice(0, 60);
let res = { dodge: { hit: 0, miss: 0, minD: 0, clear: 0 }, called: { hit: 0, miss: 0, minD: 0 }, opposite: { hit: 0, miss: 0, minD: 0 }, none: { hit: 0, miss: 0, minD: 0 } };
for (const r of rocks) {
  const S = w.rivers[r.river].samples;
  const p0 = S.find((q) => q.s >= r.s - 12);
  for (const mode of ["called", "opposite", "none", "dodge"]) {
    const idx = featureIndex(F.map((f) => ({ ...f, cleared: true })));
    // start in line with the rock, 12 m upstream, travelling with the current
    const sx = p0.x - p0.tz * r.lateral, sz = p0.z + p0.tx * r.lateral;
    const b = makeBoat("raft", sx, sz, Math.atan2(p0.tz, p0.tx)); b.y = p0.level; b.vx = p0.tx * 3; b.vz = p0.tz * 3;
    let hit = false, minD = 1e9;
    const kind = mode === "called" || mode === "dodge" ? r.call : mode === "opposite" ? (r.call === "left" ? "right" : "left") : null;
    for (let i = 0; i < 360; i++) {
      // Stroke on the beat, ~1.2 s and 0.6 s before reaching it (two strokes)
      if (kind && i === 50) { stroke(b, kind, 1.15, i / 60); if (mode === "dodge") { b.current = b.current || null; dodge(b, r); } }
      const ev = stepBoat(w, b, 1 / 60, idx);
      if (ev.some((e) => e.type === "rock")) hit = true;
      minD = Math.min(minD, Math.hypot(b.x - r.x, b.z - r.z) - r.r);
    }
    res[mode][hit ? "hit" : "miss"]++; res[mode].minD += minD / rocks.length; if (minD > 1.0) res[mode].clear = (res[mode].clear||0) + 1;
  }
}
console.log(JSON.stringify(res));

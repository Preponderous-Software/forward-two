// Ad-hoc: content's gearedSpec (copied, read-only source ~/wt/forward-two-content/web/src/game/progress.js) on my sim.
import { generateWorld } from "/root/wt/forward-two-feel/web/src/world/terrain.js";
import { buildFeatures } from "/root/wt/forward-two-feel/web/src/sim/rapids.js";
import { makeBoat, stroke, stepBoat, dodge, featureIndex, BOATS } from "/root/wt/forward-two-feel/web/src/sim/boat.js";
const CAPS = { stroke: 1.7, stability: 1.4 };
const geared = (base) => ({ ...base, stroke: Math.min(CAPS.stroke, base.stroke * 1.08), stability: Math.max(base.stability, Math.min(CAPS.stability, base.stability * 1.15)), hullWear: 0.7 });
const w = generateWorld(1, "small"), all = buildFeatures(w), rocks = all.filter((f) => f.kind === "rock").slice(0, 40);
for (const kind of Object.keys(BOATS)) for (const gear of [false, true]) {
  // steering sign
  const p = w.rivers[0].samples[300];
  const b0 = makeBoat(kind, p.x, p.z, Math.atan2(p.tz, p.tx)); if (gear) b0.spec = geared(b0.spec);
  const h0 = b0.heading; stroke(b0, "left"); for (let i = 0; i < 30; i++) stepBoat(w, b0, 1 / 60);
  let clear = 0, maxLat = 0;
  for (const r of rocks) {
    const S = w.rivers[r.river].samples, q = S.find((x) => x.s >= r.s - 12);
    const idx = featureIndex(all.map((f) => ({ ...f, cleared: true })));
    const b = makeBoat(kind, q.x - q.tz * r.lateral, q.z + q.tx * r.lateral, Math.atan2(q.tz, q.tx)); if (gear) b.spec = geared(b.spec);
    b.y = q.level; b.vx = q.tx * 3; b.vz = q.tz * 3;
    let minD = Infinity;
    for (let i = 0; i < 360; i++) { if (i === 50) { stroke(b, r.call, 1.35); dodge(b, r, r.call); } stepBoat(w, b, 1 / 60, idx); minD = Math.min(minD, Math.hypot(b.x - r.x, b.z - r.z) - r.r); }
    if (minD > b.spec.beam / 2) clear++;
  }
  console.log(kind.padEnd(6), gear ? "geared" : "stock ", "left turns heading by", (b0.heading - h0).toFixed(3), "rocks cleared", `${clear}/${rocks.length}`);
}

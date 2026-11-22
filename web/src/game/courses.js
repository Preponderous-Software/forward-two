// Race courses: which stretch of which river, their buoyed gates, and medal
// times. Pure (no DOM, no engine): the game builds its races from it and the
// relay (server/) rebuilds the same gates from the same seed to check that a
// submitted ghost really ran them.

// river, start fraction, end fraction, gate spacing (m), gold-medal pace (m/s)
export const COURSES = [
  { id: "meadow-sprint", name: "Meadow Sprint", river: "long", f0: 0.345, f1: 0.47, gap: 55, ref: 2.6 },
  { id: "bright-chutes", name: "Brightwater Chutes", river: "bright", f0: 0.12, f1: 0.62, gap: 45, ref: 3.2 },
  { id: "throat-run", name: "Throat Run", river: "long", f0: 0.5, f1: 0.66, gap: 40, ref: 3.9 },
  { id: "coldwater", name: "Coldwater Run", river: "cold", f0: 0.3, f1: 0.75, gap: 60, ref: 3.0 },
  { id: "ferry-dash", name: "Ferry Dash", river: "long", f0: 0.73, f1: 0.86, gap: 50, ref: 3.3 },
  { id: "descent", name: "The Descent", river: "long", f0: 0.012, f1: 0.985, gap: 120, ref: 2.9 },
];

// The courses on a set of rivers (world.rivers or buildSkeleton(seed).rivers).
export function buildCourses(rivers) {
  return COURSES.map((def) => {
    const r = rivers.find((x) => x.id === def.river), S = r.samples;
    const i0 = Math.round(def.f0 * (S.length - 1)), i1 = Math.round(def.f1 * (S.length - 1));
    const gates = [];
    let next = S[i0].s;
    for (let i = i0; i <= i1; i++) {
      const p = S[i];
      if (p.s >= next || i === i1) { gates.push({ x: p.x, z: p.z, y: p.level, tx: p.tx, tz: p.tz, half: p.width / 2 + 1, s: p.s }); next = p.s + def.gap; }
    }
    const length = S[i1].s - S[i0].s;
    const gold = length / def.ref, silver = gold * 1.18, bronze = gold * 1.4;
    return { ...def, river: r, gates, length, medals: { gold, silver, bronze } };
  });
}

// Did a move from `prev` to `b` pass through `gate` downstream? `slack` widens it.
export function crossed(gate, b, prev, slack = 1.5) {
  if (!prev) return false;
  const d0 = (prev.x - gate.x) * gate.tx + (prev.z - gate.z) * gate.tz;
  const d1 = (b.x - gate.x) * gate.tx + (b.z - gate.z) * gate.tz;
  if (!(d0 < 0 && d1 >= 0)) return false;
  const t = d0 / (d0 - d1);   // where along the move it crossed the gate's line
  const cx = prev.x + (b.x - prev.x) * t, cz = prev.z + (b.z - prev.z) * t;
  const lat = (cx - gate.x) * -gate.tz + (cz - gate.z) * gate.tx;
  return Math.abs(lat) <= gate.half + slack;
}

// A ghost's samples ([{t, x, z, h}], from decode) against a course: every gate
// after the start, in order. The server uses a wider slack than the game
// because a ghost has one sample per 100 ms.
export function checkCourseRun(course, samples, slack = 4) {
  if (!course) return { ok: false, reason: "unknown course" };
  if (!Array.isArray(samples) || samples.length < 2) return { ok: false, reason: "too short" };
  let next = 1;
  for (let i = 1; i < samples.length && next < course.gates.length; i++) {
    if (crossed(course.gates[next], samples[i], samples[i - 1], slack)) next++;
  }
  return next >= course.gates.length ? { ok: true } : { ok: false, reason: `missed gate ${next} of ${course.gates.length - 1}` };
}

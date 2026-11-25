// Round 2: a brand-new player's first minutes, with the coach, on a keyboard.
const proj = `(() => { const g = __f2, k = g.kit, b = g.boat, c = k.cam;
  const P = (x, y, z) => { const p = k.project(x, y, z); return p ? [Math.round(p.x ?? p[0]), Math.round(p.y ?? p[1])] : null; };
  const rx = -Math.sin(c.yaw), rz = Math.cos(c.yaw);
  const hl = b.heading + 0.5;  // heading + => after a 'left' stroke
  return { boat: P(b.x, b.y, b.z), walkerRight: P(b.x + rx * 6, b.y, b.z + rz * 6), headingPlus: P(b.x + Math.cos(hl) * 8, b.y, b.z + Math.sin(hl) * 8), headingNow: P(b.x + Math.cos(b.heading) * 8, b.y, b.z + Math.sin(b.heading) * 8) }; })()`;
const rocks = `(() => { const g = __f2, k = g.kit, out = [];
  for (const c of g.caller.calls) { const f = c.feature; if (!f || f.kind !== 'rock') continue; const S = g.world.rivers[f.river].samples; const p = S.find((q) => q.s >= f.s) || S[0];
    const a = k.project(f.x, f.y, f.z), m = k.project(p.x, p.level, p.z); if (a && m) out.push({ call: c.call, lateral: +f.lateral.toFixed(1), rockX: Math.round(a.x ?? a[0]), midX: Math.round(m.x ?? m[0]) }); }
  return out; })()`;
module.exports = { query: '&new=1&coach=1', steps: [
  { js: "document.getElementById('t-go')?.click(); 'go'" },
  { label: 'start', sim: 2, shot: 'r2-01-coach-paddle', page: true },
  { js: "__key('KeyW', true)" }, { label: 'W held', sim: 2.5 }, { js: "__key('KeyW', false)" },
  { js: "__key('KeyA', true)" }, { label: 'A held', sim: 1.3 }, { js: proj, label: 'handedness after left' }, { js: "__key('KeyA', false)" },
  { js: "__key('KeyD', true)" }, { label: 'D', sim: 0.5 }, { js: "__key('KeyD', false)" },
  { label: 'explore', sim: 0.5, shot: 'r2-02-coach-explore', page: true },
  { label: 'pilot to rapid', sim: 240, opts: { pilot: 'down', until: 'g.caller.rapid' } },
  { label: 'in rapid', sim: 1.6, opts: { bot: 'none' } },
  { js: rocks, label: 'rock calls vs screen side' },
  { label: 'rapid lane', frames: 1, shot: 'r2-03-first-rapid', page: true },
  { label: 'run rapid (bot early)', sim: 120, opts: { bot: 'early', until: '!g.caller.rapid' } },
  { label: 'after rapid', sim: 1, shot: 'r2-04-after-rapid', page: true },
  { label: 'pilot to camp', sim: 200, opts: { pilot: 'down', until: "g.places.near && g.places.near.id !== 'fork'" } },
  { js: "__key('KeyE', true); __key('KeyE', false); 'E'" },
  { label: 'ashore', sim: 2, shot: 'r2-05-ashore', page: true },
  { label: 'done', sim: 6 },
]};

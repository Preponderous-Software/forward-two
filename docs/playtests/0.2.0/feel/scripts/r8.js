// Round 8 (wave 2): pan direction after the kit fix; Gorge Lookout above the gorge; the coach's camp nudge.
module.exports = { query: '&new=1&coach=1', steps: [
  { js: "document.getElementById('t-go')?.click(); 'go'" },
  { sim: 0.5 }, { frames: 1 },
  { js: "(() => { const g = __f2, k = g.kit, c = k.cam; const P = [c.tx, c.ty, c.tz]; const a = k.project(...P); k.pan(100, 0); k.drive(window.__T += 1/30); const b = k.project(...P); return { before: Math.round(a.x), after: Math.round(b.x), followsFinger: b.x > a.x }; })()", label: 'pan right 100 px: the scene should move right' },
  { label: 'coach before', sim: 0.2 },
  { js: "__key('KeyW', true)" }, { sim: 2 }, { js: "__key('KeyW', false)" },
  { js: "__key('KeyA', true)" }, { sim: 1.3 }, { js: "__key('KeyA', false)" },
  { label: 'pilot to Gorge Lookout', sim: 200, opts: { pilot: 'down', until: "g.places.near && g.places.near.id === 'lookout' || g.caller.rapid" } },
  { label: 'at lookout', sim: 0.3, shot: 'r8-01-lookout', page: true },
  { js: "({ near: __f2.places.near?.name, rapid: __f2.caller.rapid?.name || null, coach: document.getElementById('h-coach').innerText })", label: 'at the camp' },
]};

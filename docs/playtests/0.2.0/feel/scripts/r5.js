// Round 5: the phone layout after fixes (run portrait and landscape).
const press = (s, down) => `(() => { const b = document.querySelector('.pad button[data-s=${s}]'); b.dispatchEvent(new PointerEvent('${down ? 'pointerdown' : 'pointerup'}', { pointerId: 7, bubbles: true })); const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), innerWidth]; })()`;
const P = process.env.R5TAG || 'p';
module.exports = { query: '&new=1&coach=1', steps: [
  { js: "document.getElementById('t-go')?.click(); 'go'" },
  { js: press('forward', true), label: 'fwd button rect' }, { sim: 1.5 }, { js: press('forward', false) },
  { js: "document.querySelector('.emote-toggle').click(); [...document.querySelectorAll('.pad button')].map((b) => { const r = b.getBoundingClientRect(); return (b.dataset.s || b.dataset.a || 'toggle') + ':' + Math.round(r.left) + '-' + Math.round(r.right) + '/' + Math.round(r.top); }).join(' ')", label: 'pad layout' },
  { label: 'fan', sim: 0.2, shot: `r5${P}-01-signals`, page: true },
  { js: "document.querySelector('.emote-toggle').click(); 'closed'" },
  { js: "(() => { const g = __f2, c = g.places.camps.find((k) => k.id === 'fork'); const b = g.boat; b.x = c.x + c.nx * 8; b.z = c.z + c.nz * 8; return g.places.campNear(b.x, b.z)?.name; })()", label: 'near Meadow Fork' },
  { label: 'camp', sim: 1, shot: `r5${P}-02-camp-prompt`, page: true },
  { js: "document.getElementById('p-camp')?.click(); __f2.walker.active", label: 'ashore' },
  { js: press('back', true) }, { label: 'walk back toward the camera', sim: 3 }, { js: press('back', false) },
  { label: 'ashore', sim: 0.5, shot: `r5${P}-03-ashore`, page: true },
  { js: "({ dist: __f2.kit.cam.dist.toFixed(1) })", label: 'cam dist ashore' },
]};

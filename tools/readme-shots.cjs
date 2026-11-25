// README stills: loads the game once (?drive=1) and saves a set of canvas
// shots to docs/media/. Usage:
//   node tools/readme-shots.cjs <base-url> [outDir=docs/media] [only=name,name]
// e.g. node server/main.js --static web --port 8812 &
//      node tools/readme-shots.cjs "http://127.0.0.1:8812/?world=small"
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = [
  { name: 'river', hour: 18.2, setup: `at('long', 0.43, 0, 0); g.snapCamera();` },
  { name: 'rapids', hour: 11, setup: `const r = g.rapids.find((x) => x.name === 'The Throat'); atS(r.river, r.s0 + 25, 0); g.boat.vx = g.boat.current?.vx || 0; g.snapCamera(); g.kit.cam.pitch = 0.42; g.kit.cam.dist = 19;` },
  { name: 'falls', hour: 9.5, setup: `const l = g.places.landmarks.find((x) => x.id === 'falls'); const S = g.world.rivers[0].samples; const i = S.findIndex((p) => Math.hypot(p.x - l.x, p.z - l.z) < 4); atS(0, S[i].s + 45, 0, Math.PI); fixed((cam) => { cam.tx = l.x; cam.tz = l.z; cam.ty = l.level - 6; cam.dist = 62; cam.pitch = 0.16; cam.yaw = Math.atan2(S[i + 30].z - l.z, S[i + 30].x - l.x); });` },
  { name: 'lake', hour: 7.2, setup: `const L = g.world.lake; const isle = g.places.landmarks.find((x) => x.id === 'isle'); g.boat.x = L.cx + L.R * 0.35; g.boat.z = L.cz + L.R * 0.2; g.boat.y = L.level; g.boat.heading = Math.atan2(isle.z - g.boat.z, isle.x - g.boat.x); g.snapCamera(); g.kit.cam.pitch = 0.22;` },
  { name: 'night-camp', hour: 22.3, setup: `const c = g.places.camps[0]; g.boat.x = c.x + c.nx * 20; g.boat.z = c.z + c.nz * 20; g.boat.heading = Math.atan2(-c.nz, -c.nx) + 0.4; g.snapCamera(); g.kit.cam.dist = 22; g.kit.cam.pitch = 0.3;` },
  { name: 'ashore', hour: 10.5, setup: `const c = g.places.camps[0]; g.walker.disembark(c); g.input.held.set('forward', 9);`, frames: 50, after: `g.input.held.delete('forward');` },
  { name: 'saltmouth', hour: 18.6, setup: `const l = g.places.landmarks.find((x) => x.id === 'lighthouse'); const c = g.places.camps.find((x) => x.id === 'town'); g.boat.x = c.x + c.nx * 30; g.boat.z = c.z + c.nz * 30; fixed((cam) => { cam.tx = l.x * 0.6 + c.x * 0.4; cam.tz = l.z * 0.6 + c.z * 0.4; cam.ty = c.y + 5; cam.dist = 42; cam.pitch = 0.2; cam.yaw = Math.atan2(c.nz, c.nx) + 0.35; });` },
  // 0.2.0: the new boats and crews, a swim, the restored light, a lantern at night (JPEG).
  ...['raft', 'kayak', 'canoe', 'dory'].map((kind, i) => ({ name: `boat-${kind}`, jpg: true, hour: 10.2, frames: 40,
    setup: `const L = g.world.lake; g.boat.x = L.cx - L.R * 0.3; g.boat.z = L.cz + L.R * 0.1; g.boat.y = L.level; g.boat.heading = 0.6; g.setBoat('${kind}'); g.input.held.set('forward', 9);
      fixed((cam) => { const b = g.boat; cam.tx = b.x; cam.tz = b.z; cam.ty = b.y + 0.6; cam.dist = ${[11, 8, 9.5, 10.5][i]}; cam.pitch = 0.3; cam.yaw = b.heading + 2.2; });`,
    after: `g.input.held.delete('forward');` })),
  { name: 'swim', jpg: true, hour: 11, frames: 30, setup: `g.setBoat('raft'); const r = g.rapids.find((x) => x.name === 'The Throat'); atS(r.river, r.s0 + 40, 0); g.flip();
      fixed((cam) => { const b = g.boat; cam.tx = b.x; cam.tz = b.z; cam.ty = b.y; cam.dist = 10; cam.pitch = 0.45; cam.yaw = b.heading + 2.6; });` },
  { name: 'light', jpg: true, hour: 19.2, frames: 30, setup: `g.setBoat('raft'); const l = g.places.landmarks.find((x) => x.id === 'lighthouse'); g.journal.found.add('lighthouse'); g.progress.light = 4; const c = g.places.camps.find((x) => x.id === 'town'); g.boat.x = c.x + c.nx * 30; g.boat.z = c.z + c.nz * 30;
      fixed((cam) => { cam.tx = l.x; cam.tz = l.z; cam.ty = (g.progress.lightGeo?.gy ?? c.y) + 6; cam.dist = 38; cam.pitch = 0.2; cam.yaw = Math.atan2(c.nz, c.nx) + 0.5; });` },
  { name: 'lantern', jpg: true, hour: 22.6, frames: 30, setup: `g.setBoat('canoe'); at('long', 0.43, 0, 0); g.snapCamera(); g.kit.cam.dist = 12; g.kit.cam.pitch = 0.32;` },
];

const PRELUDE = `
  const g = window.__f2;
  g.cameraOverride = null;
  g.input.held.clear?.();
  if (g.walker && g.walker.active) { g.walker.embark(); }
  g.hud.panels.title?.close?.();
  const atS = (ri, s, lat = 0, turn = 0) => {
    const S = g.world.rivers[ri].samples; const p = S.reduce((a, q) => Math.abs(q.s - s) < Math.abs(a.s - s) ? q : a, S[0]);
    g.boat.x = p.x - p.tz * lat; g.boat.z = p.z + p.tx * lat; g.boat.y = p.level; g.boat.heading = Math.atan2(p.tz, p.tx) + turn;
    g.boat.vx = g.boat.vz = 0; g.boat.swimming = false; g.boat.stability = 1;
  };
  const at = (id, f, lat, turn) => { const ri = g.world.rivers.findIndex((r) => r.id === id); atS(ri, g.world.rivers[ri].length * f, lat, turn); };
  const fixed = (fn) => { g.cameraOverride = (cam) => fn(cam); };
`;

(async () => {
  const [base, outDir = 'docs/media', only = ''] = process.argv.slice(2);
  const want = only ? new Set(only.split(',')) : null;
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const url = base + (base.includes('?') ? '&' : '?') + 'drive=1&new=1&nosave=1&skip=1&quality=2';
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit, null, { timeout: 600000, polling: 1000 });
  let t = 0;
  for (const s of SHOTS) {
    if (want && !want.has(s.name)) continue;
    await page.evaluate(`(() => { ${PRELUDE} g.clock = ${s.hour} / 24; ${s.setup} })()`);
    const frames = s.frames || 24;
    t = await page.evaluate(([n, t0]) => { const k = window.__f2.kit; let t = t0; for (let i = 0; i < n; i++) { t += 1 / 30; k.drive(t); } return t; }, [frames, t]);
    if (s.after) await page.evaluate(`(() => { const g = window.__f2; ${s.after} })()`);
    const data = await page.evaluate((jpg) => document.getElementById('view').toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.9), !!s.jpg);
    const file = path.join(outDir, `${s.name}.${s.jpg ? 'jpg' : 'png'}`);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', file);
  }
  if (!want || want.has('map')) {
    // The map: everything found, the lower half explored.
    const data = await page.evaluate(() => {
      const g = window.__f2;
      for (const p of [...g.places.camps, ...g.places.landmarks]) g.journal.found.add(p.id);
      for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) if ((i + j) > 28 || (i > 10 && j > 8)) g.journal.explored[j * 64 + i] = 1;
      g.hud.action('map');
      const c = document.querySelector('.mapwrap canvas');
      return c.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(outDir, 'map.png'), Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', path.join(outDir, 'map.png'));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

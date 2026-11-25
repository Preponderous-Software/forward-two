// Boat close-ups: node boat-shots.cjs <base-url> <outDir> [prefix]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const KINDS = ['raft', 'kayak', 'canoe', 'dory'];
const PRELUDE = `
  const g = window.__f2;
  g.cameraOverride = null;
  if (g.walker && g.walker.active) { g.walker.embark(); }
  g.hud.panels.title?.close?.();
  const atS = (ri, s, lat = 0, turn = 0) => {
    const S = g.world.rivers[ri].samples; const p = S.reduce((a, q) => Math.abs(q.s - s) < Math.abs(a.s - s) ? q : a, S[0]);
    g.boat.x = p.x - p.tz * lat; g.boat.z = p.z + p.tx * lat; g.boat.y = p.level; g.boat.heading = Math.atan2(p.tz, p.tx) + turn;
    g.boat.vx = g.boat.vz = 0; g.boat.spin = 0; g.boat.swimming = false; g.boat.stability = 1;
  };
  const at = (id, f, lat, turn) => { const ri = g.world.rivers.findIndex((r) => r.id === id); atS(ri, g.world.rivers[ri].length * f, lat, turn); };
  const fixed = (fn) => { g.cameraOverride = (cam) => fn(cam); };
  const close = (yawOff, dist, pitch) => fixed((cam) => { const b = g.boat; cam.tx = b.x; cam.tz = b.z; cam.ty = b.y + 0.6; cam.dist = dist; cam.pitch = pitch; cam.yaw = b.heading + yawOff; });
`;
const shots = [];
for (const k of KINDS) {
  const len = { raft: 4.2, kayak: 3.6, canoe: 5, dory: 5.6 }[k];
  shots.push({ name: `${k}-close`, hour: 11, setup: `g.setBoat('${k}'); at('long', 0.43, 0, 0); close(0.75, ${len * 1.35}, 0.32); g.playerStroke('forward');`, frames: 7 });
  shots.push({ name: `${k}-side`, hour: 11, setup: `g.setBoat('${k}'); at('long', 0.43, 0, 0); close(1.45, ${len * 1.2}, 0.12); g.playerStroke('left');`, frames: 9 });
  shots.push({ name: `${k}-chase`, hour: 11, setup: `g.setBoat('${k}'); g.boat.moored = false; at('long', 0.43, 0, 0); g.snapCamera(); g.playerStroke('forward'); g.boat.vx += Math.cos(g.boat.heading) * 2.5; g.boat.vz += Math.sin(g.boat.heading) * 2.5;`, frames: 20, mid: `g.playerStroke('right');`, frames2: 8 });
}
shots.push({ name: 'ghost-kayak', hour: 11, setup: `g.setBoat('kayak'); g.boat.moored = false; at('long', 0.43, 0, 0); const b = g.boat, fx = Math.cos(b.heading), fz = Math.sin(b.heading); const dec = []; for (let i = 0; i < 300; i++) dec.push({ t: i * 100, x: b.x - fz * 3 + fx * (i * 0.1 * 1.6 - 3), z: b.z + fx * 3 + fz * (i * 0.1 * 1.6 - 3), h: b.heading }); g.others.showGhosts('shot', [{ name: 'Old Heron', ms: 30000, decoded: dec, colour: [0.2, 0.6, 0.9] }], g.time - 1); close(0.9, 10, 0.3); g.playerStroke('forward');`, frames: 20 });
shots.push({ name: 'swim-raft', hour: 11, setup: `g.setBoat('raft'); g.boat.moored = false; at('long', 0.43, 0, 0); g.boat.swimming = true; close(1.9, 6.5, 0.38);`, frames: 18 });
shots.push({ name: 'swim-kayak-rapid', hour: 11, setup: `g.setBoat('kayak'); g.boat.moored = false; const r = g.rapids.find((x) => x.cls >= 3) || g.rapids[0]; atS(r.river, r.s0 + 25, 0); g.boat.vx = g.boat.current?.vx || 0; g.boat.swimming = true; close(2.3, 6, 0.4);`, frames: 18 });
shots.push({ name: 'raft-left-turn', hour: 11, setup: `g.setBoat('raft'); g.boat.moored = false; at('long', 0.43, 0, 0); g.snapCamera(); g.playerStroke('left');`, frames: 9,
  log: `(() => { const b = g.boat, k = g.kit, M = g.rig.M; const P = (p) => { const x = M[0]*p[0]+M[4]*p[1]+M[8]*p[2]+M[12], y = M[1]*p[0]+M[5]*p[1]+M[9]*p[2]+M[13], z = M[2]*p[0]+M[6]*p[1]+M[10]*p[2]+M[14]; return k.project(x, y, z); }; const c = P([0,0,0]), r = P([0,0,1]), l = P([0,0,-1]); return JSON.stringify({ centre: c, plusZ: r, minusZ: l, spin: b.spin, sweeps: g.rig.cur.map((q) => +q.sweep.toFixed(2)) }); })()` });
for (const k of ['raft', 'kayak']) {
  shots.push({ name: `${k}-rapid`, hour: 11, setup: `g.setBoat('${k}'); g.boat.moored = false; const r = g.rapids.find((x) => x.cls >= 3) || g.rapids[0]; atS(r.river, r.s0 + 25, 0); g.boat.vx = g.boat.current?.vx || 0; g.snapCamera(); g.kit.cam.pitch = 0.32; g.kit.cam.dist = 12; g.playerStroke('left');`, frames: 14 });
}
(async () => {
  const [base, outDir, prefix = ''] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  const url = base + (base.includes('?') ? '&' : '?') + 'drive=1&new=1&nosave=1&skip=1&quality=2';
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit, null, { timeout: 600000, polling: 1000 });
  let t = 0;
  const drive = async (n) => { t = await page.evaluate(([n, t0]) => { const k = window.__f2.kit; let t = t0; for (let i = 0; i < n; i++) { t += 1 / 30; k.drive(t); } return t; }, [n, t]); };
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  for (const s of shots) {
    if (only && !only.has(s.name)) continue;
    try {
      await page.evaluate(`(() => { ${PRELUDE} g.clock = ${s.hour} / 24; ${s.setup} })()`);
      await drive(s.frames);
      if (s.log) console.log(s.name, await page.evaluate(`(() => { const g = window.__f2; return ${s.log}; })()`));
      if (s.mid) { await page.evaluate(`(() => { const g = window.__f2; ${s.mid} })()`); await drive(s.frames2); }
      const data = await page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
      const file = path.join(outDir, `${prefix}${s.name}.png`);
      fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log('wrote', file);
    } catch (e) { console.log('fail', s.name, e.message); }
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

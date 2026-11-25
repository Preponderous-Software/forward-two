// Round 3 (wave 2): Wren's errand on a board, the HUD goal alternating with a
// job, the Saltmouth Light section of the Gear tab, and the restored light
// by day and by night. Canvas stills only (page screenshots time out under
// swiftshader on a busy box); panel text goes to result.json.
//   NODE_PATH=... node play3.cjs http://127.0.0.1:PORT <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, outDir] = process.argv.slice(2);
const out = {}; const dump = () => fs.writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 1));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|strata info/.test(m.text())) logs.push(m.text()); });
  await page.goto(`${base}/?server=off&world=small&skip=1&drive=1&new=1&nosave=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit && window.__f2.progress, null, { timeout: 300000, polling: 1000 });
  const drive = (n) => page.evaluate((n) => { const k = window.__f2.kit; let t = (window.__shotT || 0); for (let i = 0; i < n; i++) { t += 1 / 30; k.drive(t); } window.__shotT = t; }, n);
  const canvas = async (name) => { const d = await page.evaluate(() => document.getElementById('view').toDataURL('image/png')); fs.writeFileSync(`${outDir}/${name}`, Buffer.from(d.split(',')[1], 'base64')); };
  await drive(10);
  // Two letters done, the third (Brightwater Lodge) and fourth to come.
  await page.evaluate(() => { const g = window.__f2; g.journal.feats.add('first-rapid'); g.journal.deliveries = 1; g.journal.pay = 900; g.progress.check(); g.progress.claimed.add('brightwater'); g.journal.found.add('lodge'); });
  out.claimed = await page.evaluate(() => [...window.__f2.progress.claimed]);
  await page.evaluate(() => { const g = window.__f2; g.hud.panels.camp.openAt(g.places.camps[0], 'jobs'); });
  out.jobs = await page.evaluate(() => document.querySelector('.panel.open').innerText);
  // Take the errand, then watch the goal line over 30 s of game time.
  out.took = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-job]')].find((x) => /Wren/.test(x.closest('.item').innerText)); if (!b) return null; b.click(); return window.__f2.jobs.active?.label; });
  await page.evaluate(() => window.__f2.hud.panels.camp.close());
  out.goalLine = [];
  for (let i = 0; i < (process.env.GOAL_LOOP ? 6 : 0); i++) { await drive(150); out.goalLine.push(await page.evaluate(() => `${window.__f2.time.toFixed(0)}s ${document.getElementById('h-goal').textContent}`)); }
  dump();
  await page.evaluate(() => { const g = window.__f2; g.hud.panels.camp.openAt(g.places.camps[0], 'gear'); });
  out.gearBefore = await page.evaluate(() => document.querySelector('.panel.open').innerText.split('Saltmouth Light')[1]);
  out.funded = await page.evaluate(() => { const r = []; for (let i = 0; i < 4; i++) { const b = document.querySelector('[data-light]'); if (!b) break; b.click(); r.push(window.__f2.progress.light); } return r; });
  out.gearAfter = await page.evaluate(() => document.querySelector('.panel.open').innerText.split('Saltmouth Light')[1]);
  await page.evaluate(() => window.__f2.hud.panels.camp.close());
  dump();
  // Look at the light from the water off Saltmouth, by day and by night.
  const look = async (hour, name) => {
    await page.evaluate((hour) => {
      const g = window.__f2, l = g.places.landmarks.find((q) => q.id === 'lighthouse'), G = g.progress.lightGeo;
      g.clock = hour / 24;
      const gx = G ? l.x + G.ux * (G.r + 45) : l.x - 60, gz = G ? l.z + G.uz * (G.r + 45) : l.z - 60;
      g.boat.x = gx; g.boat.z = gz; g.boat.vx = g.boat.vz = 0; g.boat.heading = Math.atan2(l.z - gz, l.x - gx); g.snapCamera();
    }, hour);
    await drive(10); await page.evaluate(() => window.__f2.snapCamera()); await drive(3);
    await canvas(name);
  };
  await drive(5);                      // lightGeo is built on the first draw near the light
  await page.evaluate(() => { const g = window.__f2, l = g.places.landmarks.find((q) => q.id === 'lighthouse'); g.boat.x = l.x - 80; g.boat.z = l.z - 80; }); await drive(2);   // primes lightGeo
  await look(15, '07-light-day.png');
  await look(22.5, '08-light-night.png');
  out.lightGeo = await page.evaluate(() => window.__f2.progress.lightGeo);
  out.logs = logs; dump();
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { out.error = e.message; dump(); console.error(e.message); process.exit(1); });

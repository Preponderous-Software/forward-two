// Round N UI playtest: an old 0.1.0 save, the HUD goal, journal, map, camp tabs, a find.
const { chromium } = require('playwright');
const fs = require('fs');
const out = {}; const dump = () => fs.writeFileSync(`${process.argv[3]}/result.json`, JSON.stringify(out, null, 1));
const text = (page) => page.evaluate(() => (document.querySelector('.panel.open') || document.body).innerText.slice(0, 3000));
const [base, outDir, mode = 'old'] = process.argv.slice(2);
const SAVE_010 = { v: 1, seed: 1, boat: "canoe", pos: { x: 1137.7, z: 1285.7, heading: 0.206 }, clock: 0.45, hull: 0.8, boatsOwned: ["raft", "kayak", "canoe"], colour: null,
  journal: { found: ["fork", "lodge", "lookout", "dock", "isle", "bridge"], feats: ["first-rapid", "swim", "courier"], visited: ["fork"], pay: 137, deliveries: 6, explored: "", fromSource: false },
  jobs: { active: null }, races: { best: { "meadow-sprint": { ms: 50000, ghost: null, medal: "silver" } } }, at: 1763800000000 };
async function shot(page, path) { try { await page.screenshot({ path, timeout: 150000 }); } catch (e) { out.shotErrors = (out.shotErrors || []).concat(path + ': ' + e.message.split('\n')[0]); dump(); } }
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (mode === 'old') await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('f2.save.v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(SAVE_010));
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'log' || /toast|error/i.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}/?server=off&world=small&skip=1&drive=1${mode === 'new' ? '&new=1' : ''}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit && window.__f2.progress, null, { timeout: 300000, polling: 1000 });
  const drive = (n) => page.evaluate((n) => { const k = window.__f2.kit; let t = (window.__shotT || 0); for (let i = 0; i < n; i++) { t += 1 / 30; k.drive(t); } window.__shotT = t; }, n);
  await drive(40);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent));
  const state = await page.evaluate(() => { const g = window.__f2; return { pay: g.journal.pay, rank: g.progress.rank(), claimed: [...g.progress.claimed], goal: document.getElementById('h-goal')?.textContent, feats: [...g.journal.feats], save: JSON.parse(localStorage.getItem('f2.save.v1') || 'null') }; });
  Object.assign(out, { mode, toasts, state: { ...state, save: undefined } }); dump();
  await shot(page, `${outDir}/01-hud.png`);
  await page.evaluate(() => window.__f2.hud.action('journal')); await drive(2);
  out.journal = await text(page); dump(); await shot(page, `${outDir}/02-journal.png`);
  
  await page.evaluate(() => window.__f2.hud.action('map')); await drive(2);
  out.map = await text(page); dump(); await shot(page, `${outDir}/03-map.png`);
  await page.evaluate(() => window.__f2.hud.action('map'));
  for (const tab of ['gear', 'jobs', 'shuttle']) {
    await page.evaluate((tab) => { const g = window.__f2; g.hud.panels.camp.openAt(g.places.camps[0], tab); }, tab);
    out['camp-' + tab] = await text(page); dump();
    if (tab === 'gear') await shot(page, `${outDir}/04-camp-${tab}.png`);
  }
  // Buy the first gear we can.
  const bought = await page.evaluate(() => { const b = document.querySelector('[data-tab="gear"]'); b.click(); const x = document.querySelector('[data-gear]:not([disabled])'); if (!x) return null; x.click(); return window.__f2.progress.data().gear; });
  await page.evaluate(() => window.__f2.hud.panels.camp.close());
  // Drift to the paddle-blade find near the fork and look at it.
  await page.evaluate(() => { const g = window.__f2, f = g.progress.placed.find((x) => x.id === 'blade'); g.boat.x = f.x - 40; g.boat.z = f.z - 8; g.boat.heading = Math.atan2(8, 40); g.boat.vx = g.boat.vz = 0; g.snapCamera(); });
  await drive(20);
  const data = await page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
  fs.writeFileSync(`${outDir}/05-find-ahead.png`, Buffer.from(data.split(',')[1], 'base64'));
  await page.evaluate(() => { const g = window.__f2, f = g.progress.placed.find((x) => x.id === 'blade'); g.boat.x = f.x - 3; g.boat.z = f.z; });
  await drive(30);
  out.cardpop = await page.evaluate(() => [...document.querySelectorAll('.cardpop')].map((e) => e.innerText)); dump(); await shot(page, `${outDir}/06-find-card.png`);
  const after = await page.evaluate(() => ({ finds: [...window.__f2.progress.finds], pay: window.__f2.journal.pay }));
  await page.evaluate(() => window.__f2.save.write());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('f2.save.v1')));
  Object.assign(out, { bought, after, savedProgress: saved.progress, savedDay: saved.day, logs: logs.slice(-15) }); dump(); console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

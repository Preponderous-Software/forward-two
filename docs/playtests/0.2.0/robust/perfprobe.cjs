// Boot + frame timing per preset (headless SwiftShader: relative numbers only).
const { chromium } = require('playwright');
(async () => {
  const [base, presets = 'small,full', extra = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const p of presets.split(',')) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const t0 = Date.now();
    await page.goto(`${base}/?world=${p}&drive=1&server=off&nosave=1&new=1&skip=1${extra}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__f2 && window.__f2.kit, null, { timeout: 300000, polling: 200 });
    const boot = Date.now() - t0;
    const r = await page.evaluate(() => {
      const g = window.__f2, k = g.kit;
      const realFrame = g.frame.bind(g); let js = [];
      g.frame = (t, now, dt) => { const a = performance.now(); realFrame(t, now, dt); js.push(performance.now() - a); };
      let t = 0; for (let i = 0; i < 10; i++) { t += 1 / 30; k.drive(t); }  // warm
      js = []; const a = performance.now();
      for (let i = 0; i < 60; i++) { t += 1 / 30; k.drive(t); }
      const total = (performance.now() - a) / 60;
      js.sort((x, y) => x - y);
      return { frameMs: +total.toFixed(1), jsMedian: +js[30].toFixed(2), jsP95: +js[57].toFixed(2), perf: window.__f2perf || null, stats: k.stats(), trees: g.treeCount };
    });
    console.log(JSON.stringify({ preset: p, bootMs: boot, ...r, errors: errs.slice(0, 3) }));
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

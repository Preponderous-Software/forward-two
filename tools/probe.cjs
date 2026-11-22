// Load the game headless and print logs + kit stats + frame timings.
const { chromium } = require('playwright');
(async () => {
  const [url, waitMs = '20000'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit, null, { timeout: 240000, polling: 1000 }).catch((e) => console.log('timeout: ' + e.message));
  console.log('ready after', Date.now() - t0, 'ms');
  await page.waitForTimeout(+waitMs);
  const s = await page.evaluate(() => JSON.stringify({ stats: window.__f2.kit.stats(), time: window.__f2.time, quality: window.__f2.kit.quality })).catch((e) => 'eval ' + e.message);
  console.log(s);
  await browser.close();
})();

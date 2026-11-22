// Headless stills: drives the game's frames (?drive=1) and saves the canvas
// plus the HUD as a page screenshot.
//   node tools/shot.cjs <url> <out.png> [frames=30] [w=1280] [h=720] [setup-js]
const { chromium } = require('playwright');
(async () => {
  const [url, out, frames = '30', w = '1280', h = '720', js = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'drive=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit, null, { timeout: 300000, polling: 1000 });
  if (js) await page.evaluate(js).catch((e) => logs.push('setup: ' + e.message));
  await page.evaluate((n) => { const k = window.__f2.kit; let t = (window.__shotT || 0); for (let i = 0; i < n; i++) { t += 1 / 30; k.drive(t); } window.__shotT = t; }, +frames);
  const data = await page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
  require('fs').writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  if (process.env.SHOT_PAGE) await page.screenshot({ path: out.replace(/\.png$/, '-page.png'), timeout: 120000 }).catch((e) => logs.push('page shot: ' + e.message));
  console.log(logs.filter((l) => !l.includes('404')).slice(-20).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

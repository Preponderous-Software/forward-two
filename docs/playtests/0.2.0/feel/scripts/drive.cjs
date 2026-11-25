// Scripted playtest: node drive.cjs <scenario.js> <outdir> [w h] [touch]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [scen, outdir, w = '1280', h = '720', touch = ''] = process.argv.slice(2);
  fs.mkdirSync(outdir, { recursive: true });
  const S = require(path.resolve(scen));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: !!touch, isMobile: !!touch });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:8831/?server=off&world=small&drive=1${S.query || ''}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__f2 && window.__f2.kit && window.__f2.hud, null, { timeout: 300000, polling: 1000 });
  await page.evaluate(() => { window.__T = 0; window.__run = (n) => { const k = window.__f2.kit; for (let i = 0; i < n; i++) { window.__T += 1 / 30; k.drive(window.__T); } }; window.__key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    // Fast simulation without GL: the game's own frame (ticks, camera, HUD) at 30 fps.
    // opts.pilot: steer down the river centre with strokes every 0.45 s.
    // opts.bot: 'perfect' | 'early' | 'late' | 'none' answers the guide's calls.
    window.__sim = (sec, opts = {}) => {
      const g = window.__f2, out = { strokes: 0, judged: {}, events: [] };
      const off = { perfect: 0, early: -0.24, late: 0.24, good: 0.15 }[opts.bot];
      let nextPilot = 0;
      const origJ = g.hud.judgment.bind(g.hud);
      g.hud.judgment = (j, c) => { out.judged[j] = (out.judged[j] || 0) + 1; origJ(j, c); };
      for (let t = 0; t < sec; t += 1 / 30) {
        const b = g.boat, now = g.time;
        if (opts.bot && opts.bot !== 'none' && g.caller.calls.length) {
          for (const c of g.caller.calls) if (!c._done && now >= c.time + off - 1 / 60) { c._done = true; g.playerStroke(c.call); out.strokes++; break; }
        } else if (opts.pilot && now >= nextPilot && !g.caller.rapid && !g.walker.active) {
          nextPilot = now + 0.45;
          const hit = b.current && b.current.hit;
          if (hit) {
            const s = hit.sample, want = Math.atan2(s.tz, s.tx) + Math.max(-0.6, Math.min(0.6, -hit.lateral * 0.05)) * (opts.pilot === 'up' ? -1 : 1) + (opts.pilot === 'up' ? Math.PI : 0);
            let d = want - b.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
            const k = d > 0.25 ? 'right' : d < -0.25 ? 'left' : 'forward';
            if (k !== 'forward' || opts.paddle !== false) { g.playerStroke(k); out.strokes++; }
          }
        }
        g.frame(0, 0, 1 / 30);
        if (opts.until && opts.until(g)) { out.stoppedAt = g.time.toFixed(1); break; }
      }
      g.hud.judgment = origJ;
      return out;
    };
  });
  const out = [];
  for (const st of S.steps) {
    if (st.js) { const r = await page.evaluate(st.js).catch((e) => 'ERR ' + e.message); if (r !== undefined) out.push(`js ${st.label || ''}: ${JSON.stringify(r)}`); }
    if (st.sim) { const r = await page.evaluate(([sec, o]) => { const opts = { ...o }; if (o.until) opts.until = new Function('g', 'return ' + o.until); return window.__sim(sec, opts); }, [st.sim, st.opts || {}]); out.push(`sim ${st.label || ''} ${JSON.stringify(r)}`); st.frames = st.frames || 1; }
    if (st.frames) {
      const per = st.sample || st.frames;
      for (let f = 0; f < st.frames; f += per) {
        await page.evaluate((n) => window.__run(n), Math.min(per, st.frames - f));
        const s = await page.evaluate(() => { const g = window.__f2, b = g.boat, c = g.kit.cam; const q = (id) => document.getElementById(id); return { t: g.time.toFixed(1), x: b.x.toFixed(0), z: b.z.toFixed(0), sp: Math.hypot(b.vx, b.vz).toFixed(2), hd: (b.heading * 57.3 % 360).toFixed(0), yaw: (c.yaw * 57.3 % 360).toFixed(0), dist: c.dist.toFixed(1), pitch: c.pitch.toFixed(2), stab: b.stability.toFixed(2), swim: b.swimming, rapid: g.caller.rapid?.name || '', calls: g.caller.calls.length, flow: g.caller.flow.toFixed(2), where: q('h-where')?.textContent, sub: q('h-sub')?.textContent, prompt: q('h-prompt')?.textContent, flash: q('h-flash')?.classList.contains('on') ? q('h-flash').textContent : '', coach: q('h-coach')?.textContent || '', walker: !!g.walker?.active, paused: !!g.paused }; });
        out.push(`${st.label || ''} ${JSON.stringify(s)}`);
      }
    }
    if (st.shot) {
      const data = await page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
      fs.writeFileSync(path.join(outdir, st.shot + '.png'), Buffer.from(data.split(',')[1], 'base64'));
      if (st.page) await page.screenshot({ path: path.join(outdir, st.shot + '-page.png'), timeout: 60000 }).catch((e) => out.push('page shot: ' + e.message));
    }
  }
  fs.writeFileSync(path.join(outdir, 'log.txt'), out.join('\n') + '\n--- console\n' + logs.filter((l) => !l.includes('404')).join('\n'));
  console.log(out.slice(-60).join('\n')); console.log(logs.filter((l) => !l.includes('404')).slice(-15).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

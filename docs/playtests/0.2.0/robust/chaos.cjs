// Robustness playtest: two clients on a local relay, a group race, the relay
// killed mid-race and restarted, a corrupt save, blocked wasm/worker/modules.
// node chaos.cjs <static base> <repo> <outdir>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const [BASE, REPO, OUT] = process.argv.slice(2);
const RELAY = 'ws://127.0.0.1:8794';
const log = [];
const note = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let relay = null;
function startRelay() {
  fs.mkdirSync(`${OUT}/relay-data`, { recursive: true });
  relay = spawn('node', ['server/main.js'], { cwd: REPO, env: { ...process.env, PORT: '8794', HOST: '127.0.0.1', F2_DATA: `${OUT}/relay-data`, DO_NOT_TRACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  relay.stdout.on('data', (d) => fs.appendFileSync(`${OUT}/relay.log`, d));
  relay.stderr.on('data', (d) => fs.appendFileSync(`${OUT}/relay.log`, d));
  return new Promise((ok) => relay.stdout.once('data', ok));
}
async function waitFor(page, fn, arg, ms = 400000) { return page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }); }
async function shot(page, name) {
  try {
    const data = await page.evaluate(() => { const k = window.__f2?.kit; if (k) k.drive((window.__f2.time || 0) + 0.01); return document.getElementById('view').toDataURL('image/png'); });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  } catch (e) { note('shot failed', name, e.message); }
}
function watch(page, tag, errs) {
  page.on('pageerror', (e) => { errs.push(`${tag} pageerror: ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' || /save:|world worker|net message/.test(m.text())) errs.push(`${tag} ${m.type()}: ${m.text().slice(0, 160)}`); });
}
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const results = {};
  // ---------------------------------------------------------- 1. two clients + race + relay kill
  const section = async (name, fn) => { const t = Date.now(); try { await fn(); note(`[${name}] ok in ${Date.now() - t} ms`); } catch (e) { note(`[${name}] FAILED after ${Date.now() - t} ms: ${e.message.split('\n')[0]}`); results[name + 'Failed'] = e.message.slice(0, 300); } };
  let A, B, ctxA, ctxB; const errs = [];
  const want = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
  if (want('mp')) await section('multiplayer', async () => {
  await startRelay();
  note('relay up pid', relay.pid);
  const url = `${BASE}/?world=tiny&quality=0&skip=1&nosave=1&new=1&drive=1&server=${encodeURIComponent(RELAY)}`;
  // ?drive=1: no render loop; the sim is pumped by hand (SwiftShader on a loaded box draws ~1 fps).
  const pump = (P) => P.evaluate(() => { window.__pump = setInterval(() => { const g = window.__f2; if (g) for (let i = 0; i < 6; i++) g.tick(1 / 60); }, 100); });
  ctxA = await browser.newContext({ viewport: { width: 480, height: 270 } });
  ctxB = await browser.newContext({ viewport: { width: 480, height: 270 } });
  A = await ctxA.newPage(); B = await ctxB.newPage();
  watch(A, 'A', errs); watch(B, 'B', errs);
  const t0 = Date.now();
  await A.goto(url, { waitUntil: 'commit' }); await waitFor(A, () => window.__f2?.kit, null, 400000); await pump(A); await waitFor(A, () => window.__f2?.net?.online, null, 400000); note('A online', Date.now() - t0, 'ms');
  await B.goto(url, { waitUntil: 'commit' }); await waitFor(B, () => window.__f2?.kit, null, 400000); await pump(B); await waitFor(B, () => window.__f2?.net?.online, null, 400000);
  results.bothOnlineMs = Date.now() - t0;
  note('both online after', results.bothOnlineMs, 'ms');
  const idA = await A.evaluate(() => window.__f2.net.id);
  await waitFor(B, (id) => window.__f2.net.players.get(id)?.samples.length > 0, idA, 30000);
  note('B sees A with live samples');
  await B.evaluate(() => { window.__emotes = []; window.__f2.net.on('emote', (e) => window.__emotes.push(e.kind)); });
  await A.evaluate(() => window.__f2.net.emote('bell'));
  await waitFor(B, () => window.__emotes.includes('bell'), null, 15000);
  note('emote A->B ok');
  // Both to the first course's start buoy, then a group start.
  const course = await A.evaluate(() => { const c = window.__f2.races.courses[0]; return { id: c.id, name: c.name }; });
  for (const [P, off] of [[A, 0], [B, 6]]) {
    await P.evaluate((off) => { const g = window.__f2, c = g.races.courses[0], gt = c.gates[0], b = g.boat; const x = gt.x + off * 0.3, z = gt.z + off * 0.3; const hold = () => { if (g.races.run) return clearInterval(window.__hold); g.boat.x = x; g.boat.z = z; g.boat.vx = g.boat.vz = 0; }; hold(); window.__hold = setInterval(hold, 100); g.races.interact(); }, off);
  }
  await Promise.all([waitFor(A, () => !!window.__f2.races.run, null, 40000), waitFor(B, () => !!window.__f2.races.run, null, 40000)]);
  note('group race started on', course.name);
  await shot(A, 'mp-race-a'); await shot(B, 'mp-race-b');
  // Kill the relay mid-race.
  const tKill = Date.now();
  relay.kill('SIGKILL'); note('relay killed (SIGKILL) pid', relay.pid);
  await Promise.all([waitFor(A, () => !window.__f2.net.online, null, 30000), waitFor(B, () => !window.__f2.net.online, null, 30000)]);
  results.offlineDetectMs = Date.now() - tKill;
  const mid = await A.evaluate(() => ({ run: !!window.__f2.races.run, time: window.__f2.time, chip: document.getElementById('h-online')?.textContent }));
  await sleep(3000);
  const mid2 = await A.evaluate(() => ({ run: !!window.__f2.races.run, time: window.__f2.time, others: window.__f2.net.players.size }));
  note('offline after', results.offlineDetectMs, 'ms; race still running:', mid.run && mid2.run, '; game time advanced', (mid2.time - mid.time).toFixed(1), 's; chip:', mid.chip, '; players', mid2.others);
  results.raceSurvivesRelayLoss = mid.run && mid2.run && mid2.time > mid.time;
  await shot(A, 'mp-relay-down');
  // Finish offline: the time stays on the device.
  // Restart the relay; the clients should come back by themselves.
  await sleep(4000);
  const tUp = Date.now();
  await startRelay(); note('relay restarted pid', relay.pid);
  await Promise.all([waitFor(A, () => window.__f2.net.online, null, 90000), waitFor(B, () => window.__f2.net.online, null, 90000)]);
  results.reconnectMs = Date.now() - tUp;
  note('both reconnected', results.reconnectMs, 'ms after restart');
  const idA2 = await A.evaluate(() => window.__f2.net.id);
  await waitFor(B, (id) => window.__f2.net.players.has(id), idA2, 30000);
  note('B sees A again after reconnect');
  await shot(B, 'mp-reconnected');
  });
  results.mpErrors = errs.slice();
  try { results.mpState = await A.evaluate(() => ({ online: window.__f2?.net?.online, players: window.__f2?.net?.players?.size, run: !!window.__f2?.races?.run })); } catch {}
  await ctxA?.close(); await ctxB?.close();
  try { relay.kill('SIGTERM'); } catch {}

  // ---------------------------------------------------------- 2. corrupt save
  if (want('save')) await section('save', async () => {
  const sctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  let S = await sctx.newPage(); const serr = []; watch(S, 'S', serr);
  const surl = `${BASE}/?world=tiny&quality=0&skip=1&server=off`;
  const good = { v: 1, seed: 1, boat: 'canoe', pos: null, clock: 0.3, hull: 0.7, boatsOwned: ['raft', 'canoe'], colour: null, journal: { found: [], feats: [], visited: [], pay: 77, deliveries: 2 }, at: Date.parse('2026-11-20T10:00:00Z'), futureField: 'kept' };
  await S.goto(surl, { waitUntil: 'commit' });
  await waitFor(S, () => window.__f2?.boat);
  const spawn = await S.evaluate(() => ({ x: window.__f2.boat.x, z: window.__f2.boat.z, heading: window.__f2.boat.heading }));
  good.pos = spawn;
  // Close the game first (its pagehide save would overwrite the damage), then
  // damage the save from a same-origin page with no game on it.
  const damage = async (fn, arg) => { await S.close(); const H = await sctx.newPage(); await H.goto(`${BASE}/favicon.svg`); await H.evaluate(fn, arg); await H.close(); S = await sctx.newPage(); watch(S, 'S', serr); await S.goto(surl, { waitUntil: 'commit' }); };
  await damage((g) => { localStorage.setItem('f2.save.v1.bak', JSON.stringify(g)); localStorage.setItem('f2.save.v1', '{"v":1,"boat":"kay'); }, good);
  await waitFor(S, () => window.__f2?.hud);
  const rec = await S.evaluate(() => ({ boat: window.__f2.boat.kind, pay: window.__f2.journal.pay, notice: window.__f2.save.notice(), corrupt: localStorage.getItem('f2.save.v1.corrupt'),
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) }));
  note('corrupt save + backup ->', JSON.stringify(rec));
  results.corruptWithBackup = rec;
  await S.evaluate(() => window.__f2.save.write());
  results.futureFieldKept = await S.evaluate(() => JSON.parse(localStorage.getItem('f2.save.v1')).futureField);
  note('unknown field after a write:', results.futureFieldKept);
  await damage(() => { localStorage.removeItem('f2.save.v1.bak'); localStorage.setItem('f2.save.v1', 'garbage\u0000'); });
  await waitFor(S, () => window.__f2?.hud);
  const rec2 = await S.evaluate(() => ({ boat: window.__f2.boat.kind, notice: window.__f2.save.notice(), corrupt: localStorage.getItem('f2.save.v1.corrupt') }));
  note('corrupt save, no backup ->', JSON.stringify(rec2));
  results.corruptNoBackup = rec2;
  // Storage that throws.
  await S.addInitScript(() => { const thrower = () => { throw new DOMException('denied', 'SecurityError'); }; Storage.prototype.getItem = thrower; Storage.prototype.setItem = thrower; });
  await S.reload({ waitUntil: 'commit' });
  await waitFor(S, () => window.__f2?.hud);
  results.blockedStorage = await S.evaluate(() => ({ booted: true, wrote: window.__f2.save.write() }));
  note('storage blocked ->', JSON.stringify(results.blockedStorage));
  results.saveErrors = serr.slice();
  await sctx.close();
  });

  // ---------------------------------------------------------- 3. blocked wasm / no WebAssembly / blocked worker / blocked module
  async function blocked(name, setup, ms = 400000) {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const P = await ctx.newPage(); const e = []; watch(P, name, e);
    await setup(P, ctx);
    const t = Date.now();
    await P.goto(`${BASE}/?world=tiny&quality=0&skip=1&nosave=1&server=off`, { waitUntil: 'commit' });
    let out;
    try {
      await P.waitForFunction(() => document.querySelector('.sk-fallback, .f2-guard, [role=alert]') || window.__f2?.kit, null, { timeout: ms, polling: 250 });
      out = await P.evaluate(() => ({ booted: !!window.__f2?.kit, text: (document.querySelector('.sk-fallback .sk-box, .f2-guard, [role=alert]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300), retry: !![...document.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent)) }));
    } catch (err) { out = { timeout: err.message.slice(0, 100) }; }
    out.ms = Date.now() - t; out.errors = e.slice(0, 4);
    note(name, '->', JSON.stringify(out));
    await ctx.close();
    return out;
  }
  // ---------------------------------------------------------- 2b. lobby + finish with the relay gone
  if (want('race')) await section('offlineRace', async () => {
    await startRelay(); note('relay up pid', relay.pid);
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const P = await ctx.newPage(); const e = []; watch(P, 'R', e);
    const rurl = `${BASE}/?world=tiny&quality=0&skip=1&nosave=1&new=1&drive=1&server=${encodeURIComponent(RELAY)}`;
    await P.goto(rurl, { waitUntil: 'commit' });
    await waitFor(P, () => window.__f2?.kit);
    await P.evaluate(() => { window.__toasts = []; const g = window.__f2, t = g.hud.toast.bind(g.hud); g.hud.toast = (s, d) => { window.__toasts.push(s); return t(s, d); }; window.__pump = setInterval(() => { for (let i = 0; i < 6; i++) g.tick(1 / 60); }, 100); });
    await waitFor(P, () => window.__f2.net.online, null, 60000);
    await P.evaluate(() => { const g = window.__f2, c = g.races.courses[0], gt = c.gates[0]; const hold = () => { if (g.races.run) return clearInterval(window.__hold); g.boat.x = gt.x; g.boat.z = gt.z; g.boat.vx = g.boat.vz = 0; }; hold(); window.__hold = setInterval(hold, 100); g.races.interact(); });
    await waitFor(P, () => !!window.__f2.races.pending, null, 30000);
    note('group lobby open (waiting for the start)');
    const tk = Date.now(); relay.kill('SIGKILL'); note('relay killed in the lobby');
    await waitFor(P, () => !window.__f2.races.pending && (window.__f2.races.lobby || window.__f2.races.run), null, 30000);
    const lob = await P.evaluate(() => ({ lobby: !!window.__f2.races.lobby, toast: window.__toasts.at(-1) }));
    results.lobbyFallbackMs = Date.now() - tk; results.lobbyFallback = lob;
    note('lobby fell back in', results.lobbyFallbackMs, 'ms:', JSON.stringify(lob));
    await waitFor(P, () => !!window.__f2.races.run, null, 60000);
    note('solo run started after the countdown');
    // Finish the run while the relay is still down (the sim is stepped by hand, so finish directly).
    const tf = Date.now();
    const fin = await P.evaluate(async () => {
      const g = window.__f2, r = g.races.run, c = r.course;
      for (let i = r.samples.length; i < 60; i++) r.samples.push({ t: i * 100, x: c.gates[0].x + i * 0.3, z: c.gates[0].z, h: 0 });
      await g.races.finish(37.5);
      return { best: g.races.best[c.id]?.ms, queue: JSON.parse(localStorage.getItem('f2.ghosts.queue') || '[]').length, local: JSON.parse(localStorage.getItem(`f2.ghosts.${c.id}`) || '[]').length, toast: window.__toasts.at(-1) };
    });
    results.offlineFinishMs = Date.now() - tf; results.offlineFinish = fin;
    note('finished offline in', results.offlineFinishMs, 'ms:', JSON.stringify(fin));
    await startRelay(); note('relay restarted pid', relay.pid);
    await waitFor(P, () => window.__f2.net.online, null, 90000);
    await waitFor(P, () => JSON.parse(localStorage.getItem('f2.ghosts.queue') || '[]').length === 0, null, 30000);
    // This run's samples are synthetic, so the board's gate check refuses it (422) and it is dropped, not retried.
    const board = await fetch('http://127.0.0.1:8794/api/board/' + (await P.evaluate(() => window.__f2.races.courses[0].id))).then((r) => r.json());
    results.queueAfterReconnect = { emptied: true, boardRows: board.board.length };
    note('queue emptied after reconnect; board rows', board.board.length);
    results.raceErrors = e.slice(0, 5);
    await ctx.close(); try { relay.kill('SIGTERM'); } catch {}
  });
  // ---------------------------------------------------------- 2c. WebGL context lost and restored
  if (want('ctx')) for (const mode of ['', '&meshcopy=1']) await section('ctx' + (mode ? '-meshcopy' : ''), async () => {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const P = await ctx.newPage(); const e = []; watch(P, 'C' + mode, e);
    const pageErrors = []; P.on('pageerror', (x) => pageErrors.push(x.message));
    await P.goto(`${BASE}/?world=small&quality=0&skip=1&nosave=1&new=1&drive=1&server=off&hour=10${mode}`, { waitUntil: 'commit' });
    await waitFor(P, () => window.__f2?.kit);
    const grab = () => P.evaluate(() => { window.__f2.kit.drive(1); return document.getElementById('view').toDataURL('image/png'); });
    const shotBefore = await grab();
    const before = await P.evaluate(() => { const g = window.__f2, k = g.kit; k.drive(1); return { heapMB: +(g.mod.HEAPF32.buffer.byteLength / 1048576).toFixed(1), droppedMB: +(g.bridge.droppedBytes / 1048576).toFixed(1), stats: k.stats() }; });
    const tag = mode ? 'meshcopy' : 'nocopy';
    await shot(P, `ctx-${tag}-before`);
    const lost = await P.evaluate(() => window.__f2.kit.loseContext());
    await P.waitForTimeout(500);
    await P.evaluate(() => window.__f2.kit.restoreContext());
    const tr = Date.now();
    await waitFor(P, (copy) => !window.__f2.kit.lost && !window.__f2.restoring && (copy || window.__f2.restored), !!mode, 400000);
    const restoreWallMs = Date.now() - tr;
    const shotAfter = await grab();
    // Same scene time before and after: how many pixels changed?
    const diff = await P.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = px(ia), db = px(ib); let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) n++;
      return +(n / (da.length / 4) * 100).toFixed(2);
    }, [shotBefore, shotAfter]);
    const after = await P.evaluate(() => { const g = window.__f2, k = g.kit; k.drive(1); return { restored: g.restored || null, heapMB: +(g.mod.HEAPF32.buffer.byteLength / 1048576).toFixed(1), stats: k.stats(), fatal: k.fatal }; });
    await shot(P, `ctx-${tag}-after`);
    results['ctx_' + tag] = { lost, before, after, pageErrors, restoreWallMs, pixelsChangedPct: diff };
    note(`context ${tag}: lost=${lost}; heap ${before.heapMB} MB (dropped ${before.droppedMB} MB of copies); meshes ${before.stats.meshes} -> ${after.stats.meshes}; restore ${JSON.stringify(after.restored)}; heap after ${after.heapMB} MB; restored in ${restoreWallMs} ms wall; ${diff}% of pixels differ from before; page errors ${pageErrors.length}`);
    if (after.stats.meshes !== before.stats.meshes) throw new Error(`meshes ${before.stats.meshes} -> ${after.stats.meshes}`);
    if (pageErrors.length) throw new Error(pageErrors[0]);
    await ctx.close();
  });
  if (process.env.ONLY) { await browser.close(); fs.writeFileSync(`${OUT}/chaos-results.json`, JSON.stringify(results, null, 2)); fs.writeFileSync(`${OUT}/chaos-log.txt`, log.join('\n') + '\n'); return; }
  results.wasmBlocked = await blocked('wasm-blocked', (P) => P.route('**/*.wasm', (r) => r.abort()));
  results.wasm404 = await blocked('wasm-404', (P) => P.route('**/*.wasm', (r) => r.fulfill({ status: 404, body: 'nope' })));
  results.wasmGarbage = await blocked('wasm-garbage', (P) => P.route('**/*.wasm', (r) => r.fulfill({ status: 200, contentType: 'application/wasm', body: 'not a wasm module' })));
  results.noWebAssembly = await blocked('no-webassembly', (P) => P.addInitScript(() => { delete window.WebAssembly; }));
  results.workerBlocked = await blocked('worker-blocked', (P) => P.route('**/world/worker.js', (r) => r.abort()));
  results.moduleBlocked = await blocked('module-blocked', (P) => P.route('**/src/game/game.js', (r) => r.abort()));
  results.loaderBlocked = await blocked('loader-script-blocked', (P) => P.route('**/engine/strata-loader.js', (r) => r.abort()));
  // A frame that throws: the loop carries on.
  {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const P = await ctx.newPage(); const e = []; watch(P, 'frame-throw', e);
    await P.goto(`${BASE}/?world=tiny&quality=0&skip=1&nosave=1&server=off`, { waitUntil: 'commit' });
    await waitFor(P, () => window.__f2?.kit?.running);
    const r = await P.evaluate(async () => {
      const g = window.__f2; let n = 0; const real = g.hud.update.bind(g.hud);
      g.hud.update = (dt) => { if (n++ < 5) throw new Error('injected hud bug'); return real(dt); };
      const t = g.time; await new Promise((ok) => setTimeout(ok, 3000));
      return { errors: g.frameMeter.errors, advanced: g.time - t, running: g.kit.running };
    });
    note('frame throws 5x ->', JSON.stringify(r));
    results.frameThrow = r;
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${OUT}/chaos-results.json`, JSON.stringify(results, null, 2));
  fs.writeFileSync(`${OUT}/chaos-log.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error('FAILED', e.stack || e.message); try { relay?.kill('SIGKILL'); } catch {} fs.writeFileSync(`${OUT}/chaos-log.txt`, log.join('\n') + '\nFAILED ' + e.message + '\n'); process.exit(1); });

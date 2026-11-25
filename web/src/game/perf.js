// Picks a quality tier at boot from device hints and what the last session
// measured, and measures this session (worldgen, start-up, frame cost).
//
// The Strata kit already adapts the pixel density and its shadow tier to the
// frame time. This sits above it: the world preset (full 1025² vs small 513²),
// the game's own detail (spray, foam draw distance), and a memory of devices
// that hit the kit's floor, so the next visit starts lighter. ?world= and
// ?detail= (0-2) pin the choice; ?perf=1 shows the numbers.

export const PERF_KEY = "f2.perf.v1";

// Detail tiers the game reads (game.detail).
export const DETAIL = [
  { name: "low", spray: 2, foamRadius: 35, dprCap: 1.25 },
  { name: "medium", spray: 4, foamRadius: 55, dprCap: 2 },
  { name: "high", spray: 6, foamRadius: 70, dprCap: 2 },
];

export function readHints(g = globalThis) {
  const nav = g.navigator || {};
  const mm = (q) => { try { return !!g.matchMedia?.(q).matches; } catch { return false; } };
  return {
    coarse: mm("(pointer: coarse)"),
    mem: Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
    cores: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    saveData: !!nav.connection?.saveData,
    dpr: g.devicePixelRatio || 1,
  };
}

// hints: readHints(); params: URLSearchParams-like; stored: readPerf().
// Returns {preset, detail (0-2), dprCap, reasons[]}.
export function pickTier(hints = {}, params = null, stored = null) {
  const get = (k) => { try { return params?.get?.(k) ?? null; } catch { return null; } };
  const reasons = [];
  const slow = (stored && stored.slow) || {};
  const weak = !!(hints.coarse || (hints.mem != null && hints.mem <= 4) || (hints.cores != null && hints.cores <= 4) || hints.saveData);
  if (hints.coarse) reasons.push("touch screen");
  if (hints.mem != null && hints.mem <= 4) reasons.push(`${hints.mem} GB memory`);
  if (hints.cores != null && hints.cores <= 4) reasons.push(`${hints.cores} cores`);
  if (hints.saveData) reasons.push("data saver");

  let preset = weak ? "small" : "full";
  if (preset === "full" && slow.full) { preset = "small"; reasons.push("slow last time on the full world"); }
  const w = get("world");
  if (w === "small" || w === "full" || w === "tiny") { preset = w; reasons.push("?world"); }

  let detail = preset === "full" ? 2 : 1;
  if (hints.saveData || (hints.mem != null && hints.mem <= 2)) detail = 0;
  if (slow[preset]) { detail = Math.min(detail, preset === "full" ? 1 : 0); reasons.push(`slow last time on the ${preset} world`); }
  const d = get("detail");
  if (d != null && /^[0-2]$/.test(d)) { detail = Number(d); reasons.push("?detail"); }
  return { preset, detail, dprCap: DETAIL[detail].dprCap, reasons };
}

// Trees per square metre, relative to the full world's forest. The small
// world (phones) has always had 0.3; the lowest detail thins it further.
export function forestDensity(preset, detail = 2) {
  const base = preset === "full" ? 1 : 0.3;
  return detail <= 0 ? base * 0.6 : base;
}

function store(g = globalThis) { try { return g.localStorage || null; } catch { return null; } }

export function readPerf(s = store()) {
  try {
    const j = JSON.parse(s?.getItem(PERF_KEY) || "null");
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

export function writePerf(data, s = store()) {
  try { s?.setItem(PERF_KEY, JSON.stringify(data)); return true; } catch { return false; }
}

// The kit has nothing left to give up on this preset: remember it.
export function noteSlow(preset, frameMs, s = store()) {
  const p = readPerf(s);
  p.slow = { ...(p.slow || {}), [preset]: { frameMs: Math.round(frameMs || 0), at: Date.now() } };
  return writePerf(p, s);
}

// Choosing a preset by hand (?world=) forgets that it was slow.
export function clearSlow(preset, s = store()) {
  const p = readPerf(s);
  if (!p.slow?.[preset]) return false;
  delete p.slow[preset];
  return writePerf(p, s);
}

// Rolling JS cost of the game's frame (excludes the GPU and the browser).
export class FrameMeter {
  constructor(n = 120) { this.buf = new Float32Array(n); this.i = 0; this.count = 0; this.errors = 0; }
  add(ms) { this.buf[this.i] = ms; this.i = (this.i + 1) % this.buf.length; this.count++; }
  summary() {
    const n = Math.min(this.count, this.buf.length);
    if (!n) return { n: 0, avg: 0, p95: 0, max: 0 };
    const a = Array.from(this.buf.subarray(0, n)).sort((x, y) => x - y);
    return { n, avg: a.reduce((s, v) => s + v, 0) / n, p95: a[Math.min(n - 1, Math.floor(n * 0.95))], max: a[n - 1] };
  }
}

// ?perf=1: a small corner readout.
export class PerfOverlay {
  constructor(game, boot) {
    this.game = game; this.boot = boot; this.acc = 0;
    this.el = Object.assign(document.createElement("div"), { className: "f2-perf" });
    this.el.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:20;font:11px/1.35 ui-monospace,monospace;background:#000b;color:#dfe;padding:4px 7px;border-radius:5px;pointer-events:none;white-space:pre";
    document.body.appendChild(this.el);
  }
  tick(dt) {
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const g = this.game, k = g.kit, b = this.boot, s = g.frameMeter.summary();
    let st = {}; try { st = k.stats(); } catch { /* engine gone */ }
    this.el.textContent =
      `world ${b.preset} ${g.world.n}² · detail ${DETAIL[g.detailLevel].name}\n` +
      `gen ${b.genMs | 0} ms · engine ${b.engineMs | 0} ms · init ${b.initMs | 0} ms · boot ${b.bootMs | 0} ms\n` +
      `js ${s.avg.toFixed(1)} ms (p95 ${s.p95.toFixed(1)}, max ${s.max.toFixed(1)})` +
      (k.frameMs ? ` · frame ${k.frameMs.toFixed(1)} ms (${(1000 / k.frameMs).toFixed(0)} fps)` : "") + `\n` +
      `q${k.quality} · ${(k.dpr || 1).toFixed(2)}x · ${st.primitives ?? "?"} prims · ${st.points ?? "?"} pts · ${g.treeCount} trees` +
      (g.frameMeter.errors ? ` · ${g.frameMeter.errors} frame errors` : "");
  }
}

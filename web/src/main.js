// Forward Two: boot. Loads the engine, builds the world (in a worker), then
// hands everything to the Game. Any failure shows a friendly error screen
// (ui/errors.js) instead of a blank canvas.
window.__f2Boot = "started";   // tells src/guard.js the modules loaded
import { assembleWorld, generateWorld } from "./world/terrain.js";
import { Game } from "./game/game.js";
import { readHints, pickTier, readPerf, clearSlow, forestDensity } from "./game/perf.js";
import { showError, errorWithCode } from "./ui/errors.js";

const q = new URLSearchParams(location.search);

// The world in a worker; on the main thread if the worker cannot start or
// fails (some browsers block module workers), so a worker problem costs a
// pause, not the game.
function buildInWorker(seed, preset, progress, forest = null) {
  const onMain = () => new Promise((r) => setTimeout(r, 0)).then(() => {
    try { return generateWorld(seed, preset, progress); } catch (e) { throw errorWithCode("world", e && e.message); }
  });
  return new Promise((resolve, reject) => {
    let worker, settled = false;
    const fallback = (why) => {
      if (settled) return; settled = true;
      try { worker?.terminate(); } catch (_) { /* gone */ }
      console.warn("world worker failed, building on the main thread:", why);
      onMain().then(resolve, reject);
    };
    try { worker = new Worker(new URL("./world/worker.js", import.meta.url), { type: "module" }); }
    catch (e) { fallback(e && e.message); return; }
    worker.onmessage = (e) => {
      const d = e.data || {};
      if (d.error) fallback(d.error);
      else if (d.progress != null) progress(d.progress, d.label);
      else if (d.grids) {
        if (settled) return; settled = true; worker.terminate();
        try {
          const w = assembleWorld(seed, preset, d.grids);
          if (d.forest) w.forest = d.forest;   // prebuilt meshes (game.js uses them when the density matches)
          resolve(w);
        } catch (err) { reject(errorWithCode("world", err && err.message)); }
      }
    };
    worker.onerror = (e) => { e.preventDefault?.(); fallback(e.message || "worker error"); };
    worker.onmessageerror = () => fallback("message error");
    worker.postMessage({ seed, preset, forest });
  });
}

async function loadEngine() {
  if (typeof WebAssembly !== "object") throw errorWithCode("no-wasm");
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "engine/forward-two.js"; s.onload = res;
    s.onerror = () => rej(errorWithCode("network", "engine/forward-two.js: script failed to load"));
    document.head.appendChild(s);
  });
  let res;
  try { res = await fetch("engine/forward-two.wasm"); } catch (e) { throw errorWithCode("network", `engine/forward-two.wasm: ${e.message}`); }
  if (!res.ok) throw errorWithCode("network", `engine/forward-two.wasm: HTTP ${res.status}`);
  const wasm = await res.arrayBuffer();
  if (typeof createForwardTwo !== "function") throw errorWithCode("network", "createForwardTwo is missing");
  try { return await createForwardTwo({ wasmBinary: wasm }); } catch (e) { throw errorWithCode("engine", e && e.message); }
}

async function boot() {
  const t0 = performance.now();
  const seed = Number(q.get("seed")) || 1;
  const tier = pickTier(readHints(), q, readPerf());
  const preset = tier.preset;
  if (q.get("world") === preset) clearSlow(preset);
  const perf = window.__f2perf = { preset, detail: tier.detail, reasons: tier.reasons };
  if (!StrataLoader.show({ title: "Forward Two", poster: "media/poster.jpg", fallback: { href: "https://github.com/Preponderous-Software/forward-two", text: "About Forward Two" } })) return;
  StrataLoader.progress(0.02, "Charting the Long Water");
  const worldP = buildInWorker(seed, preset, (f, label) => StrataLoader.progress(0.05 + f * 0.55, label === "Done" ? "Filling the rivers" : label),
    { density: forestDensity(preset, tier.detail), chunks: 4 })
    .then((w) => { perf.genMs = performance.now() - t0; return w; });
  // The engine downloads while the world builds.
  const modP = loadEngine().then((m) => { perf.engineMs = performance.now() - t0; return m; });
  const [world, mod] = await Promise.all([worldP, modP]);
  StrataLoader.progress(0.7, "Growing the forests");
  await new Promise((r) => setTimeout(r, 0));
  const game = new Game({ world, mod, canvas: document.getElementById("view"), ui: document.getElementById("ui"), params: q, tier });
  const ti = performance.now();
  await game.init((f, label) => StrataLoader.progress(0.7 + f * 0.3, label));
  perf.initMs = performance.now() - ti;
  StrataLoader.done();
  game.start();
  perf.bootMs = performance.now() - t0;
  window.__f2 = game;
  if (q.get("perf") === "1") {
    const { PerfOverlay } = await import("./game/perf.js");
    game.perfOverlay = new PerfOverlay(game, perf);
  }
}

boot().catch((e) => {
  console.error(e);
  try { showError(e); } catch (_) { /* nothing to show */ }
});

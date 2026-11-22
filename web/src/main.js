// Forward Two: boot. Loads the engine, builds the world (in a worker), then
// hands everything to the Game.
import { assembleWorld, generateWorld } from "./world/terrain.js";
import { Game } from "./game/game.js";

const q = new URLSearchParams(location.search);

function pickPreset() {
  const w = q.get("world");
  if (w === "small" || w === "full" || w === "tiny") return w;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const mem = navigator.deviceMemory || 8;
  return coarse || mem <= 4 ? "small" : "full";
}

function buildInWorker(seed, preset, progress) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL("./world/worker.js", import.meta.url), { type: "module" }); }
    catch (e) { resolve(generateWorld(seed, preset, progress)); return; }
    worker.onmessage = (e) => {
      if (e.data.progress != null) progress(e.data.progress, e.data.label);
      else if (e.data.grids) { worker.terminate(); resolve(assembleWorld(seed, preset, e.data.grids)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(e); };
    worker.postMessage({ seed, preset });
  });
}

async function boot() {
  const seed = Number(q.get("seed")) || 1;
  const preset = pickPreset();
  if (!StrataLoader.show({ title: "Forward Two", poster: "media/poster.jpg", fallback: { href: "https://github.com/Preponderous-Software/forward-two", text: "About Forward Two" } })) return;
  StrataLoader.progress(0.02, "Charting the Long Water");
  const worldP = buildInWorker(seed, preset, (f, label) => StrataLoader.progress(0.05 + f * 0.55, label === "Done" ? "Filling the rivers" : label));
  // The engine downloads while the world builds.
  const modP = (async () => {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "engine/forward-two.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    const wasm = await (await fetch("engine/forward-two.wasm")).arrayBuffer();
    return createForwardTwo({ wasmBinary: wasm });
  })();
  const [world, mod] = await Promise.all([worldP, modP]);
  StrataLoader.progress(0.7, "Growing the forests");
  await new Promise((r) => setTimeout(r, 0));
  const game = new Game({ world, mod, canvas: document.getElementById("view"), ui: document.getElementById("ui"), params: q });
  await game.init((f, label) => StrataLoader.progress(0.7 + f * 0.3, label));
  StrataLoader.done();
  game.start();
  window.__f2 = game;
}

boot().catch((e) => {
  console.error(e);
  try { StrataLoader.fallback("boot", String(e && e.message || e)); } catch (_) { /* nothing to show */ }
});

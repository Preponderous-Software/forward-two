// Friendly error screens: what went wrong in words a player can act on,
// instead of a blank canvas. describeError is pure (tested); showError
// uses the Strata loader's fallback when it is there and draws its own
// panel when it is not (the loader script itself failed to download).

const MESSAGES = {
  "no-webgl2": "This browser can't draw WebGL 2, which Forward Two needs. Try a current Chrome, Edge, Firefox or Safari, or turn on hardware acceleration.",
  "no-wasm": "This browser has WebAssembly switched off (iOS Lockdown Mode and some locked-down browsers do this), and Forward Two's engine needs it.",
  "network": "Forward Two didn't finish downloading. Check your connection and try again.",
  "engine": "The game's engine failed to start on this device.",
  "world": "Building the river valley failed on this device.",
  "crash": "Something went wrong while playing. Your last save is kept on this device.",
  "boot": "Something went wrong starting Forward Two.",
};

// e: an Error (optionally with .code) or anything thrown. env: {wasm} to
// override the WebAssembly check in tests. Returns {code, message, detail}.
export function describeError(e, env = {}) {
  const hasWasm = env.wasm ?? (typeof globalThis.WebAssembly === "object");
  const msg = String((e && e.message) || e || "");
  const name = (e && e.name) || "";
  let code = e && typeof e.code === "string" && MESSAGES[e.code] ? e.code : null;
  if (!code) {
    if (!hasWasm) code = "no-wasm";
    else if (/CompileError|LinkError|RuntimeError/.test(name)) code = "engine";
    else if (/Failed to fetch|NetworkError|Load failed|HTTP \d{3}|net::|script failed|Importing a module script failed|dynamically imported module|(StrataLoader|StrataKit|createForwardTwo) is not defined/i.test(msg)) code = "network";
    else if (/wasm|WebAssembly|createForwardTwo/i.test(msg)) code = "engine";
    else code = "boot";
  }
  return { code, message: MESSAGES[code], detail: msg.slice(0, 200) };
}

export function errorWithCode(code, message) { return Object.assign(new Error(message || code), { code }); }

export function showError(e) {
  const { code, message, detail } = describeError(e);
  const doc = globalThis.document;
  if (!doc) return { code, message };
  const L = globalThis.StrataLoader;
  let box = null;
  try {
    if (L && typeof L.fallback === "function") {
      L.fallback(code, message);
      box = doc.querySelector(".sk-loader .sk-box");
    }
  } catch { box = null; }
  if (!box) {
    const root = doc.createElement("div");
    root.setAttribute("role", "alert");
    root.style.cssText = "position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:#0d1b24;color:#f4efe6;font:16px/1.45 system-ui,sans-serif;padding:16px";
    box = doc.createElement("div");
    box.style.cssText = "max-width:520px;background:rgba(10,22,30,.85);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:18px 20px";
    const h = doc.createElement("h1"); h.textContent = "Forward Two"; h.style.cssText = "margin:0 0 8px;font-size:22px";
    const p = doc.createElement("p"); p.textContent = message; p.style.margin = "0 0 10px";
    box.append(h, p); root.appendChild(box); doc.body.appendChild(root);
  }
  if (detail) {
    const d = doc.createElement("p");
    d.textContent = detail; d.style.cssText = "margin:6px 0 0;font-size:12px;opacity:.7;word-break:break-word";
    box.appendChild(d);
  }
  if (code !== "no-webgl2" && code !== "no-wasm") {
    const b = doc.createElement("button");
    b.textContent = "Try again";
    b.style.cssText = "margin-top:10px;padding:8px 16px;border-radius:10px;border:0;background:#ff7a2f;color:#111;font:600 15px system-ui,sans-serif;cursor:pointer";
    b.onclick = () => globalThis.location.reload();
    box.appendChild(b);
  }
  return { code, message };
}

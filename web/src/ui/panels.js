// Full-screen panels: title, menu, camp, map, journal. Each is a card over
// the paused (title, menu, camp) or running (map, journal) game.
import { FEATS } from "../game/journal.js";
import { CAMPS, LANDMARKS } from "../game/places.js";
import { BOATS } from "../sim/boat.js";
import { fmt } from "../game/races.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Illustrated badges: a disc with a drawn icon.
const ART = {
  wave: '<path d="M14 44c6-8 10 4 16-4s10 4 16-4 8 2 8 2" stroke="#8be0ff"/><path d="M14 34c6-8 10 4 16-4s10 4 16-4" stroke="#fff"/>',
  line: '<path d="M16 46c10-4 6-14 16-16s8-12 16-14" stroke="#ffd166" stroke-dasharray="4 3"/><circle cx="22" cy="30" r="3" fill="#888" stroke="none"/><circle cx="42" cy="36" r="3" fill="#888" stroke="none"/>',
  throat: '<path d="M18 14l8 36M46 14l-8 36" stroke="#a99"/><path d="M32 14v36" stroke="#fff" stroke-dasharray="3 4"/>',
  falls: '<path d="M14 22h22v26h14" stroke="#9cf"/><path d="M36 24v22M40 24v20" stroke="#fff"/><circle cx="44" cy="48" r="4" stroke="#fff"/>',
  swim: '<circle cx="32" cy="26" r="6" stroke="#ffd166"/><path d="M14 42c6-6 12 6 18 0s12 6 18 0" stroke="#8be0ff"/>',
  flow: '<path d="M14 32c6-8 12 8 18 0s12-8 18 0" stroke="#ff7a2f"/><path d="M14 40c6-8 12 8 18 0s12-8 18 0" stroke="#ffd166"/>',
  moon: '<path d="M38 16a14 14 0 1 0 8 26 12 12 0 0 1-8-26z" stroke="#ffe9a8"/><circle cx="20" cy="20" r="1.5" fill="#fff" stroke="none"/>',
  tent: '<path d="M14 46l18-28 18 28z" stroke="#ff9a3c"/><path d="M32 18v28" stroke="#ff9a3c"/>',
  map: '<path d="M14 20l12-4 12 4 12-4v28l-12 4-12-4-12 4z" stroke="#cfe"/><path d="M22 30l6 4 8-8" stroke="#ff7a2f"/>',
  crate: '<rect x="18" y="22" width="28" height="22" stroke="#c49a6c"/><path d="M18 22l28 22M46 22L18 44" stroke="#c49a6c"/>',
  medal: '<circle cx="32" cy="36" r="10" stroke="#ffd166"/><path d="M26 14l6 12 6-12" stroke="#ff7a2f"/>',
  sea: '<path d="M14 40c6-6 12 6 18 0s12 6 18 0" stroke="#4cc3ff"/><circle cx="44" cy="22" r="6" stroke="#ffd166"/>',
  camp: '<path d="M16 44l16-24 16 24z" stroke="#ff9a3c"/><path d="M28 44l4-6 4 6" stroke="#ffd166"/>',
  spring: '<path d="M20 40c0-10 24-10 24 0" stroke="#aaa"/><path d="M32 40v8" stroke="#8be0ff"/>',
  arch: '<path d="M16 46V30a16 16 0 0 1 32 0v16M24 46V32a8 8 0 0 1 16 0v14" stroke="#bbb"/>',
  hotspring: '<ellipse cx="32" cy="42" rx="14" ry="5" stroke="#8be0ff"/><path d="M26 34c-3-4 3-6 0-10M34 34c-3-4 3-6 0-10" stroke="#ddd"/>',
  bridge: '<path d="M12 30h40" stroke="#bbb"/><path d="M18 30v16M32 34v12M46 30v16" stroke="#bbb"/><path d="M36 30l6-6" stroke="#bbb"/>',
  isle: '<path d="M32 16l-8 14h16zM32 22l-10 16h20z" stroke="#5c5"/><path d="M14 44c8-4 28-4 36 0" stroke="#8be0ff"/>',
  wheel: '<circle cx="32" cy="32" r="13" stroke="#c49a6c"/><path d="M32 19v26M19 32h26M23 23l18 18M41 23L23 41" stroke="#c49a6c"/>',
  rookery: '<path d="M22 46V24M22 28l-6-6M22 30l6-6" stroke="#bbb"/><path d="M36 22c4-4 10-2 12 2-4 0-6 2-8 4" stroke="#ddd"/>',
  lighthouse: '<path d="M26 48l3-28h6l3 28z" stroke="#f66"/><path d="M38 22l12-4M38 26l12 4" stroke="#ffd166"/>',
  falls2: '<path d="M14 22h22v26h14" stroke="#9cf"/>',
};
const badge = (icon, on) => `<svg class="badge" viewBox="0 0 64 64" style="width:72px;height:72px"><circle cx="32" cy="32" r="29" fill="${on ? "#163447" : "#1a1f22"}" stroke="${on ? "#ffd166" : "#444"}" stroke-width="2"/><g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${on ? ART[icon] || "" : '<text x="32" y="40" font-size="22" text-anchor="middle" fill="#555" stroke="none">?</text>'}</g></svg>`;
export { badge };

class Panel {
  constructor(game, root, cls = "") {
    this.game = game;
    this.el = document.createElement("div");
    this.el.className = "panel " + cls;
    this.el.addEventListener("pointerdown", (e) => { if (e.target === this.el && this.dismissable) this.close(); });
    root.appendChild(this.el);
    this.dismissable = true;
    this.pauses = true;
  }
  isOpen() { return this.el.classList.contains("open"); }
  open() { this.render(); this.el.classList.add("open"); if (this.pauses) this.game.paused = true; this.game.audio?.unlock?.(); const f = this.el.querySelector("[autofocus], .btn"); f && f.focus(); }
  close() { this.el.classList.remove("open"); if (this.pauses) this.game.paused = false; this.game.canvas.focus(); }
  render() {}
}

export class TitlePanel extends Panel {
  constructor(game, root) { super(game, root, "title"); this.dismissable = false; }
  render() {
    const g = this.game, saved = g.save.load();
    const touch = g.input.touch;
    this.el.innerHTML = `<div class="card title-card">
      <div class="kicker">The sequel to Forward One</div>
      <h1>Forward Two</h1>
      <p>The Long Water runs from Tarn Spring in the mountains, over the High Falls, through the Meadows and the Gorge, across Mirror Lake and out to the sea at Saltmouth. Your boat is at Meadow Fork. Go anywhere the water goes.</p>
      <p>On flat water, paddle where you like. In a rapid, the guide calls each stroke on the beat. Hit the call as its marker reaches the gate and you'll run the clean line.</p>
      <div class="keys">${touch
        ? `<div><b>▲</b> forward stroke</div><div><b>▼</b> back stroke</div><div><b>◀ ▶</b> turn left or right</div><div>Drag to look around</div><div>Map and journal: top right</div>`
        : `<div><kbd>W</kbd>/<kbd>↑</kbd>/<kbd>Space</kbd> forward</div><div><kbd>S</kbd>/<kbd>↓</kbd> back</div><div><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> turn</div><div><kbd>E</kbd> go ashore at a camp</div><div><kbd>M</kbd> map · <kbd>J</kbd> journal</div><div><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> wave, flare, bell</div>`}
      </div>
      <div class="row">
        <button class="btn" id="t-go" autofocus>${saved ? "Continue" : "Push off"}</button>
        <label class="small">Name <input type="text" id="t-name" maxlength="16" value="${esc(g.net?.profile?.name || "")}" autocomplete="off"></label>
        <span class="small" id="t-net">${g.net?.online ? `<span class="online">● online</span> · ${g.net.players.size} on the river` : "Offline: ghosts and times stay on this device"}</span>
      </div>
    </div>`;
    this.el.querySelector("#t-go").onclick = () => { const n = this.el.querySelector("#t-name").value.trim(); if (n) g.net?.setName?.(n); this.close(); g.hud.toast("Push off downstream, or paddle up to the Brightwater. Your call."); };
  }
}

export class MenuPanel extends Panel {
  render() {
    const g = this.game;
    this.el.innerHTML = `<div class="card"><button class="btn ghost close" data-x>Close</button><h2>Paused</h2>
      <div class="row" style="margin-bottom:14px"><button class="btn" data-x>Resume</button><button class="btn ghost" id="m-map">Map</button><button class="btn ghost" id="m-journal">Journal</button></div>
      <h3>You</h3>
      <div class="row"><input type="text" id="m-name" maxlength="16" value="${esc(g.net?.profile?.name || "")}" aria-label="Name"><input type="color" id="m-colour" value="${toHex(g.colour || g.boat.spec.colour)}" aria-label="Boat colour"><span class="small">${g.net?.online ? `<span class="online">● online</span> · ${g.net.players.size} other paddlers` : "offline"}</span></div>
      <h3>Settings</h3>
      <div class="row">
        <button class="btn ghost" id="m-cam">Camera: ${g.freeCamera ? "free" : "follows boat"}</button>
        <button class="btn ghost" id="m-snd">Sound: ${g.audio?.muted ? "off" : "on"}</button>
        <button class="btn ghost" id="m-q">Quality: ${["low", "medium", "high"][g.kit.quality]}</button>
      </div>
      <h3>Game</h3>
      <div class="row"><button class="btn ghost" id="m-save">Save now</button><button class="btn ghost" id="m-new">New game…</button><a class="btn ghost" href="https://github.com/Preponderous-Software/forward-two" target="_blank" rel="noopener">About</a></div>
      <p class="small">Forward Two is the sequel to <a href="https://github.com/McElyea/forward-one" target="_blank" rel="noopener" style="color:inherit">Forward One</a> by Jon McElyea. Built on Strata. MIT licensed.</p></div>`;
    const $ = (s) => this.el.querySelector(s);
    this.el.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => this.close()));
    $("#m-map").onclick = () => { this.close(); g.hud.action("map"); };
    $("#m-journal").onclick = () => { this.close(); g.hud.action("journal"); };
    $("#m-name").onchange = (e) => g.net?.setName?.(e.target.value.trim());
    $("#m-colour").onchange = (e) => { g.colour = fromHex(e.target.value); g.makeBoatMeshes(g.boat.kind); g.net?.setColour?.(g.colour); g.save.soon(); };
    $("#m-cam").onclick = () => { g.freeCamera = !g.freeCamera; this.render(); };
    $("#m-snd").onclick = () => { g.audio?.setMuted?.(!g.audio.muted); this.render(); };
    $("#m-q").onclick = () => { g.kit.setQuality((g.kit.quality + 1) % 3); this.render(); };
    $("#m-save").onclick = () => { g.save.write(); g.hud.toast("Saved."); };
    $("#m-new").onclick = () => { if (confirm("Start over? Your journal and pay will be lost.")) { g.save.wipe(); location.search = "?new=1"; } };
  }
}

export class CampPanel extends Panel {
  openAt(c) { this.camp = c; this.tab = "camp"; this.open(); }
  render() {
    const g = this.game, c = this.camp; if (!c) return;
    const owned = g.boatsOwned || new Set(["raft"]);
    const prices = { raft: 0, kayak: 60, canoe: 90, dory: 180 };
    const jobs = g.jobs.board(c);
    const shuttle = g.places.camps.filter((x) => x !== c && g.journal.has(x.id));
    const tabs = ["camp", "boats", "jobs", "shuttle"].map((t) => `<button class="btn ${this.tab === t ? "" : "ghost"}" data-tab="${t}">${{ camp: "Camp", boats: "Boats", jobs: "Jobs", shuttle: "Shuttle" }[t]}</button>`).join("");
    let body = "";
    if (this.tab === "camp") body = `<p>${esc(c.blurb)}</p><div class="row"><button class="btn" id="c-rest">Rest until ${g.night > 0.5 ? "morning" : "evening"}</button><span class="small">Repairs your boat and saves.</span></div><p class="small">Hull ${(g.boat.hull * 100).toFixed(0)}% · Pay ${g.journal.pay}</p>`;
    if (this.tab === "boats") body = `<div class="tiles">${Object.entries(BOATS).map(([k, b]) => `<button class="tile ${g.boat.kind === k ? "sel" : ""}" data-boat="${k}"><b>${b.name}</b>${owned.has(k) ? (g.boat.kind === k ? "in use" : "take it") : `${prices[k]} pay`}<br><span class="small">speed ${"●".repeat(Math.round(b.top / 2))} · turn ${"●".repeat(Math.round(b.turn * 2))} · steady ${"●".repeat(Math.round(b.stability * 3))} · cargo ${b.cargo}</span></button>`).join("")}</div>`;
    if (this.tab === "jobs") body = (g.jobs.active ? `<div class="list"><div class="item"><span>Carrying ${esc(g.jobs.active.good)} to ${esc(g.jobs.active.toName)}</span><button class="btn ghost" id="c-drop">Leave it</button></div></div>` : "") +
      `<div class="list" style="margin-top:10px">${jobs.map((j, i) => `<div class="item"><span><b>${esc(j.good)}</b> to ${esc(j.toName)} <span class="tag">${j.dist} m</span>${j.upstream ? '<span class="tag">upstream</span>' : ""}${j.fragile ? '<span class="tag">fragile</span>' : ""}<br><span class="small">${j.hours} hours · ${j.pay} pay</span></span><button class="btn" data-job="${i}" ${g.jobs.active ? "disabled" : ""}>Take</button></div>`).join("")}</div>`;
    if (this.tab === "shuttle") body = shuttle.length ? `<p class="small">The shuttle truck drives you and your boat to any camp you've found. It takes a few hours.</p><div class="list">${shuttle.map((x) => `<div class="item"><span>${esc(x.name)}</span><button class="btn" data-go="${x.id}">Go</button></div>`).join("")}</div>` : `<p>Find other camps first. The truck only goes where you've been.</p>`;
    this.el.innerHTML = `<div class="card"><button class="btn ghost close" data-x>Push off</button><h2>${esc(c.name)}</h2><div class="row" style="margin-bottom:12px">${tabs}</div>${body}</div>`;
    this.el.querySelector("[data-x]").onclick = () => this.close();
    this.el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; this.render(); }));
    const rest = this.el.querySelector("#c-rest");
    if (rest) rest.onclick = () => { g.restAt(c); this.render(); };
    this.el.querySelectorAll("[data-boat]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.boat;
      if (!owned.has(k)) { if (g.journal.pay < prices[k]) { g.hud.toast(`You need ${prices[k]} pay.`); return; } g.journal.pay -= prices[k]; owned.add(k); g.boatsOwned = owned; }
      if (g.boat.kind !== k) g.setBoat(k);
      g.save.soon(); this.render();
    }));
    this.el.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => { g.jobs.take(jobs[+b.dataset.job]); this.render(); }));
    const drop = this.el.querySelector("#c-drop"); if (drop) drop.onclick = () => { g.jobs.abandon(); this.render(); };
    this.el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { g.shuttleTo(g.places.camps.find((x) => x.id === b.dataset.go)); this.close(); }));
  }
}

export class JournalPanel extends Panel {
  constructor(game, root) { super(game, root); this.pauses = false; }
  render() {
    const g = this.game, j = g.journal;
    const places = [...CAMPS.map((c) => ({ ...c, icon: "camp" })), ...LANDMARKS.map((l) => ({ ...l, icon: l.kind === "falls" ? "falls" : l.kind === "throat" ? "throat" : l.kind }))];
    const races = g.races.courses.map((c) => { const b = g.races.best[c.id]; return `<div class="item"><span><b>${esc(c.name)}</b> <span class="small">${Math.round(c.length)} m · gold ${fmt(c.medals.gold)}</span></span><span>${b ? `${fmt(b.ms / 1000)} ${b.medal ? `<span class="tag">${b.medal}</span>` : ""}` : '<span class="small">not run</span>'}</span></div>`; }).join("");
    this.el.innerHTML = `<div class="card"><button class="btn ghost close" data-x>Close</button><h2>River Journal</h2>
      <p class="small">${j.found.size} of ${places.length} places · ${j.feats.size} of ${FEATS.length} feats · ${j.pay} pay · ${j.deliveries} deliveries</p>
      <h3>Places</h3><div class="tiles">${places.map((p) => `<div class="tile ${j.has(p.id) ? "" : "locked"}" tabindex="0" title="${j.has(p.id) ? esc(p.blurb) : "Not found yet"}">${badge(p.icon, j.has(p.id))}<b>${j.has(p.id) ? esc(p.name) : "Unknown"}</b>${j.has(p.id) ? `<span class="small">${esc(p.blurb)}</span>` : ""}</div>`).join("")}</div>
      <h3>Feats</h3><div class="tiles">${FEATS.map((f) => `<div class="tile ${j.feats.has(f.id) ? "" : "locked"}" tabindex="0">${badge(f.icon, j.feats.has(f.id))}<b>${esc(f.name)}</b><span class="small">${esc(f.text)}</span></div>`).join("")}</div>
      <h3>Races</h3><div class="list">${races}</div></div>`;
    this.el.querySelector("[data-x]").onclick = () => this.close();
  }
}

export class MapPanel extends Panel {
  constructor(game, root) { super(game, root); this.pauses = false; }
  render() {
    const g = this.game;
    this.el.innerHTML = `<div class="card" style="width:min(860px,100%)"><button class="btn ghost close" data-x>Close</button><h2>The Long Water</h2><div class="mapwrap"><canvas width="1024" height="1024" aria-label="Map"></canvas></div><p class="small">${g.journal.found.size} places found. Fog lifts where you've paddled.</p></div>`;
    this.el.querySelector("[data-x]").onclick = () => this.close();
    this.canvas = this.el.querySelector("canvas");
    if (!this.base) this.base = this.paintBase();
    this.draw();
  }

  paintBase() {
    const w = this.game.world, N = 512, c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d"), img = ctx.createImageData(N, N);
    const shade = (i, j) => {
      const gi = Math.min(w.n - 2, Math.floor(i / N * w.n)), gj = Math.min(w.n - 2, Math.floor(j / N * w.n)), k = gj * w.n + gi;
      const hx = w.heights[k + 1] - w.heights[k], hz = w.heights[k + w.n] - w.heights[k];
      return { k, light: 0.85 + (-hx - hz) * 0.04 };
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const { k, light } = shade(i, j), o = (j * N + i) * 4;
      let r, g2, b;
      if (!Number.isNaN(w.water[k])) { r = 40; g2 = 110; b = 150; }
      else { r = Math.pow(w.colors[k * 3], 1 / 2.2) * 255 * light; g2 = Math.pow(w.colors[k * 3 + 1], 1 / 2.2) * 255 * light; b = Math.pow(w.colors[k * 3 + 2], 1 / 2.2) * 255 * light; }
      // Parchment tint.
      img.data[o] = r * 0.8 + 50; img.data[o + 1] = g2 * 0.8 + 42; img.data[o + 2] = b * 0.8 + 28; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  draw() {
    if (!this.isOpen() && this.canvas && !this.el.classList.contains("open")) return;
    const g = this.game, w = g.world, ctx = this.canvas.getContext("2d"), S = this.canvas.width, k = S / w.size;
    ctx.drawImage(this.base, 0, 0, S, S);
    // Fog.
    const cell = S / 64;
    ctx.fillStyle = "rgba(20,18,14,0.82)";
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) if (!g.journal.explored[j * 64 + i]) ctx.fillRect(i * cell - 0.5, j * cell - 0.5, cell + 1, cell + 1);
    // Rivers' names along their lines (where explored).
    ctx.font = "bold 22px system-ui, sans-serif"; ctx.textAlign = "center";
    const icon = (x, y, col, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#0008"; ctx.stroke(); };
    for (const c of g.places.camps) {
      if (!g.journal.has(c.id)) continue;
      icon(c.x * k, c.z * k, "#ff9a3c", 9);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000a"; ctx.lineWidth = 4; ctx.strokeText(c.name, c.x * k, c.z * k - 16); ctx.fillText(c.name, c.x * k, c.z * k - 16);
    }
    ctx.font = "16px system-ui, sans-serif";
    for (const l of g.places.landmarks) {
      if (!g.journal.has(l.id)) continue;
      icon(l.x * k, l.z * k, "#ffd166", 6);
      ctx.fillStyle = "#ffe"; ctx.strokeStyle = "#000a"; ctx.lineWidth = 3; ctx.strokeText(l.name, l.x * k, l.z * k + 22); ctx.fillText(l.name, l.x * k, l.z * k + 22);
    }
    const d = g.jobs.dest();
    if (d) { ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(d.x * k, d.z * k, 16 + Math.sin(g.time * 4) * 3, 0, Math.PI * 2); ctx.stroke(); }
    for (const p of g.net?.players?.values?.() || []) {
      const s = p.samples && p.samples[p.samples.length - 1]; if (!s) continue;
      icon(s.x * k, s.z * k, "#4cc3ff", 6);
    }
    // You.
    const b = g.boat, x = b.x * k, y = b.z * k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(b.heading);
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, 9); ctx.lineTo(-5, 0); ctx.lineTo(-10, -9); ctx.closePath();
    ctx.fillStyle = "#ff3b30"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.restore();
  }

  update() { if (this.isOpen()) { this.t = (this.t || 0) + 1; if (this.t % 10 === 0) this.draw(); } }
}

function toHex(c) { return "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join(""); }
function fromHex(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); }

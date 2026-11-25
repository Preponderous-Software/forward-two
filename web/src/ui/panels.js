// Full-screen panels: title, menu, camp, map, journal. Each is a card over
// the paused (title, menu, camp) or running (map, journal) game.
import { FEATS } from "../game/journal.js";
import { CAMPS, LANDMARKS } from "../game/places.js";
import { BOATS } from "../sim/boat.js";
import { fmt } from "../game/races.js";
import { ART, badge, placeBadge } from "./badges.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Boats side-on, in their colours, for the boat rack.
const BOAT_ART = {
  raft: '<path d="M6 30h52a6 6 0 0 1-6 8H12a6 6 0 0 1-6-8z" fill="C"/><circle cx="18" cy="22" r="3.5" fill="#f2c94c"/><circle cx="32" cy="22" r="3.5" fill="#f2c94c"/><circle cx="46" cy="22" r="3.5" fill="#f2c94c"/><path d="M16 26h4v4h-4zM30 26h4v4h-4zM44 26h4v4h-4z" fill="#ff7a2f"/>',
  kayak: '<path d="M4 31c14-6 42-6 56 0-14 5-42 5-56 0z" fill="C"/><circle cx="32" cy="20" r="3.5" fill="#f2c94c"/><path d="M29 24h6v5h-6z" fill="#3a7bd5"/><path d="M14 12l36 20" stroke="#ddd" stroke-width="2"/>',
  canoe: '<path d="M4 26c2 6 8 10 14 10h28c6 0 12-4 14-10-18 3-38 3-56 0z" fill="C"/><circle cx="20" cy="18" r="3.5" fill="#f2c94c"/><circle cx="44" cy="18" r="3.5" fill="#f2c94c"/><path d="M28 24h8v6h-8z" fill="#8a6a48"/>',
  dory: '<path d="M4 20l6 16h44l6-18c-18 4-38 4-56 2z" fill="C"/><path d="M10 26h44" stroke="#eee" stroke-width="2"/><circle cx="32" cy="14" r="3.5" fill="#f2c94c"/>',
};
const boatArt = (k, colour) => `<svg class="boatart" viewBox="0 0 64 44">${(BOAT_ART[k] || "").replace(/fill="C"/g, `fill="${toHex(colour)}" stroke="#0006" stroke-width="1.5"`)}</svg>`;
const pips = (n, max = 5) => `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;

const TAB_ICON = {
  camp: '<svg viewBox="0 0 24 24"><path d="M3 20L12 5l9 15z"/><path d="M10 20l2-4 2 4"/></svg>',
  boats: '<svg viewBox="0 0 24 24"><path d="M2 13h20l-3 5H5z"/><path d="M12 13V4l6 7"/></svg>',
  jobs: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="1"/><path d="M4 7l16 12M20 7L4 19"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/></svg>',
  shuttle: '<svg viewBox="0 0 24 24"><path d="M2 16V8h11v8M13 11h5l4 4v1H2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
};

// A small stat chip: a ring that fills with progress, an icon and a count.
const chip = (icon, have, total, colour) => {
  const f = total ? Math.min(1, have / total) : 1, C = 2 * Math.PI * 29;
  return `<span class="chip"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" stroke="#ffffff1f" stroke-width="5"/><circle cx="32" cy="32" r="29" transform="rotate(-90 32 32)" stroke="${colour}" stroke-width="5" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}"/><g transform="translate(6.4 6.4) scale(.8)" stroke-width="3.5">${ART[icon] || ""}</g></svg><b>${have}</b>${total ? `<i>/${total}</i>` : ""}</span>`;
};
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
    this.el.querySelector("#t-go").onclick = () => { const n = this.el.querySelector("#t-name").value.trim(); if (n) g.net?.setProfile?.({ name: n }); this.close(); g.hud.toast("Push off downstream, or paddle up to the Brightwater. Your call."); };
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
    $("#m-name").onchange = (e) => g.net?.setProfile?.({ name: e.target.value.trim() });
    $("#m-colour").onchange = (e) => { g.colour = fromHex(e.target.value); g.makeBoatMeshes(g.boat.kind); g.net?.setProfile?.({ colour: g.colour }); g.save.soon(); };
    $("#m-cam").onclick = () => { g.freeCamera = !g.freeCamera; this.render(); };
    $("#m-snd").onclick = () => { g.audio?.setMuted?.(!g.audio.muted); this.render(); };
    $("#m-q").onclick = () => { g.kit.setQuality((g.kit.quality + 1) % 3); this.render(); };
    $("#m-save").onclick = () => { g.save.write(); g.hud.toast("Saved."); };
    $("#m-new").onclick = () => { if (confirm("Start over? Your journal and pay will be lost.")) { if (g.save.wipe() === false) { g.hud.toast(g.save.readOnly === "newer" ? "This save is from a newer version of the game; open it there. Nothing was changed." : g.save.readOnly === "other-world" ? "The save here belongs to another world, so nothing was changed." : "Couldn't keep a copy of your save (storage full), so nothing was changed.", 5); return; } location.search = "?new=1"; } };
  }
}

export class CampPanel extends Panel {
  openAt(c, tab = "camp") { this.camp = c; this.tab = tab; this.open(); }
  render() {
    const g = this.game, c = this.camp; if (!c) return;
    const owned = g.boatsOwned || new Set(["raft"]);
    const prices = { raft: 0, kayak: 60, canoe: 90, dory: 180 };
    const jobs = g.jobs.board(c);
    const shuttle = g.places.camps.filter((x) => x !== c && (g.journal.has(x.id) || g.progress?.shuttleOK?.(x.id)));
    const tabs = ["camp", "boats", "gear", "jobs", "shuttle"].map((t) => `<button class="btn tab ${this.tab === t ? "" : "ghost"}" data-tab="${t}">${TAB_ICON[t]}${{ camp: "Camp", boats: "Boats", gear: "Gear", jobs: "Jobs", shuttle: "Shuttle" }[t]}</button>`).join("");
    let body = "";
    if (this.tab === "camp") body = `<p>${esc(c.blurb)}</p><div class="row"><button class="btn" id="c-rest">Rest until ${g.night > 0.5 ? "morning" : "evening"}</button><span class="small">Repairs your boat and saves.</span></div><p class="small">Hull ${(g.boat.hull * 100).toFixed(0)}% · Pay ${g.journal.pay}</p>`;
    if (this.tab === "boats") body = `<div class="tiles">${Object.entries(BOATS).map(([k, b]) => `<button class="tile ${g.boat.kind === k ? "sel" : ""}" data-boat="${k}">${boatArt(k, k === g.boat.kind && g.colour ? g.colour : b.colour)}<b>${b.name}</b>${owned.has(k) ? (g.boat.kind === k ? "in use" : "take it") : `<span class="price">${prices[k]} pay</span>`}<span class="stats" aria-label="speed ${Math.round(b.top / 2)}, turn ${Math.round(b.turn * 2)}, steady ${Math.round(b.stability * 3)}, cargo ${b.cargo}"><span>speed</span>${pips(Math.round(b.top / 2))}<span>turn</span>${pips(Math.round(b.turn * 2))}<span>steady</span>${pips(Math.round(b.stability * 3))}<span>cargo</span>${pips(b.cargo)}</span></button>`).join("")}</div>`;
    if (this.tab === "gear") body = g.progress?.gearHtml() || "";
    if (this.tab === "jobs") body = (g.jobs.active ? `<div class="list"><div class="item"><span>Carrying ${esc(g.jobs.active.good)} to ${esc(g.jobs.active.toName)}</span><button class="btn ghost" id="c-drop">Leave it</button></div></div>` : "") +
      `<div class="list" style="margin-top:10px">${jobs.map((j, i) => `<div class="item"><span>${j.label ? `<b>${esc(j.label)}</b>` : `<b>${esc(j.good)}</b> to ${esc(j.toName)}`} <span class="tag">${j.dist} m</span>${j.kind && j.kind !== "delivery" ? `<span class="tag">${j.kind}</span>` : ""}${j.upstream ? '<span class="tag">upstream</span>' : ""}${j.fragile ? '<span class="tag">fragile</span>' : ""}<br><span class="small">${j.hours} hours · ${j.pay} pay</span></span><button class="btn" data-job="${i}" ${g.jobs.active ? "disabled" : ""}>Take</button></div>`).join("")}</div>`;
    if (this.tab === "shuttle") body = shuttle.length ? `<p class="small">The shuttle truck drives you and your boat to any camp you've found. It takes a few hours.${g.jobs.active ? " The driver takes half the pay for your job." : ""}</p><div class="list">${shuttle.map((x) => `<div class="item"><span>${esc(x.name)}${g.journal.has(x.id) ? "" : ' <span class="tag">Wren\'s letter</span>'}</span><button class="btn" data-go="${x.id}">Go</button></div>`).join("")}</div>` : `<p>Find other camps first. The truck only goes where you've been.</p>`;
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
    this.el.querySelectorAll("[data-gear]").forEach((b) => (b.onclick = () => { g.progress?.buy(b.dataset.gear); this.render(); }));
    this.el.querySelectorAll("[data-light]").forEach((b) => (b.onclick = () => { g.progress?.fund(); this.render(); }));
    this.el.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => { g.jobs.take(jobs[+b.dataset.job]); this.render(); }));
    const drop = this.el.querySelector("#c-drop"); if (drop) drop.onclick = () => { g.jobs.abandon(); this.render(); };
    this.el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { g.shuttleTo(g.places.camps.find((x) => x.id === b.dataset.go)); this.close(); }));
  }
}

export class JournalPanel extends Panel {
  constructor(game, root) { super(game, root, "journal"); this.pauses = false; }
  render() {
    const g = this.game, j = g.journal;
    const places = [...CAMPS, ...LANDMARKS];
    const races = g.races.courses.map((c) => { const b = g.races.best[c.id]; return `<div class="item"><span><b>${esc(c.name)}</b> <span class="small">${Math.round(c.length)} m · gold ${fmt(c.medals.gold)}</span></span><span>${b ? `${fmt(b.ms / 1000)} ${b.medal ? `<span class="tag ${esc(b.medal)}">${b.medal}</span>` : ""}` : '<span class="small">not run</span>'}</span></div>`; }).join("");
    // Tiles show the badge and a name; the details open on tap or focus.
    const tile = (on, art, name, text) => `<div class="tile ${on ? "" : "locked"}" tabindex="0" title="${esc(text)}">${art}<b>${esc(name)}</b><span class="small">${esc(text)}</span></div>`;
    this.el.innerHTML = `<div class="card"><button class="btn ghost close" data-x>Close</button><h2>River Journal</h2>
      <div class="chips" aria-label="${j.found.size} of ${places.length} places, ${j.feats.size} of ${FEATS.length} feats, ${j.pay} pay, ${j.deliveries} deliveries">${chip("map", j.found.size, places.length, "#8be0ff")}${chip("medal", j.feats.size, FEATS.length, "#ffd166")}${chip("crate", j.deliveries, 0, "#c49a6c")}<span class="chip pay"><b>${j.pay}</b><i>pay</i></span></div>
      ${g.progress?.journalHtml?.(badge) || ""}
      <h3>Places</h3><div class="tiles">${places.map((p) => tile(j.has(p.id), placeBadge(p, j.has(p.id)), j.has(p.id) ? p.name : "Unknown", j.has(p.id) ? p.blurb : "Not found yet")).join("")}</div>
      <h3>Feats</h3><div class="tiles">${FEATS.map((f) => tile(j.feats.has(f.id), badge(f.icon, j.feats.has(f.id), { feat: true }), f.name, f.text)).join("")}</div>
      <h3>Races</h3><div class="list">${races}</div></div>`;
    this.el.querySelector("[data-x]").onclick = () => this.close();
  }
}

export class MapPanel extends Panel {
  constructor(game, root) { super(game, root); this.pauses = false; }
  render() {
    const g = this.game;
    this.el.innerHTML = `<div class="card" style="width:min(860px,100%)"><button class="btn ghost close" data-x>Close</button><h2>The Long Water</h2><div class="mapwrap"><canvas width="1024" height="1024" aria-label="Map"></canvas></div><p class="small">${g.journal.found.size} places found. Fog lifts where you've paddled.</p>${g.progress ? `<p class="small">${g.progress.mapLegend()}</p>` : ""}</div>`;
    this.el.querySelector("[data-x]").onclick = () => this.close();
    this.canvas = this.el.querySelector("canvas");
    if (!this.base) this.base = this.paintBase();
    this.draw();
  }

  paintBase() {
    const w = this.game.world, N = 512, c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d"), img = ctx.createImageData(N, N);
    const H = (gi, gj) => w.heights[Math.min(w.n - 1, Math.max(0, gj)) * w.n + Math.min(w.n - 1, Math.max(0, gi))];
    const st = Math.max(1, Math.round(w.n / N) * 2);   // a few cells across, so the shading is soft
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gi = Math.min(w.n - 2, Math.floor(i / N * w.n)), gj = Math.min(w.n - 2, Math.floor(j / N * w.n)), k = gj * w.n + gi;
      const hx = (H(gi + st, gj) - H(gi - st, gj)) / (2 * st), hz = (H(gi, gj + st) - H(gi, gj - st)) / (2 * st);
      const light = 0.9 + Math.max(-0.28, Math.min(0.22, (-hx - hz) / w.cell * 0.25));
      const o = (j * N + i) * 4;
      let r, g2, b;
      const wl = w.water[k];
      if (!Number.isNaN(wl)) {
        const d = Math.min(1, Math.max(0, (wl - w.heights[k]) / 8));
        r = 70 - 40 * d; g2 = 140 - 45 * d; b = 165 - 25 * d;
      } else { r = Math.pow(w.colors[k * 3], 1 / 2.2) * 255 * light; g2 = Math.pow(w.colors[k * 3 + 1], 1 / 2.2) * 255 * light; b = Math.pow(w.colors[k * 3 + 2], 1 / 2.2) * 255 * light; }
      // Parchment tint.
      img.data[o] = r * 0.8 + 50; img.data[o + 1] = g2 * 0.8 + 42; img.data[o + 2] = b * 0.8 + 28; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // An inked edge on the water, a vignette and a compass rose.
    ctx.globalCompositeOperation = "multiply";
    const v = ctx.createRadialGradient(N / 2, N / 2, N * 0.35, N / 2, N / 2, N * 0.75);
    v.addColorStop(0, "#ffffff"); v.addColorStop(1, "#b8a888");
    ctx.fillStyle = v; ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = "source-over";
    ctx.save(); ctx.translate(46, N - 52); ctx.strokeStyle = "#3a2e1ecc"; ctx.fillStyle = "#3a2e1ecc"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
    for (let q = 0; q < 4; q++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.closePath(); q === 3 ? ctx.fill() : ctx.stroke(); }
    ctx.font = "bold 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", 0, -30);
    ctx.restore();
    return c;
  }

  // The fog as a soft-edged layer: one texel per explored cell, scaled up smoothly.
  fogLayer() {
    const g = this.game, f = this.fog || (this.fog = document.createElement("canvas"));
    f.width = f.height = 64;
    const fx = f.getContext("2d"), im = fx.createImageData(64, 64);
    for (let q = 0; q < 64 * 64; q++) { im.data[q * 4] = 22; im.data[q * 4 + 1] = 19; im.data[q * 4 + 2] = 15; im.data[q * 4 + 3] = g.journal.explored[q] ? 0 : 214; }
    fx.putImageData(im, 0, 0);
    return f;
  }

  draw() {
    if (!this.canvas) return;
    const g = this.game, w = g.world, ctx = this.canvas.getContext("2d"), S = this.canvas.width, k = S / w.size;
    ctx.drawImage(this.base, 0, 0, S, S);
    // Fog.
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.fogLayer(), 0, 0, S, S);
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
    g.progress?.drawMap?.(ctx, k);
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

// Who's on the river: names, boats (or ashore), how far away.
export class PlayersPanel extends Panel {
  constructor(game, root) { super(game, root); this.pauses = false; }
  render() {
    const g = this.game, net = g.net, me = g.pos();
    const rows = [...(net?.players?.values?.() || [])].map((p) => {
      const s = p.samples && p.samples[p.samples.length - 1];
      const d = s ? Math.round(Math.hypot(s.x - me.x, s.z - me.z)) : null;
      const what = p.boat === "walker" ? "ashore" : (BOATS[p.boat]?.name || "boat").toLowerCase();
      return { name: p.name || "Paddler", what, d };
    }).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
    const body = !net?.online
      ? `<p>Offline. Ghosts and race times stay on this device until the relay answers.</p>`
      : rows.length
        ? `<div class="list">${rows.map((r) => `<div class="item"><span><b>${esc(r.name)}</b> <span class="tag">${esc(r.what)}</span></span><span class="small">${r.d == null ? "" : r.d < 1000 ? `${r.d} m away` : `${(r.d / 1000).toFixed(1)} km away`}</span></div>`).join("")}</div>`
        : `<p>Nobody else is on the river right now. The ghosts of earlier runs are still on every race course.</p>`;
    this.el.innerHTML = `<div class="card"><button class="btn ghost close" data-x>Close</button><h2>On the river</h2>
      <p class="small">You are <b>${esc(net?.profile?.name || "Paddler")}</b>${net?.online ? ' · <span class="online">● online</span>' : ""}. Wave <kbd>1</kbd>, flare <kbd>2</kbd>, bell <kbd>3</kbd>.</p>${body}</div>`;
    this.el.querySelector("[data-x]").onclick = () => this.close();
  }
  update() { if (this.isOpen()) { this.t = (this.t || 0) + 1; if (this.t % 30 === 0) this.render(); } }
}

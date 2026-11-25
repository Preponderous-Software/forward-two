// The heads-up display: where you are, the time, the guide's lane in rapids,
// stability and flow, toasts, and the menus' entry points.
import { LEAD, WINDOW } from "../sim/rapids.js";
import { badge, placeBadge } from "./badges.js";

const ICON = {
  forward: '<path d="M5 15l7-7 7 7"/>', back: '<path d="M5 9l7 7 7-7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
};
const CALL_WORD = { forward: "Forward!", back: "Back!", left: "Left!", right: "Right!" };
const CLASS = ["Flat", "I", "II", "III", "IV", "V"];
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export class Hud {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.panels = {};
    root.insertAdjacentHTML("beforeend", `
      <div class="hud-top">
        <div class="where"><div class="where-main" id="h-where">The Long Water</div><div class="where-sub" id="h-sub"></div></div>
        <div class="hud-right">
          <button class="clock online-chip" id="h-online" title="Who is on the river (Tab)" aria-label="Who is on the river"></button>
          <div class="clock" id="h-clock" title="Time of day"></div>
          <button class="iconbtn" id="h-map" aria-label="Map (M)"><svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14"/></svg></button>
          <button class="iconbtn" id="h-journal" aria-label="Journal (J)"><svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z M5 17a3 3 0 013-3h11"/></svg></button>
          <button class="iconbtn" id="h-menu" aria-label="Menu (Esc)"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
        </div>
      </div>
      <div class="meters">
        <div class="meter" title="Stability"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg><div class="bar"><i id="h-stab"></i></div></div>
        <div class="meter" title="Hull"><svg viewBox="0 0 24 24"><path d="M3 13h18l-3 5H6z M12 4v9 M12 5l6 6h-6"/></svg><div class="bar hull"><i id="h-hull"></i></div></div>
        <div class="meter flow" title="Flow"><svg viewBox="0 0 24 24"><path d="M3 9c3-3 6 3 9 0s6 3 9 0 M3 15c3-3 6 3 9 0s6 3 9 0"/></svg><div class="bar"><i id="h-flow"></i></div></div>
        <div class="speed" id="h-speed">0.0 m/s</div>
      </div>
      <div class="banner" id="h-banner"></div>
      <div class="lane" id="h-lane" aria-hidden="true"><div class="gate"></div><div class="judge" id="h-judge"></div></div>
      <div class="flash" id="h-flash" role="status" aria-live="polite"></div>
      <div class="toasts" id="h-toasts"></div>
      <div class="prompt" id="h-prompt"></div>
      <div class="vignette" id="h-vig"></div>`);
    this.$ = (id) => root.querySelector("#" + id);
    this.lane = this.$("h-lane");
    this.markers = new Map();
    this.$("h-map").onclick = () => this.action("map");
    this.$("h-online").onclick = () => this.action("players");
    this.$("h-journal").onclick = () => this.action("journal");
    this.$("h-menu").onclick = () => this.action("menu");
    this.flashT = 0; this.shakeT = 0; this.bannerT = 0;
  }

  register(name, panel) { this.panels[name] = panel; }

  action(a) {
    const g = this.game;
    if (a.startsWith("emote:")) { g.net?.emote(a.slice(6)); g.others?.selfEmote?.(a.slice(6)); return; }
    if (a === "camera") { g.freeCamera = !g.freeCamera; this.toast(g.freeCamera ? "Free camera: drag to look around." : "Camera follows the boat."); return; }
    if (a === "interact") { (g.places?.interact() || g.races?.interact() || g.jobs?.interact()); return; }
    if (a === "race") { g.races?.interact(); return; }
    const open = Object.entries(this.panels).find(([, p]) => p.isOpen && p.isOpen());
    if (open && (open[0] === a || a === "menu")) { open[1].close(); return; }
    if (open) open[1].close();
    this.panels[a]?.open();
  }

  anyOpen() { return Object.values(this.panels).some((p) => p.isOpen && p.isOpen()); }

  intro() { if (this.game.params.get("skip") !== "1") this.panels.title?.open(); }

  discovery(p) {
    this.card(`${placeBadge(p)}<div class="kicker">${p.kind ? "Landmark found" : "Camp found"}</div><b>${p.name}</b><span>${p.blurb || ""}</span>`);
    this.game.audio?.judgment?.("perfect");
  }

  featCard(f) { this.card(`${badge(f.icon, true, { feat: true })}<div class="kicker">Feat</div><b>${f.name}</b><span>${f.text}</span>`); }

  raceResult(c, t, medal, pb) {
    const m = Math.floor(t / 60), s = (t - m * 60).toFixed(1);
    this.card(`<div class="kicker">${c.name}</div><b>${m ? m + ":" + s.padStart(4, "0") : s + " s"}${medal ? " · " + medal : ""}</b><span>${pb ? "Personal best!" : "Not your best."}</span>`);
  }

  // Cards queue, so a discovery, a feat and a letter arriving together each get their turn.
  card(html) {
    const now = performance.now(), at = Math.max(now, this.cardFree || 0);
    if (at - now > 14000) { const t = document.createElement("div"); t.innerHTML = html; this.toast([...t.children].map((e) => e.textContent).join(" · "), 5); return; }
    this.cardFree = at + 4500;
    if (at > now) { setTimeout(() => this.showCard(html), at - now); return; }
    this.showCard(html);
  }

  showCard(html) {
    const el = document.createElement("div");
    el.className = "cardpop"; el.innerHTML = html;
    this.root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("on"));
    setTimeout(() => el.classList.remove("on"), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  toast(text, secs = 3.2) {
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = text;
    this.$("h-toasts").appendChild(el);
    setTimeout(() => el.classList.add("out"), secs * 1000);
    setTimeout(() => el.remove(), secs * 1000 + 600);
  }

  flash(text, secs = 1.6) { const f = this.$("h-flash"); f.textContent = text; f.classList.add("on"); this.flashT = secs; }

  prompt(html) {
    const p = this.$("h-prompt");
    if (this.promptHtml === html) return;
    this.promptHtml = html;
    p.innerHTML = html || ""; p.classList.toggle("on", !!html);
  }

  rapid(r) {
    const b = this.$("h-banner");
    b.innerHTML = `<span class="cls c${r.cls}">${CLASS[r.cls]}</span><span>${r.name}</span>`;
    b.classList.add("on"); this.bannerT = 3;
  }

  rapidDone(r, stats) {
    const total = stats.perfect + stats.good + stats.miss;
    if (!total) return;
    const clean = stats.miss === 0;
    const drive = stats.drive || stats.dropped ? ` · drive ${stats.drive || 0}/${(stats.drive || 0) + (stats.dropped || 0)}` : "";
    this.toast(`${r.name}: ${stats.perfect} perfect, ${stats.good} good, ${stats.miss} missed${drive}${clean ? ". Clean line!" : ""}`, 4);
  }

  judgment(j, call) {
    const el = this.$("h-judge");
    el.className = "judge on " + j;
    el.textContent = { perfect: "Perfect", good: "Good", early: "Early", late: "Late", miss: "Miss", wrong: "Wrong way" }[j] || j;
    clearTimeout(this.judgeTimer);
    this.judgeTimer = setTimeout(() => el.classList.remove("on"), 650);
    this.game.input?.haptic?.(j);
    void call;
  }

  shake(a) { this.shakeT = Math.min(0.5, this.shakeT + a); }

  update(dt) {
    const g = this.game, b = g.boat;
    // Where.
    const cur = b.current, hit = cur && cur.hit;
    const where = g.places?.regionName?.(b.x, b.z) || (hit ? hit.river.name : g.world.lake.inside(b.x, b.z) ? "Mirror Lake" : "Open water");
    if (where !== this.whereText) { this.$("h-where").textContent = where; this.whereText = where; }
    const sub = g.caller.rapid ? `${g.caller.rapid.name} · Class ${CLASS[g.caller.rapid.cls]}` : hit ? `${hit.river.name} · ${cur.cls ? "Class " + CLASS[cur.cls] : "flat water"}` : "";
    if (sub !== this.subText) { this.$("h-sub").textContent = sub; this.subText = sub; }
    // Who's online.
    const net = g.net, on = net?.online ? `● ${net.players.size + 1} on the river` : "○ offline";
    if (on !== this.onlineText) { const el = this.$("h-online"); el.textContent = on; el.classList.toggle("live", !!net?.online); this.onlineText = on; }
    // Clock.
    const mins = Math.floor(g.clock * 24 * 60), hh = Math.floor(mins / 60), mm = mins % 60;
    const ct = `${g.night > 0.5 ? "☾" : "☀"} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    if (ct !== this.clockText) { this.$("h-clock").textContent = ct; this.clockText = ct; }
    // Meters.
    this.$("h-stab").style.width = (b.stability * 100).toFixed(1) + "%";
    this.$("h-stab").parentNode.classList.toggle("low", b.stability < 0.35);
    this.$("h-hull").style.width = (b.hull * 100).toFixed(1) + "%";
    this.$("h-flow").style.width = (g.caller.flow * 100).toFixed(1) + "%";
    this.$("h-flow").parentNode.parentNode.classList.toggle("full", g.caller.flow >= 1);
    const sp = Math.hypot(b.vx, b.vz);
    const st = `${sp.toFixed(1)} m/s`;
    if (st !== this.speedText) { this.$("h-speed").textContent = st; this.speedText = st; }
    // The lane.
    const inLane = !!g.caller.rapid || b.swimming;
    this.lane.classList.toggle("on", inLane);
    // The gate pulses on the guide's beat, so the tempo is felt before the first marker lands.
    const ph = g.caller.rapid ? (((g.time - g.caller.beat) / g.caller.interval) % 1 + 1) % 1 : 1;
    this.lane.classList.toggle("beat", ph < 0.14);
    const seen = new Set();
    for (const c of g.caller.calls) {
      seen.add(c);
      let m = this.markers.get(c);
      if (!m) {
        m = document.createElement("div");
        m.className = "marker " + c.call + (c.fill ? " fill" : "");
        m.innerHTML = svg(c.call) + `<span>${CALL_WORD[c.call]}</span>`;
        this.lane.appendChild(m); this.markers.set(c, m);
      }
      const f = (c.time - g.time) / LEAD;            // 1 at spawn → 0 at the gate
      m.style.transform = `translateX(${Math.max(-0.15, Math.min(1, f)) * 84}cqw)`;
      m.style.opacity = f > 1 ? Math.max(0, (1.25 - f) / 0.25).toFixed(2) : "";   // calls further out than LEAD fade in at the lane's end
      m.classList.toggle("near", Math.abs(c.time - g.time) < WINDOW.good);
    }
    for (const [c, m] of this.markers) if (!seen.has(c)) {
      m.classList.add(c.state === "miss" || c.state === "wrong" ? "gone-miss" : "gone-hit");
      this.markers.delete(c);
      setTimeout(() => m.remove(), 380);
    }
    // Timers.
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.$("h-flash").classList.remove("on"); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.$("h-banner").classList.remove("on"); }
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const a = this.shakeT * 14;
      g.canvas.style.transform = `translate(${(Math.random() - 0.5) * a}px, ${(Math.random() - 0.5) * a}px)`;
      this.$("h-vig").style.opacity = Math.min(0.8, this.shakeT * 2);
    } else if (g.canvas.style.transform) { g.canvas.style.transform = ""; this.$("h-vig").style.opacity = 0; }
    for (const p of Object.values(this.panels)) p.update?.(dt);
  }
}

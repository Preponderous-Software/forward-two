// Keyboard, touch and gamepad → strokes and actions. On flat water a held
// stroke repeats; in a rapid every stroke is a deliberate press, because the
// guide judges each one.
const KEYS = {
  KeyW: "forward", ArrowUp: "forward", Space: "forward", KeyF: "forward",
  KeyS: "back", ArrowDown: "back", KeyB: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};
const REPEAT = 0.42;

export class Input {
  constructor(game, canvas, root) {
    this.game = game;
    this.held = new Map();   // stroke -> seconds until repeat
    this.touch = matchMedia("(pointer: coarse)").matches;
    addEventListener("keydown", (e) => this.key(e, true));
    addEventListener("keyup", (e) => this.key(e, false));
    addEventListener("blur", () => this.held.clear());
    this.buildTouch(root);
    addEventListener("touchstart", () => { if (!this.touch) { this.touch = true; this.pad.classList.add("on"); } }, { passive: true });
    this.padPrev = {};
  }

  key(e, down) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    this.shift = e.shiftKey;
    const g = this.game;
    const s = KEYS[e.code];
    if (s) {
      e.preventDefault();
      if (down && !e.repeat && !this.held.has(s)) { g.playerStroke(s); this.held.set(s, REPEAT); }
      if (!down) this.held.delete(s);
      return;
    }
    if (!down || e.repeat) return;
    const action = { KeyM: "map", KeyJ: "journal", Escape: "menu", KeyP: "menu", KeyE: "interact", KeyC: "camera",
      Digit1: "emote:wave", Digit2: "emote:flare", Digit3: "emote:bell", KeyR: "race", KeyH: "help", Tab: "players" }[e.code];
    if (action) { e.preventDefault(); g.hud.action(action); }
  }

  tick(dt) {
    const g = this.game;
    const inRapid = !!g.caller.rapid;
    for (const [s, left] of this.held) {
      const l = left - dt;
      if (l <= 0) {
        if (!inRapid) g.playerStroke(s);
        this.held.set(s, REPEAT);
      } else this.held.set(s, l);
    }
    this.gamepad();
  }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((x) => x && x.connected);
    if (!p) return;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const state = {
      forward: btn(0) || btn(7) || ay < -0.6, back: btn(1) || btn(6) || ay > 0.6,
      left: btn(4) || btn(14) || ax < -0.6, right: btn(5) || btn(15) || ax > 0.6,
    };
    for (const [s, on] of Object.entries(state)) {
      if (on && !this.padPrev[s]) { this.game.playerStroke(s); this.held.set(s, REPEAT); }
      if (!on && this.padPrev[s]) this.held.delete(s);
    }
    const actions = { 3: "map", 2: "interact", 9: "menu", 8: "journal" };
    for (const [i, a] of Object.entries(actions)) {
      const on = btn(Number(i));
      if (on && !this.padPrev["b" + i]) this.game.hud.action(a);
      this.padPrev["b" + i] = on;
    }
    Object.assign(this.padPrev, state);
  }

  buildTouch(root) {
    const pad = document.createElement("div");
    pad.className = "pad" + (this.touch ? " on" : "");
    pad.innerHTML = `
      <div class="pad-left">
        <button data-s="left" aria-label="Left stroke"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button data-s="right" aria-label="Right stroke"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="pad-right">
        <button data-s="back" class="small" aria-label="Back stroke"><svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7"/></svg></button>
        <button data-s="forward" class="big" aria-label="Forward stroke"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg></button>
      </div>`;
    root.appendChild(pad);
    this.pad = pad;
    for (const b of pad.querySelectorAll("button")) {
      const s = b.dataset.s;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add("down");
        this.game.playerStroke(s); this.held.set(s, REPEAT);
        if (navigator.vibrate) navigator.vibrate(8);
      });
      const up = () => { b.classList.remove("down"); this.held.delete(s); };
      b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }
}

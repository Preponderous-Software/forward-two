// Keyboard, touch and gamepad → strokes and actions. On flat water a held
// stroke repeats; in a rapid every stroke is a deliberate press, because the
// guide judges each one.
//
// The mappings (keys, pad buttons and sticks) are plain functions at the top
// so tests can check them without a DOM.
export const KEYS = {
  KeyW: "forward", ArrowUp: "forward", Space: "forward", KeyF: "forward",
  KeyS: "back", ArrowDown: "back", KeyB: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};
export const KEY_ACTIONS = {
  KeyM: "map", KeyJ: "journal", Escape: "menu", KeyP: "menu", KeyE: "interact", KeyC: "camera",
  Digit1: "emote:wave", Digit2: "emote:flare", Digit3: "emote:bell", KeyR: "race", KeyH: "title", Tab: "players",   // H: the title card lists the controls
};
// Standard gamepad layout: A/B/X/Y = 0/1/2/3, LB/RB = 4/5, LT/RT = 6/7,
// Back/Start = 8/9, D-pad = 12–15.
export const PAD_ACTIONS = { 2: "interact", 3: "map", 8: "journal", 9: "menu" };
export const REPEAT = 0.42;
export const RUN_HOLD = 0.9;       // on foot, a touch "forward" held this long breaks into a run
export const DEADZONE = 0.5;

// Which strokes a gamepad is asking for: buttons, D-pad, left stick, triggers.
export function padStrokes(axes, pressed) {
  const ax = axes[0] || 0, ay = axes[1] || 0;
  const b = (i) => !!pressed[i];
  return {
    forward: b(0) || b(7) || b(12) || ay < -DEADZONE,
    back: b(1) || b(6) || b(13) || ay > DEADZONE,
    left: b(4) || b(14) || ax < -DEADZONE,
    right: b(5) || b(15) || ax > DEADZONE,
  };
}

// Haptic patterns (ms) for the guide's judgments, so a phone player feels the
// beat land without looking down at the lane.
export const HAPTIC = { perfect: [18], good: [12], early: [6], late: [6], miss: [40, 30, 40], wrong: [40, 30, 40] };

export class Input {
  constructor(game, canvas, root) {
    this.game = game;
    this.held = new Map();   // stroke -> seconds until repeat
    this.heldFor = new Map(); // stroke -> seconds held
    this.keyShift = false; this.shift = false;
    this.touch = matchMedia("(pointer: coarse)").matches;
    addEventListener("keydown", (e) => this.key(e, true));
    addEventListener("keyup", (e) => this.key(e, false));
    addEventListener("blur", () => { this.held.clear(); this.heldFor.clear(); });
    this.buildTouch(root);
    addEventListener("touchstart", () => { if (!this.touch) { this.touch = true; this.pad.classList.add("on"); } }, { passive: true });
    this.padPrev = {};
  }

  press(s) { this.game.playerStroke(s); this.held.set(s, REPEAT); this.heldFor.set(s, 0); }
  release(s) { this.held.delete(s); this.heldFor.delete(s); }

  key(e, down) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    this.keyShift = e.shiftKey;
    const g = this.game;
    const s = KEYS[e.code];
    if (s) {
      e.preventDefault();
      if (down && !e.repeat && !this.held.has(s)) this.press(s);
      if (!down) this.release(s);
      return;
    }
    if (!down || e.repeat) return;
    const action = KEY_ACTIONS[e.code];
    if (action) { e.preventDefault(); g.hud.action(action); }
  }

  tick(dt) {
    const g = this.game;
    const inRapid = !!g.caller.rapid;
    for (const [s, left] of this.held) {
      this.heldFor.set(s, (this.heldFor.get(s) || 0) + dt);
      const l = left - dt;
      if (l <= 0) {
        if (!inRapid) g.playerStroke(s);
        this.held.set(s, REPEAT);
      } else this.held.set(s, l);
    }
    // On foot: Shift runs; on a phone, holding forward breaks into a run.
    this.shift = this.keyShift || (this.touch && (this.heldFor.get("forward") || 0) > RUN_HOLD);
    this.gamepad();
  }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((x) => x && x.connected);
    if (!p) return;
    const pressed = p.buttons.map((b) => !!(b && b.pressed));
    const state = padStrokes(p.axes, pressed);
    for (const [s, on] of Object.entries(state)) {
      if (on && !this.padPrev[s]) this.press(s);
      if (!on && this.padPrev[s]) this.release(s);
    }
    for (const [i, a] of Object.entries(PAD_ACTIONS)) {
      const on = pressed[Number(i)];
      if (on && !this.padPrev["b" + i]) this.game.hud.action(a);
      this.padPrev["b" + i] = on;
    }
    // Right stick orbits the camera for a moment, like a drag.
    const rx = p.axes[2] || 0, ry = p.axes[3] || 0, cam = this.game.kit?.cam;
    if (cam && (Math.abs(rx) > 0.2 || Math.abs(ry) > 0.2)) {
      cam.yaw += rx * 0.04; cam.pitch = Math.max(-0.1, Math.min(1.4, cam.pitch + ry * 0.03));
      this.game.camState.freeUntil = performance.now() + 2500;
    }
    Object.assign(this.padPrev, state);
  }

  haptic(j) {
    if (!this.touch || !navigator.vibrate) return;
    const p = HAPTIC[j];
    if (p) try { navigator.vibrate(p); } catch { /* ignore */ }
  }

  buildTouch(root) {
    const pad = document.createElement("div");
    pad.className = "pad" + (this.touch ? " on" : "");
    pad.innerHTML = `
      <div class="pad-left">
        <button data-s="left" aria-label="Left stroke"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button data-s="right" aria-label="Right stroke"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="pad-emotes">
        <button class="emote-toggle" aria-label="Signals: wave, flare, bell" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7s-5-2-6.5-5L3 11.5a1.4 1.4 0 012.3-1.5L8 13"/></svg></button>
        <div class="emote-fan">
          <button data-a="emote:wave" aria-label="Wave"><svg viewBox="0 0 24 24"><path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7s-5-2-6.5-5L3 11.5a1.4 1.4 0 012.3-1.5L8 13"/></svg></button>
          <button data-a="emote:flare" aria-label="Flare: follow me"><svg viewBox="0 0 24 24"><path d="M12 21V11M12 11l-3-3M12 11l3-3M12 3v2M5 6l1.5 1.5M19 6l-1.5 1.5"/></svg></button>
          <button data-a="emote:bell" aria-label="Bell"><svg viewBox="0 0 24 24"><path d="M6 17h12l-1.5-2V10a4.5 4.5 0 00-9 0v5zM10 20h4"/></svg></button>
        </div>
      </div>
      <div class="pad-right">
        <button data-s="back" class="small" aria-label="Back stroke"><svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7"/></svg></button>
        <button data-s="forward" class="big" aria-label="Forward stroke"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg></button>
      </div>`;
    root.appendChild(pad);
    this.pad = pad;
    for (const b of pad.querySelectorAll("button[data-s]")) {
      const s = b.dataset.s;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ } b.classList.add("down");
        this.press(s);
        if (navigator.vibrate) navigator.vibrate(8);
      });
      const up = () => { b.classList.remove("down"); this.release(s); };
      b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    // Signals (the 1 2 3 keys): a hand button that fans out wave, flare and bell.
    const emotes = pad.querySelector(".pad-emotes"), toggle = emotes.querySelector(".emote-toggle");
    const setFan = (on) => { emotes.classList.toggle("open", on); toggle.setAttribute("aria-expanded", String(on)); };
    toggle.addEventListener("click", () => setFan(!emotes.classList.contains("open")));
    for (const b of emotes.querySelectorAll("button[data-a]")) b.addEventListener("click", () => { this.game.hud.action(b.dataset.a); setFan(false); });
  }
}

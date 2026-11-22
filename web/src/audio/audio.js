// Sound for Forward Two: river ambience, night chorus, paddle strokes,
// rhythm judgments, and the guide's voice. WebAudio only, no libraries.
// Everything fails silently: no AudioContext, a blocked context, a missing
// manifest or clip all just mean less sound.

const MUTE_KEY = "f2.muted";
const MANIFEST_URL = "audio/guide/index.json";
export const CLIP_LEAD = 0.35;       // seconds from a call clip's start to its spoken stress
const LOOKAHEAD = 0.12;              // how far ahead beat ticks are scheduled, seconds
const AMBIENCE_HZ = 10;              // ambience parameter updates per second

// ---------- pure helpers (tested in node) ----------

// Seconds from now to start a call clip so its stress lands on the beat.
export function clipDelay(secondsUntilBeat, lead = CLIP_LEAD) {
  const d = secondsUntilBeat - lead;
  return d > 0 ? d : 0;
}

// The first beat at or after `now`, on the grid that has a beat at `beat`.
export function nextBeat(beat, interval, now) {
  if (!(interval > 0)) return now;
  if (now <= beat) return beat;
  return beat + Math.ceil((now - beat) / interval - 1e-9) * interval;
}

// Which variant of a call to use: the plain clip in easy water, livelier
// ones as the class rises. `r` is a 0..1 random number.
export function pickVariant(count, cls, r) {
  if (count <= 1) return 0;
  if (!(cls >= 3)) return r < 0.75 ? 0 : 1 + Math.floor(r * 4) % (count - 1);
  return 1 + Math.min(count - 2, Math.floor(r * (count - 1)));
}

// Ambience targets for the current water, written into `out` (no allocation).
// speed in m/s, cls 0..5, y height, lake true when on open still water.
export function ambienceTargets(speed, cls, y, lake, out) {
  const s = Math.min(Math.max(speed || 0, 0), 6);
  out.river = lake ? 0 : Math.min(0.32, 0.03 + s * 0.05 + (cls >= 2 ? cls * 0.02 : 0));
  out.riverHz = 350 + s * 260 + cls * 320;
  out.roar = cls >= 3 ? Math.min(0.45, (cls - 2) * 0.13 + s * 0.02) : 0;
  out.lap = lake ? 0.09 : 0;
  out.wind = y > 150 ? Math.min(0.14, (y - 150) / 400) : 0;
  return out;
}

// Check a guide manifest: {clips: {id: [{file, ...}]}}. Returns a list of problems.
export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== "object" || !m.clips || typeof m.clips !== "object") return ["no clips object"];
  for (const [id, list] of Object.entries(m.clips)) {
    if (!Array.isArray(list) || !list.length) { errs.push(`${id}: no clips`); continue; }
    for (const e of list) {
      if (!e || typeof e.file !== "string" || !/^[\w-]+\.ogg$/.test(e.file)) errs.push(`${id}: bad file ${e && e.file}`);
      if (e && e.stress != null && !(e.stress >= 0 && e.stress < (e.dur || 9))) errs.push(`${id}: bad stress`);
    }
  }
  return errs;
}

// ---------- the audio system ----------

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this._muted = false;
    try { this._muted = globalThis.localStorage?.getItem(MUTE_KEY) === "1"; } catch { /* storage blocked */ }
    this.manifest = null;
    this.manifestP = null;
    this.buffers = new Map();       // file -> AudioBuffer | null (failed)
    this.loading = new Map();       // file -> Promise
    this.voice = null;              // the playing guide clip {src, until}
    this.amb = { river: 0, riverHz: 400, roar: 0, lap: 0, wind: 0 };
    this.ambT = 0;
    this.chirpT = 0; this.birdT = 1; this.frogT = 2;
    this.tickBeat = -1;             // game time of the last beat a tick was scheduled for
    this.lastRapid = null; this.wasSwimming = false; this.nightBarked = false;
    this.barkUntil = 0;
  }

  get muted() { return this._muted; }

  setMuted(m) {
    this._muted = !!m;
    try { globalThis.localStorage?.setItem(MUTE_KEY, this._muted ? "1" : "0"); } catch { /* ignore */ }
    const c = this.ctx;
    if (!c) return;
    try {
      this.master.gain.setTargetAtTime(this._muted ? 0 : 0.9, c.currentTime, 0.05);
      if (this._muted) setTimeout(() => { if (this._muted) c.suspend().catch(() => {}); }, 300);
      else c.resume().catch(() => {});
    } catch { /* ignore */ }
  }

  // Call on the first user gesture.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.build();
        this.loadManifest();
      }
      if (!this._muted) this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this._muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.voiceBus = c.createGain(); this.voiceBus.gain.value = 1.0; this.voiceBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0.8; this.ambBus.connect(this.master);

    // Noise buffers, made once: white and brown (for the river body and rumble).
    const n = c.sampleRate * 3;
    this.white = c.createBuffer(1, n, c.sampleRate);
    this.brown = c.createBuffer(1, n, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5;
    }
    // Crossfade the loop seam so the loops do not click.
    const f = Math.floor(c.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; w[i] = w[i] * k + w[n - f + i] * (1 - k); b[i] = b[i] * k + b[n - f + i] * (1 - k); }

    const loop = (buf, offset) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, offset); return s;
    };
    const chain = (src, type, freq, q, gain) => {
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(fl); fl.connect(g); g.connect(this.ambBus);
      return { fl, g };
    };
    // River body: brown noise through a lowpass that opens with speed.
    this.river = chain(loop(this.brown, 0.3), "lowpass", 400, 0.5, 0);
    // Whitewater roar: white noise, band around 1-2 kHz, class III and up.
    this.roar = chain(loop(this.white, 1.1), "bandpass", 1400, 0.6, 0);
    // Lake lapping: lowpassed noise, amplitude swayed by a slow LFO.
    this.lap = chain(loop(this.brown, 1.9), "lowpass", 600, 0.7, 0);
    const lapLfo = c.createOscillator(); lapLfo.frequency.value = 0.37;
    const lapDepth = c.createGain(); lapDepth.gain.value = 0;
    lapLfo.connect(lapDepth); lapDepth.connect(this.lap.g.gain); lapLfo.start();
    this.lapDepth = lapDepth;
    // Wind on high ground: bandpassed white noise with a wandering centre.
    this.wind = chain(loop(this.white, 2.3), "bandpass", 500, 1.2, 0);
    const windLfo = c.createOscillator(); windLfo.frequency.value = 0.11;
    const windDepth = c.createGain(); windDepth.gain.value = 250;
    windLfo.connect(windDepth); windDepth.connect(this.wind.fl.frequency); windLfo.start();
  }

  // ---------- per frame ----------

  tick(dt) {
    const c = this.ctx;
    if (!c || this._muted || c.state !== "running") return;
    const g = this.game, b = g.boat;
    if (!b) return;
    const now = c.currentTime;

    // Ambience, at AMBIENCE_HZ.
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 1 / AMBIENCE_HZ;
      const cur = b.current;
      const lake = !!cur && !cur.hit && cur.speed > 0;
      const a = ambienceTargets(cur ? cur.speed : 0, cur ? cur.cls : 0, b.y || 0, lake, this.amb);
      this.river.g.gain.setTargetAtTime(a.river, now, 0.4);
      this.river.fl.frequency.setTargetAtTime(a.riverHz, now, 0.4);
      this.roar.g.gain.setTargetAtTime(a.roar, now, 0.6);
      this.lap.g.gain.setTargetAtTime(a.lap * 0.5, now, 0.8);
      this.lapDepth.gain.setTargetAtTime(a.lap * 0.5, now, 0.8);
      this.wind.g.gain.setTargetAtTime(a.wind, now, 1.0);
    }

    // Night chorus and day birds.
    const night = g.night || 0;
    if (night > 0.05) {
      this.chirpT -= dt;
      if (this.chirpT <= 0) { this.cricket(night); this.chirpT = (0.25 + Math.random() * 0.6) / night; }
      this.frogT -= dt;
      if (this.frogT <= 0) { if (night > 0.3) this.frog(night); this.frogT = 1.5 + Math.random() * 4; }
    }
    if (night < 0.5) {
      this.birdT -= dt;
      if (this.birdT <= 0) { if (!b.current || b.current.cls < 3) this.bird(1 - night * 2); this.birdT = 3 + Math.random() * 7; }
    }

    // Metronome tick on each beat while in a rapid.
    const cl = g.caller;
    if (cl && cl.rapid && cl.interval > 0) {
      const t = g.time, nb = nextBeat(cl.beat, cl.interval, t);
      if (nb - t < LOOKAHEAD && nb > this.tickBeat + cl.interval * 0.5) {
        this.tickBeat = nb;
        this.tick_(now + (nb - t));
      }
    } else this.tickBeat = -1;

    // Barks the game state implies.
    if (cl) {
      if (this.lastRapid && !cl.rapid) {
        const s = cl.stats;
        if (s && s.miss === 0 && s.perfect + s.good >= 3) this.bark("clean");
      }
      this.lastRapid = cl.rapid;
    }
    if (this.wasSwimming && !b.swimming) this.bark("back_in");
    this.wasSwimming = !!b.swimming;
    if (night > 0.6 && !this.nightBarked) { this.nightBarked = true; this.bark("night"); }
    if (night < 0.2) this.nightBarked = false;
  }

  // ---------- one-shots ----------

  _noise(at, dur, type, freq, q, peak, attack, bus = this.sfx, buf = this.white) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = buf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    s.connect(fl); fl.connect(g); g.connect(bus);
    s.start(at, Math.random() * 2, dur + 0.05);
    return fl;
  }

  _tone(at, freq, dur, peak, type = "sine", bus = this.sfx) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    o.connect(g); g.connect(bus);
    o.start(at); o.stop(at + dur + 0.02);
    return o;
  }

  _ok() { return this.ctx && !this._muted && this.ctx.state === "running"; }

  stroke(kind) {
    if (!this._ok()) return;
    try {
      const t = this.ctx.currentTime;
      const back = kind === "back";
      // Plunge: a short low thump of water, then the swish of the blade.
      this._noise(t, 0.12, "lowpass", back ? 260 : 380, 0.9, 0.35, 0.008, this.sfx, this.brown);
      const fl = this._noise(t + 0.03, back ? 0.38 : 0.3, "bandpass", back ? 700 : 1300, 1.4, 0.22, 0.05);
      fl.frequency.setValueAtTime(back ? 700 : 1300, t + 0.03);
      fl.frequency.exponentialRampToValueAtTime(back ? 380 : 700, t + 0.33);
    } catch { /* ignore */ }
  }

  judgment(j) {
    if (!this._ok()) return;
    try {
      const t = this.ctx.currentTime;
      if (j === "perfect") { this._tone(t, 1046.5, 0.35, 0.16); this._tone(t + 0.07, 1568, 0.45, 0.13); }
      else if (j === "good") this._tone(t, 1046.5, 0.3, 0.13);
      else if (j === "late") this._tone(t, 784, 0.22, 0.08);
      else if (j === "miss" || j === "wrong") {
        const o = this._tone(t, 120, 0.22, 0.3, "triangle");
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
        this._noise(t, 0.12, "lowpass", 300, 0.7, 0.2, 0.004, this.sfx, this.brown);
      }
    } catch { /* ignore */ }
  }

  splash(intensity = 1) {
    if (!this._ok()) return;
    try {
      const t = this.ctx.currentTime, k = Math.min(2, Math.max(0.2, intensity));
      this._noise(t, 0.35 + k * 0.4, "lowpass", 900 + k * 500, 0.6, 0.3 + k * 0.2, 0.01, this.sfx, this.brown);
      this._noise(t + 0.02, 0.5 + k * 0.5, "highpass", 1800, 0.5, 0.12 * k, 0.03);
    } catch { /* ignore */ }
  }

  tick_(at) {
    try { this._tone(at, 2200, 0.04, 0.05, "square"); } catch { /* ignore */ }
  }

  cricket(night) {
    try {
      const c = this.ctx, t = c.currentTime + Math.random() * 0.05;
      const o = c.createOscillator(); o.frequency.value = 4200 + Math.random() * 900;
      const g = c.createGain(); g.gain.value = 0;
      const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
      const v = 0.012 * night * (0.5 + Math.random());
      const pulses = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < pulses; i++) {
        const a = t + i * 0.045;
        g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(v, a + 0.008); g.gain.linearRampToValueAtTime(0, a + 0.03);
      }
      o.connect(g); g.connect(p); p.connect(this.ambBus);
      o.start(t); o.stop(t + pulses * 0.045 + 0.05);
    } catch { /* ignore */ }
  }

  frog(night) {
    try {
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = 180 + Math.random() * 120;
      const fl = c.createBiquadFilter(); fl.type = "bandpass"; fl.frequency.value = 600; fl.Q.value = 4;
      const g = c.createGain(); g.gain.value = 0;
      const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.4 - 0.7;
      const v = 0.03 * night, n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const a = t + i * 0.16;
        g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(v, a + 0.02); g.gain.linearRampToValueAtTime(0, a + 0.11);
      }
      o.connect(fl); fl.connect(g); g.connect(p); p.connect(this.ambBus);
      o.start(t); o.stop(t + n * 0.16 + 0.05);
    } catch { /* ignore */ }
  }

  bird(day) {
    if (day <= 0) return;
    try {
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(); const f0 = 2400 + Math.random() * 1600;
      const g = c.createGain(); g.gain.value = 0;
      const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
      const n = 2 + (Math.random() * 4 | 0), v = 0.02 * day;
      for (let i = 0; i < n; i++) {
        const a = t + i * 0.13, up = Math.random() < 0.5;
        o.frequency.setValueAtTime(up ? f0 : f0 * 1.4, a);
        o.frequency.exponentialRampToValueAtTime(up ? f0 * 1.4 : f0 * 0.9, a + 0.08);
        g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(v, a + 0.015); g.gain.linearRampToValueAtTime(0, a + 0.09);
      }
      o.connect(g); g.connect(p); p.connect(this.ambBus);
      o.start(t); o.stop(t + n * 0.13 + 0.05);
    } catch { /* ignore */ }
  }

  // ---------- the guide ----------

  loadManifest() {
    if (this.manifestP) return this.manifestP;
    this.manifestP = (async () => {
      try {
        const r = await fetch(MANIFEST_URL);
        if (!r.ok) return null;
        const m = await r.json();
        if (validateManifest(m).length) return null;
        this.manifest = m;
        // Clips are small: decode them all up front, calls first.
        const ids = ["forward", "back", "left", "right", ...Object.keys(m.clips)];
        for (const id of new Set(ids)) for (const e of m.clips[id] || []) this.loadClip(e.file);
        return m;
      } catch { return null; }
    })();
    return this.manifestP;
  }

  loadClip(file) {
    if (this.buffers.has(file)) return Promise.resolve(this.buffers.get(file));
    if (this.loading.has(file)) return this.loading.get(file);
    const p = (async () => {
      try {
        const r = await fetch(new URL(file, new URL(MANIFEST_URL, globalThis.location?.href)).href);
        if (!r.ok) throw new Error(String(r.status));
        const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
        this.buffers.set(file, buf);
        return buf;
      } catch { this.buffers.set(file, null); return null; }
      finally { this.loading.delete(file); }
    })();
    this.loading.set(file, p);
    return p;
  }

  // Play clip `e` at context time `at`, cutting off whatever the guide was saying.
  _say(e, at) {
    const buf = this.buffers.get(e.file);
    if (!buf) { if (!this.buffers.has(e.file)) this.loadClip(e.file); return false; }
    const c = this.ctx;
    if (this.voice && this.voice.until > at) { try { this.voice.src.stop(at); } catch { /* ignore */ } }
    const s = c.createBufferSource(); s.buffer = buf; s.connect(this.voiceBus);
    s.start(at);
    this.voice = { src: s, until: at + buf.duration };
    return true;
  }

  call(kind, secondsUntilBeat) {
    if (!this._ok() || !this.manifest) return;
    try {
      const list = this.manifest.clips[kind];
      if (!list || !list.length) return;
      const cls = this.game?.caller?.rapid?.cls || 0;
      const e = list[pickVariant(list.length, cls, Math.random())];
      const lead = e.stress ?? this.manifest.lead ?? CLIP_LEAD;
      this._say(e, this.ctx.currentTime + clipDelay(secondsUntilBeat, lead));
    } catch { /* ignore */ }
  }

  bark(id) {
    if (!this._ok() || !this.manifest) return;
    try {
      const list = this.manifest.clips[id];
      if (!list || !list.length) return;
      const now = this.ctx.currentTime;
      if (this.voice && this.voice.until > now + 0.05) return;   // never talk over a call
      this._say(list[(Math.random() * list.length) | 0], now);
    } catch { /* ignore */ }
  }

  rapid(r) {
    if (!this._ok() || !this.manifest) return;
    try {
      if (r && /fall/i.test(r.name || "")) { this.bark("falls"); return; }
      const list = this.manifest.clips.enter;
      if (!list || !list.length) return;
      // "Big water" for class IV+, otherwise one of the others.
      const i = r && r.cls >= 4 && list.length > 2 ? 2 : (Math.random() * Math.min(2, list.length)) | 0;
      const now = this.ctx.currentTime;
      if (this.voice && this.voice.until > now + 0.05) return;
      this._say(list[i], now);
    } catch { /* ignore */ }
  }

  flip() {
    if (!this._ok()) return;
    this.splash(1.6);
    if (!this.manifest) return;
    try {
      const list = this.manifest.clips.swim;
      if (list && list.length) this._say(list[0], this.ctx.currentTime + 0.15);
    } catch { /* ignore */ }
  }
}

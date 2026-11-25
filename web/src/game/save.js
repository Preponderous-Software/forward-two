// Saves to localStorage (one slot per world seed). Losing or corrupting a
// save is the worst thing the game can do, so:
//
// - every read is validated (normalizeSave) and bad fields fall back to
//   defaults one by one instead of throwing the whole save away;
// - fields this build does not know are kept and written back, so an older
//   build never strips what a newer one added;
// - the first write of a session snapshots the save it found to
//   `<key>.bak`; a primary that will not parse or validate is restored from
//   that backup, and the damaged text is kept in `<key>.corrupt`;
// - "Start over" and ?new=1 move the old save to `<key>.prev` rather than
//   deleting it;
// - each write is read back and compared, a failed write (quota, blocked
//   storage) leaves the previous save in place and is reported once;
// - the game writes when the page is hidden (phones kill background tabs).
// - fields added since 0.1.0 (day, progress, journal.night, jobs.taken) are
//   optional: a save without them loads with defaults (tests/progress.test.js).
//
// Every storage access is wrapped: a private window or blocked storage just
// means no save.
import { BOATS } from "../sim/boat.js";

export const KEY = "f2.save.v1";
export const VERSION = 1;
const KNOWN_BOATS = Object.keys(BOATS);

// Seed 1 (the Long Water) keeps the original key; other seeds get their own
// slot, so trying ?seed=N never overwrites the main save.
export function saveKey(seed) {
  return seed == null || String(seed) === "1" ? KEY : `${KEY}.s${String(seed).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)}`;
}

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

// Checks and repairs a parsed save. Returns {ok, data, fixed[], reason?}.
// ok is false only when nothing can be used (not an object, or a save from a
// newer version). opts: {size} (world size in metres, for the position).
export function normalizeSave(raw, opts = {}) {
  if (!isObj(raw)) return { ok: false, reason: "not an object", fixed: [] };
  const v = raw.v == null ? VERSION : raw.v;
  if (!fin(v)) return { ok: false, reason: "bad version", fixed: [] };
  if (v > VERSION) return { ok: false, reason: "newer version", newer: true, fixed: [] };
  const d = { ...raw, v: VERSION };
  const fixed = [];
  const drop = (k) => { if (k in d) { delete d[k]; fixed.push(k); } };
  if (d.boat !== undefined && !KNOWN_BOATS.includes(d.boat)) { d.boat = "raft"; fixed.push("boat"); }
  if (d.pos !== undefined) {
    const p = d.pos, size = fin(opts.size) ? opts.size : Infinity;
    const inside = (c) => fin(c) && c >= 0 && c <= size;
    if (!isObj(p) || !inside(p.x) || !inside(p.z)) drop("pos");
    else d.pos = { x: p.x, z: p.z, heading: fin(p.heading) ? p.heading : 0 };
  }
  if (d.clock !== undefined) { if (fin(d.clock)) d.clock = ((d.clock % 1) + 1) % 1; else drop("clock"); }
  if (d.hull !== undefined) { if (fin(d.hull)) d.hull = Math.min(1, Math.max(0, d.hull)); else drop("hull"); }
  if (d.boatsOwned !== undefined) {
    if (!Array.isArray(d.boatsOwned)) drop("boatsOwned");
    else {
      const owned = [...new Set(d.boatsOwned.filter((b) => KNOWN_BOATS.includes(b)))];
      if (!owned.includes("raft")) owned.unshift("raft");
      if (owned.length !== d.boatsOwned.length) fixed.push("boatsOwned");
      d.boatsOwned = owned;
    }
  }
  if (d.colour != null && !(Array.isArray(d.colour) && d.colour.length === 3 && d.colour.every((c) => fin(c) && c >= 0 && c <= 1))) {
    d.colour = null; fixed.push("colour");
  }
  for (const k of ["journal", "jobs", "races"]) if (d[k] != null && !isObj(d[k])) drop(k);
  if (isObj(d.journal)) {
    const j = d.journal = { ...d.journal };
    for (const k of ["found", "feats", "visited"]) if (j[k] != null && !Array.isArray(j[k])) { delete j[k]; fixed.push(`journal.${k}`); }
    for (const k of ["pay", "deliveries"]) if (j[k] != null && !fin(j[k])) { delete j[k]; fixed.push(`journal.${k}`); }
    if (j.explored != null && typeof j.explored !== "string") { delete j.explored; fixed.push("journal.explored"); }
  }
  if (isObj(d.jobs) && d.jobs.active != null && !Array.isArray(d.jobs.active)) { d.jobs = { ...d.jobs }; delete d.jobs.active; fixed.push("jobs.active"); }
  if (isObj(d.races) && d.races.best != null && !isObj(d.races.best)) { d.races = { ...d.races }; delete d.races.best; fixed.push("races.best"); }
  return { ok: true, data: d, fixed };
}

// Parses and normalises stored text. Returns {raw, ok, data?, reason?, newer?}.
export function parseSave(text, opts) {
  if (text == null) return { raw: null, ok: false, reason: "missing" };
  let j;
  try { j = JSON.parse(text); } catch { return { raw: text, ok: false, reason: "not JSON" }; }
  return { raw: text, ...normalizeSave(j, opts) };
}

function defaultStorage() { try { return globalThis.localStorage || null; } catch { return null; } }

export class Save {
  // storage: anything with getItem/setItem/removeItem (localStorage by default).
  constructor(game, storage = defaultStorage()) {
    this.game = game; this.storage = storage;
    this.timer = 20; this.pending = false;
    this.key = saveKey(game.world?.seed);
    this.loaded = undefined;     // the cached result of load()
    this.base = null;            // the loaded save, so unknown fields survive a write
    this.snapshotted = false;    // the session's backup has been taken
    this.fresh = this.param("new") === "1";
    this.failures = 0; this.lastError = null; this.recovered = null; this.writes = 0;
    this.readOnly = null;        // why this session must not write (see load())
    if (typeof globalThis.addEventListener === "function" && storage === defaultStorage()) {
      const hide = () => { if (globalThis.document?.visibilityState !== "visible") this.flush(); };
      globalThis.addEventListener("visibilitychange", hide);
      globalThis.addEventListener("pagehide", () => this.flush());
    }
  }

  param(k) { try { return this.game.params?.get(k) ?? null; } catch { return null; } }
  opts() { return { size: this.game.world?.size }; }

  get(k) { try { return this.storage ? this.storage.getItem(k) : null; } catch { return null; } }
  set(k, v) { try { if (!this.storage) return false; this.storage.setItem(k, v); return true; } catch (e) { this.lastError = e; return false; } }
  del(k) { try { this.storage?.removeItem(k); } catch { /* nothing */ } }

  // The save to continue from, or null. Never throws; cached for the session.
  //
  // Some situations make the session read-only (this.readOnly is set and
  // write() does nothing), because writing would destroy the only copy of
  // something we cannot read:
  // - a save from a NEWER version: the primary is left exactly as it is; the
  //   backup (if any) is loaded for play, but nothing is written;
  // - a damaged primary whose text could not be kept aside in `.corrupt`
  //   (e.g. storage full): the damaged text stays in the primary.
  // A save made in another world (a 0.1.0 save from ?seed=N in the main slot)
  // is copied to that world's own slot before this one starts fresh.
  load() {
    if (this.loaded !== undefined) return this.loaded;
    this.loaded = null;
    if (this.fresh) return null;
    const prim = parseSave(this.get(this.key), this.opts());
    const seed = this.game.world?.seed;
    if (prim.ok && prim.data.seed != null && seed != null && String(prim.data.seed) !== String(seed)) {
      const own = saveKey(prim.data.seed);
      const there = this.get(own);
      const kept = own !== this.key && (there === prim.raw || (there == null && this.set(own, prim.raw) && this.get(own) === prim.raw));
      if (kept) this.recovered = { moved: prim.data.seed };
      else { this.readOnly = "other-world"; this.recovered = { otherWorld: prim.data.seed }; }
      this.base = null;
      return this.loaded;
    }
    if (prim.ok) {
      this.loaded = prim.data;
      if (prim.fixed.length) console.warn("save: repaired", prim.fixed.join(", "));
    } else if (prim.raw != null) {
      console.warn("save: primary unusable:", prim.reason);
      const bak = parseSave(this.get(`${this.key}.bak`), this.opts());
      if (prim.newer) {
        // Never touch a newer build's save: play from the backup, write nothing.
        this.set(`${this.key}.newer`, prim.raw);
        this.readOnly = "newer";
        if (bak.ok) this.loaded = bak.data;
        this.recovered = { newer: true, at: bak.ok ? bak.data.at : null };
      } else {
        // Keep the damaged text: never lose it, even if nothing can read it.
        const keptAside = this.set(`${this.key}.corrupt`, prim.raw) && this.get(`${this.key}.corrupt`) === prim.raw;
        if (!keptAside) this.readOnly = "corrupt";
        if (bak.ok) {
          this.loaded = bak.data;
          this.recovered = { reason: prim.reason, at: bak.data.at, unsaved: !keptAside };
          if (keptAside) this.set(this.key, bak.raw);
        } else this.recovered = { reason: prim.reason, at: null, lost: true, unsaved: !keptAside };
      }
    }
    this.base = this.loaded;
    return this.loaded;
  }

  // A line for the player when the save was repaired, or null.
  notice() {
    const r = this.recovered;
    if (!r) return null;
    if (r.newer) return "This save is from a newer version of the game, so it is left as it is. Progress here won't be saved.";
    if (r.moved != null) return `The save here was from another world (seed ${r.moved}); it now has its own slot (?seed=${r.moved}). This is a fresh start.`;
    if (r.otherWorld != null) return `The save here is from another world (seed ${r.otherWorld}) and is left as it is. Progress here won't be saved.`;
    const tail = r.unsaved ? " The device is out of space, so progress won't be saved until there is room." : "";
    if (r.lost) return (r.unsaved ? "Your save couldn't be read, so this is a fresh start. The old save is left as it is." : "Your save couldn't be read, so this is a fresh start. The old save is kept on this device.") + tail;
    const when = fin(r.at) ? ` from ${new Date(r.at).toLocaleString()}` : "";
    return `Your save was damaged, so the backup${when} was loaded.${tail}`;
  }

  apply(d) {
    const g = this.game;
    const step = (name, fn) => { try { fn(); } catch (e) { console.warn(`save: could not restore ${name}`, e); } };
    step("clock", () => { if (fin(d.clock)) g.clock = d.clock; });
    step("boats", () => { if (Array.isArray(d.boatsOwned)) g.boatsOwned = new Set(d.boatsOwned); });
    step("hull", () => { if (fin(d.hull) && g.boat) g.boat.hull = d.hull; });
    step("colour", () => { if (d.colour) g.colour = d.colour; });
    step("journal", () => g.journal?.restore(d.journal));
    step("jobs", () => g.jobs?.restore(d.jobs));
    step("day", () => { if (fin(d.day) && d.day >= 0) g.dayCount = Math.floor(d.day); });
    step("races", () => g.races?.restore(d.races));
    step("progress", () => { g.progress?.restore(d.progress); if (g.boat) g.progress?.fit(g.boat); });
  }

  data() {
    const g = this.game, b = g.boat;
    const pos = [b.x, b.z, b.heading].every(fin) ? { x: b.x, z: b.z, heading: b.heading } : this.base?.pos;
    return {
      v: VERSION, seed: g.world.seed, boat: b.kind, pos, clock: g.clock, day: Math.floor(g.dayCount || 0), hull: b.hull,
      boatsOwned: [...(g.boatsOwned || ["raft"])], colour: g.colour || null,
      journal: g.journal.data(), jobs: g.jobs?.data(), races: g.races?.data(), progress: g.progress?.data(), at: Date.now(),
    };
  }

  // Writes now. Returns true when the save is on the device.
  write() {
    if (this.param("nosave") === "1" || this.readOnly) return false;
    this.pending = false; this.timer = 20;
    let text, d;
    try {
      const n = normalizeSave({ ...(this.base || {}), ...this.data() }, this.opts());
      if (!n.ok) throw new Error(n.reason);
      d = n.data; text = JSON.stringify(d);
    } catch (e) { return this.fail(e); }
    if (!this.snapshotted) {
      this.snapshotted = true;
      const cur = this.get(this.key);
      if (cur != null && parseSave(cur, this.opts()).ok) {
        const k = this.fresh ? `${this.key}.prev` : `${this.key}.bak`;
        // A fresh start must not replace the old save unless it is safely kept.
        if (!(this.set(k, cur) && this.get(k) === cur) && this.fresh) { this.readOnly = "prev"; return this.fail(new Error("could not keep the old save")); }
      }
    }
    if (!this.set(this.key, text)) return this.fail(this.lastError);
    if (this.get(this.key) !== text) return this.fail(new Error("read-back mismatch"));
    this.base = d; this.writes++; this.failures = 0;
    if (this.fresh) this.dropNewParam();
    return true;
  }

  fail(e) {
    this.failures++; this.lastError = e; this.timer = Math.min(60, 20 * this.failures);
    console.warn("save: write failed", e);
    if (this.failures === 1) this.game.hud?.toast?.("Couldn't save on this device (storage full or blocked). The last save is kept.", 5);
    return false;
  }

  // After a fresh start has saved, a reload should continue it, not start over again.
  dropNewParam() {
    this.fresh = false;
    try {
      const u = new URL(globalThis.location.href);
      if (u.searchParams.get("new") !== "1") return;
      u.searchParams.delete("new");
      globalThis.history.replaceState(globalThis.history.state, "", u);
    } catch { /* not in a browser */ }
  }

  soon() { this.pending = true; this.timer = Math.min(this.timer, 2); }

  // Writes now unless the boat is mid-rapid or swimming (a save there would
  // restore into the middle of the whitewater).
  safeNow() { const b = this.game.boat; return !!b && !b.swimming && !this.game.caller?.rapid; }
  flush() { if (this.safeNow()) this.write(); }

  // "Start over": the old save moves to <key>.prev instead of being deleted.
  wipe() {
    // A save from a newer version or another world isn't this session's to clear.
    if (this.readOnly === "newer" || this.readOnly === "other-world") return false;
    const cur = this.get(this.key);
    if (cur != null) this.set(`${this.key}.prev`, cur);
    if (cur != null && this.get(`${this.key}.prev`) !== cur) return false;   // could not keep it: leave it
    this.del(this.key);
    this.loaded = null; this.base = null; this.readOnly = null;
    return true;
  }

  tick(dt) {
    this.timer -= dt;
    if (this.timer <= 0) { if (this.safeNow()) this.write(); else this.timer = 3; }
  }
}

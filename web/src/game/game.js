// The game: owns the world, the boat, the camera and the frame loop, and
// wires the systems (rapids, places, journal, jobs, races, network, HUD).
import { Bridge, Rows, MESH_TRANSLUCENT, MESH_UNLIT, TEX_MIPMAPS, PRIM, POINT_SOFT } from "../render/bridge.js";
import { waterMesh, seaMesh, rippleTexture, forestMeshes, rockMeshes } from "../render/meshes.js";
import { boatMesh, paddleMesh, boatMatrix } from "../render/boats.js";
import { makeBoat, stepBoat, stroke, featureIndex, BOATS } from "../sim/boat.js";
import { buildFeatures, buildRapids, Caller } from "../sim/rapids.js";
import { heightAt, waterAt } from "../world/terrain.js";
import { clamp, lerp } from "../world/noise.js";
import { Hud } from "../ui/hud.js";
import { Input } from "../ui/input.js";

const STEP = 1 / 60;
const DAY_SECONDS = 24 * 60;          // one in-game day in real seconds
const BASE_UNIX = Date.UTC(2026, 5, 18, 0, 0, 0) / 1000; // midsummer, for the sun
const LAT = 47.6, LON = -121.0;

export class Game {
  constructor({ world, mod, canvas, ui, params }) {
    this.world = world; this.mod = mod; this.canvas = canvas; this.uiRoot = ui; this.params = params;
    this.bridge = new Bridge(mod);
    this.rows = { items: new Rows(10), points: new Rows(10, 1024), lines: new Rows(10), wide: new Rows(13), lights: new Rows(12), labels: new Rows(8) };
    this.labelText = [];
    this.time = 0; this.acc = 0;
    this.clock = Number(params.get("hour") ?? 8.5) * 3600 / 86400; // fraction of the day
    this.systems = [];
    this.events = [];
    this.camState = { yaw: 0, pitch: 0.3, dist: 15, freeUntil: 0 };
  }

  async init(progress) {
    const w = this.world, b = this.bridge;
    this.kit = StrataKit.create({
      module: this.mod, canvas: this.canvas, idleOrbit: false, keys: false,
      camera: { yaw: 0, pitch: 0.3, dist: 15, tx: w.size / 2, ty: 80, tz: w.size / 2 },
      limits: { minPitch: -0.15, maxPitch: 1.45, minDist: 4, maxDist: 900 },
      frame: (t, now, dt) => this.frame(t, now, dt),
      onSlow: () => {}, onFatal: (c, m) => StrataLoader.fallback(c, m),
    });
    const { Places, CAMPS, LANDMARKS } = await import("./places.js");
    this.placesDefs = { CAMPS, LANDMARKS };
    this.places = new Places(this);
    progress(0.05, "Raising the mountains");
    b.terrain(w);
    progress(0.2, "Filling the rivers");
    this.rippleTex = rippleTexture(64, w.seed);
    this.texSlot = b.texture(this.rippleTex, 64, 64, TEX_MIPMAPS);
    const wm = waterMesh(w);
    this.waterSlot = b.mesh({ ...wm, color: [1, 1, 1, 0.82], flags: MESH_TRANSLUCENT, texture: this.texSlot });
    this.seaSlot = b.mesh({ ...seaMesh(w), color: [1, 1, 1, 0.9], flags: MESH_TRANSLUCENT, texture: this.texSlot });
    progress(0.35, "Placing the rocks");
    this.features = buildFeatures(w);
    this.featureIdx = featureIndex(this.features);
    this.rapids = buildRapids(w);
    this.caller = new Caller(this.features, this.rapids);
    b.mesh(rockMeshes(w, this.features));
    progress(0.5, "Growing the forests");
    const density = w.preset === "full" ? 1 : 0.55;
    const forest = forestMeshes(w, density, 4);
    forest.meshes.forEach((m) => b.mesh(m));
    this.treeCount = forest.count;

    // Systems that add their own meshes.
    progress(0.7, "Pitching the camps");
    this.places.build();
    const { Journal } = await import("./journal.js");
    this.journal = new Journal(this);
    const { Jobs } = await import("./jobs.js");
    this.jobs = new Jobs(this);
    const { Races } = await import("./races.js");
    this.races = new Races(this);
    this.races.build();
    const { Others } = await import("../net/others.js");
    this.others = new Others(this);
    const { Save } = await import("./save.js");
    this.save = new Save(this);
    progress(0.85, "Launching the boat");

    // The player's boat.
    const saved = this.save.load();
    const kind = saved?.boat || "raft";
    const start = saved?.pos || this.places.spawn();
    this.boat = makeBoat(kind, start.x, start.z, start.heading);
    this.boat.y = waterAt(w, start.x, start.z) || 0;
    this.makeBoatMeshes(kind);
    this.camState.yaw = Math.atan2(-Math.sin(this.boat.heading), -Math.cos(this.boat.heading));

    const { Net } = await import("../net/net.js");
    this.net = new Net(this);
    try { this.net.connect(); } catch (e) { console.warn("net", e); }
    this.races.listen();
    if (!this.colour && this.net.profile?.colour) this.colour = this.net.profile.colour;
    this.hud = new Hud(this, this.uiRoot);
    this.input = new Input(this, this.canvas, this.uiRoot);
    this.canvas.addEventListener("pointerdown", () => { this.camState.freeUntil = performance.now() + 4000; });
    this.canvas.addEventListener("wheel", () => { this.camState.freeUntil = performance.now() + 4000; }, { passive: true });
    this.boatsOwned = new Set(["raft"]);
    if (saved) { this.save.apply(saved); this.journal.restore(saved.journal); }
    const P = await import("../ui/panels.js");
    this.hud.register("title", new P.TitlePanel(this, this.uiRoot));
    this.hud.register("menu", new P.MenuPanel(this, this.uiRoot));
    this.hud.register("camp", new P.CampPanel(this, this.uiRoot));
    this.hud.register("map", new P.MapPanel(this, this.uiRoot));
    this.hud.register("journal", new P.JournalPanel(this, this.uiRoot));
    try { const A = await import("../audio/audio.js"); this.audio = new A.Audio(this); } catch (e) { this.audio = null; }
    const unlock = () => this.audio?.unlock?.();
    addEventListener("pointerdown", unlock, { once: true }); addEventListener("keydown", unlock, { once: true });
    progress(1, "Ready");
  }

  makeBoatMeshes(kind) {
    const b = this.bridge;
    if (this.boatSlot != null) { b.removeMesh(this.boatSlot); b.removeMesh(this.paddleSlot); }
    const colour = this.colour || BOATS[kind].colour;
    this.boatSlot = b.mesh(boatMesh(kind, colour));
    this.paddleSlot = b.mesh(paddleMesh(kind));
    this.mat = new Float32Array(16);
  }

  setBoat(kind) {
    const old = this.boat;
    this.boat = makeBoat(kind, old.x, old.z, old.heading);
    this.boat.y = old.y;
    this.makeBoatMeshes(kind);
    this.hud.toast(`You take the ${BOATS[kind].name.toLowerCase()}.`);
  }

  start() { this.snapCamera(); this.kit.start(); this.hud.intro(); }

  snapCamera() {
    const b = this.boat, cam = this.kit.cam;
    cam.yaw = Math.atan2(-Math.sin(b.heading), -Math.cos(b.heading));
    cam.pitch = 0.36; cam.dist = 16;
    cam.tx = b.x + Math.cos(b.heading) * 3; cam.tz = b.z + Math.sin(b.heading) * 3; cam.ty = b.y + 1.8;
  }

  // A stroke from the player (keyboard, touch or pad).
  playerStroke(kind) {
    const now = this.time;
    if (this.paused) return;
    const verdict = this.caller.judge(kind, now);
    let power = 1;
    if (verdict) {
      const j = verdict.judgment;
      power = j === "perfect" ? 1.35 : j === "good" ? 1.15 : j === "late" ? 1.0 : 0.6;
      if (j === "wrong") this.penalty(0.12, "Wrong call!");
      this.hud.judgment(j, verdict.call.call);
      this.audio?.judgment(j);
    }
    if (this.boat.swimming) return;
    if (stroke(this.boat, kind, power * (1 + this.caller.flow * 0.25), now)) this.audio?.stroke(kind);
  }

  restAt(camp) {
    const evening = 19.5 / 24, morning = 7 / 24;
    const target = this.night > 0.5 ? morning : evening;
    if (target <= this.clock) this.dayCount = (this.dayCount || 0) + 1;
    this.clock = target;
    this.boat.hull = 1; this.boat.stability = 1;
    this.hud.toast(`You rest at ${camp.name}. The boat is patched.`);
    this.save.write();
  }

  shuttleTo(camp) {
    const b = this.boat, s = camp.sample;
    const x = camp.x + camp.nx * 15, z = camp.z + camp.nz * 15;
    b.x = x; b.z = z; b.vx = b.vz = 0; b.spin = 0; b.heading = s ? Math.atan2(s.tz, s.tx) : b.heading;
    b.y = waterAt(this.world, x, z) || b.y;
    this.clock += 3 / 24; if (this.clock >= 1) { this.clock -= 1; this.dayCount = (this.dayCount || 0) + 1; }
    this.caller.reset();
    this.snapCamera();
    this.hud.toast(`The shuttle drops you at ${camp.name}.`);
    this.save.soon();
  }

  penalty(amount, text) {
    const b = this.boat;
    this.jobs?.onHit(amount);
    b.stability = Math.max(0, b.stability - amount / b.spec.stability);
    b.hull = Math.max(0, b.hull - amount * 0.3);
    this.hud.shake(amount);
    if (text) this.hud.flash(text);
    if (b.stability <= 0 && !b.swimming) this.flip();
  }

  flip() {
    const b = this.boat;
    b.swimming = true; b.flips++;
    this.caller.startSwim(this.time);
    this.hud.flash("Swimmer! Land two strokes to climb back in.", 3);
    this.audio?.flip();
    this.jobs?.onFlip();
    this.journal?.onFlip();
  }

  frame(t, now, dt) {
    dt = Math.min(dt || STEP, 0.1);
    if (!this.paused) {
      this.acc += dt;
      while (this.acc >= STEP) { this.tick(STEP); this.acc -= STEP; }
      this.clock += dt / DAY_SECONDS;
      if (this.clock >= 1) { this.clock -= 1; this.dayCount = (this.dayCount || 0) + 1; }
    }
    this.draw(dt);
  }

  tick(dt) {
    this.time += dt;
    const b = this.boat;
    this.input.tick(dt);
    const evs = stepBoat(this.world, b, dt, this.featureIdx);
    for (const e of evs) {
      if (e.type === "bank") this.penalty(Math.min(0.25, (e.speed - 1.2) * 0.08), null);
      if (e.type === "rock") this.penalty(Math.min(0.35, e.speed * 0.1), "Rock!");
      if (e.type === "drop") { this.hud.flash(`Drop! ${e.height.toFixed(0)} m`); this.audio?.splash(1); this.journal.onDrop(e.height); }
    }
    for (const e of this.caller.update(this.time, b)) {
      if (e.type === "enter") { this.hud.rapid(e.rapid); this.audio?.rapid(e.rapid); }
      if (e.type === "leave") { this.hud.rapidDone(e.rapid, e.stats); this.journal.onRapid(e.rapid, e.stats, b); }
      if (e.type === "call") this.audio?.call(e.call, e.time - this.time);
      if (e.type === "miss") {
        this.hud.judgment("miss", e.call.call);
        if (e.call.swim) continue;
        const f = e.call.feature;
        const hurt = f ? 0.1 + f.cls * 0.035 : 0.12;
        this.penalty(hurt, f ? ({ rock: "Hit the rock!", hole: "The hole grabs you!", pour: "Over the pour-over!", wave: "Swamped!" }[f.kind]) : null);
        if (f && f.kind !== "rock") { b.vx *= 0.6; b.vz *= 0.6; b.spin += (Math.random() - 0.5) * 2; }
      }
    }
    if (b.swimming && this.caller.swim) {
      if (this.caller.swim.landed >= 2) { b.swimming = false; b.stability = 0.45; this.caller.endSwim(); this.hud.flash("Back in the boat!"); }
      else if (this.caller.swim.misses >= 2) { this.washAshore(); }
    }
    // Flow burst.
    if (this.caller.flow >= 1 && !this.flowBurst) { this.flowBurst = true; this.hud.flash("In the line!"); this.journal.onFlow(); }
    if (this.caller.flow < 0.6) this.flowBurst = false;
    for (const s of [this.places, this.journal, this.jobs, this.races, this.net, this.others, this.save]) s?.tick?.(dt);
  }

  washAshore() {
    const b = this.boat;
    this.caller.endSwim();
    b.swimming = false; b.stability = 0.6; b.hull = Math.max(0.1, b.hull - 0.15);
    // Put the boat in calm water just downstream, by the bank.
    const hit = b.current?.hit;
    if (hit) {
      const S = hit.river.samples;
      let i = hit.sample.i;
      while (i < S.length - 1 && S[i].cls >= 2) i++;
      const p = S[Math.min(S.length - 1, i + 4)];
      const off = p.width * 0.3;
      b.x = p.x - p.tz * off; b.z = p.z + p.tx * off; b.vx = 0; b.vz = 0; b.heading = Math.atan2(p.tz, p.tx);
      b.y = p.level;
    }
    this.caller.reset();
    this.hud.flash("Washed into an eddy. The boat's battered but floating.", 3.5);
    this.jobs?.onWashAshore();
  }

  sunUnix() { return BASE_UNIX + this.clock * 86400 - LON / 15 * 3600; }

  draw(dt) {
    const b = this.boat, w = this.world, R = this.rows;
    for (const r of Object.values(R)) r.clear();
    this.labelText.length = 0;
    // Sun and light levels.
    const elev = this.kit.setSun(this.sunUnix(), LAT, LON);
    this.sunElevation = elev;
    const night = clamp((2 - elev) / 10, 0, 1);
    this.night = night;
    const dusk = clamp(1 - Math.abs(elev - 4) / 10, 0, 1);
    this.bridge.levels(new Float32Array([
      1, 1, 1,
      0.035 * night + 0.01, 0.045 * night + 0.012, 0.085 * night + 0.02,
      1, 1, 1 - dusk * 0.18, 1 - dusk * 0.35,
    ]));
    // Boat.
    const swimDip = b.swimming ? -0.5 : 0;
    const flipRoll = b.swimming ? Math.PI : 0;
    boatMatrix(b.x, b.y + 0.15 + swimDip, b.z, b.heading, b.pitch, b.roll + flipRoll, 1, this.mat);
    this.bridge.transform(this.boatSlot, this.mat);
    // The paddle swings through a stroke.
    const st = b.strokeT, swing = st < 0.5 ? Math.sin(st / 0.5 * Math.PI) : 0;
    const side = b.stroke === "right" ? -1 : b.stroke === "left" ? 1 : (Math.floor(b.lastStroke * 2) % 2 ? 1 : -1);
    const dir = b.stroke === "back" ? -1 : 1;
    const pm = new Float32Array(16);
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading);
    const paddleLocalX = (b.kind === "raft" ? -1.55 : b.kind === "kayak" ? -0.0 : b.kind === "canoe" ? -1.5 : -0.3) + dir * (swing - 0.5) * 0.9;
    const px = b.x + fx * paddleLocalX, pz = b.z + fz * paddleLocalX;
    boatMatrix(px, b.y + 0.8 + swimDip - swing * 0.3, pz, b.heading + Math.PI / 2 + side * (0.25 + swing * 0.3), 0, side * (0.55 + swing * 0.25) + (b.kind === "kayak" ? 0 : side * 0.4), 1, pm);
    this.bridge.transform(this.paddleSlot, pm);
    if (b.swimming) R.items.push(PRIM.SPHERE, b.x + fz * 1.2, b.y + 0.15, b.z - fx * 1.2, 0.35, 0.35, 0.35, 0.95, 0.85, 0.15);

    // Spray and foam.
    const cur = b.current;
    const speed = Math.hypot(b.vx, b.vz);
    if (cur && cur.cls >= 2) {
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 1.8;
        R.points.push(b.x + Math.cos(a) * r, b.y + 0.2 + Math.random() * 0.6 * cur.cls / 3, b.z + Math.sin(a) * r, 5, 0.35, 0.95, 0.97, 1, 0.55, POINT_SOFT);
      }
    }
    if (b.strokeT < 0.25) {
      for (let k = 0; k < 4; k++) R.points.push(px + (Math.random() - 0.5), b.y + 0.2, pz + (Math.random() - 0.5), 4, 0.25, 0.9, 0.95, 1, 0.6, POINT_SOFT);
    }
    // Wake.
    if (speed > 0.8) {
      for (let k = 0; k < 2; k++) R.points.push(b.x - fx * 2.2 + (Math.random() - 0.5) * 1.2, b.y + 0.05, b.z - fz * 2.2 + (Math.random() - 0.5) * 1.2, 4, 0.5, 0.9, 0.95, 1, 0.4, POINT_SOFT);
    }
    // Features near the boat: foam on holes and waves, flags on calls.
    const tnow = this.time;
    for (const f of this.featureIdx.near(b.x, b.z, 70)) {
      if (f.kind === "rock") continue;
      const n = f.kind === "hole" ? 5 : f.kind === "pour" ? 7 : 3;
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + tnow * 1.7;
        const rr = f.kind === "wave" ? 1.6 : 1.1;
        R.points.push(f.x + Math.cos(a) * rr, f.y + 0.25 + Math.sin(tnow * 6 + k) * 0.15, f.z + Math.sin(a) * rr, 9, 0.9, 0.95, 0.97, 1, 0.7, POINT_SOFT);
      }
    }
    for (const c of this.caller.calls) {
      const f = c.feature; if (!f) continue;
      const col = { left: [0.2, 0.7, 1], right: [1, 0.55, 0.15], forward: [0.3, 1, 0.4], back: [1, 0.3, 0.3] }[c.call];
      R.points.push(f.x, f.y + 1.6, f.z, 12, 0.6, col[0], col[1], col[2], 0.9, 0);
    }
    for (const s of [this.places, this.races, this.others, this.jobs]) s?.draw?.(R, this.labelText, dt);
    this.flowWater(dt);
    this.camera(dt);
    this.bridge.rows("_f2_items", R.items.view(), 10);
    this.bridge.rows("_f2_points", R.points.view(), 10);
    this.bridge.rows("_f2_lines", R.lines.view(), 10);
    this.bridge.rows("_f2_wide_lines", R.wide.view(), 13);
    this.bridge.rows("_f2_lights", R.lights.view(), 12);
    this.bridge.labels(R.labels.view(), this.labelText.join("\x1f"));
    this.hud.update(dt);
    this.audio?.tick?.(dt);
  }

  // Scroll the ripple texture so rivers run downstream.
  flowWater(dt) {
    this.flowAcc = (this.flowAcc || 0) + dt * 24;
    const rows = Math.floor(this.flowAcc);
    if (rows < 1) return;
    this.flowAcc -= rows;
    const t = this.rippleTex, N = 64, stride = N * 4, k = (rows % N) * stride;
    const copy = t.slice();
    t.set(copy.subarray(t.length - k), 0);
    t.set(copy.subarray(0, t.length - k), k);
    this.bridge.updateTexture(this.texSlot, t);
  }

  camera(dt) {
    const b = this.boat, cam = this.kit.cam, s = this.camState;
    if (this.cameraOverride) { this.cameraOverride(cam, dt); return; }
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading);
    // Look along the boat's travel when it moves, else its heading.
    const sp = Math.hypot(b.vx, b.vz);
    const dx = sp > 1.2 ? b.vx / sp : fx, dz = sp > 1.2 ? b.vz / sp : fz;
    const want = Math.atan2(-dz, -dx);
    const free = performance.now() < s.freeUntil;
    if (!free && !this.freeCamera) {
      let d = want - cam.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cam.yaw += d * clamp(dt * 1.8, 0, 1);
      cam.pitch = lerp(cam.pitch, 0.36 + (b.current?.cls >= 3 ? 0.08 : 0), clamp(dt * 1.5, 0, 1));
    }
    const baseDist = { raft: 15, kayak: 11, canoe: 13, dory: 15 }[b.kind] || 14;
    if (!free) cam.dist = lerp(cam.dist, baseDist + sp * 0.6, clamp(dt * 1.2, 0, 1));
    const tx = b.x + dx * 3, tz = b.z + dz * 3;
    cam.tx = lerp(cam.tx, tx, clamp(dt * 6, 0, 1));
    cam.tz = lerp(cam.tz, tz, clamp(dt * 6, 0, 1));
    cam.ty = lerp(cam.ty, b.y + 1.8, clamp(dt * 4, 0, 1));
    // Keep the eye above the ground.
    const cp = Math.cos(cam.pitch);
    const ex = cam.tx + cam.dist * cp * Math.cos(cam.yaw), ez = cam.tz + cam.dist * cp * Math.sin(cam.yaw);
    const ey = cam.ty + cam.dist * Math.sin(cam.pitch);
    const ground = Math.max(heightAt(this.world, ex, ez), waterAt(this.world, ex, ez) || -100) + 1.5;
    if (ey < ground) cam.pitch = Math.min(1.4, Math.asin(clamp((ground - cam.ty) / cam.dist, -1, 1)));
  }
}

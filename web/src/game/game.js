// The game: owns the world, the boat, the camera and the frame loop, and
// wires the systems (rapids, places, journal, jobs, races, network, HUD).
import { Bridge, Rows, MESH_TRANSLUCENT, MESH_UNLIT, TEX_MIPMAPS, PRIM, POINT_SOFT } from "../render/bridge.js";
import { MeshBuilder, waterMesh, shoreMesh, seaMesh, forestMeshes, groundCover, rockMeshes } from "../render/meshes.js";
import { BoatRig } from "../render/boats.js";
import { drawStars, foamStream, boatLantern, cloudMesh, driftClouds, sunGlitter, surfLine, surfDraw, WaterTextures } from "../render/effects.js";
import { makeBoat, stepBoat, stroke, featureIndex, BOATS, dodge } from "../sim/boat.js";
import { buildFeatures, buildRapids, Caller, HIT } from "../sim/rapids.js";
import { heightAt, waterAt } from "../world/terrain.js";
import { clamp, lerp } from "../world/noise.js";
import { Hud } from "../ui/hud.js";
import { Input } from "../ui/input.js";
import { Walker } from "./walker.js";
import { DETAIL, FrameMeter, noteSlow, forestDensity } from "./perf.js";
import { chaseTargets } from "./camera.js";
import { GameCoach } from "./coach.js";

const STEP = 1 / 60;
const DAY_SECONDS = 24 * 60;          // one in-game day in real seconds
const BASE_UNIX = Date.UTC(2026, 5, 18, 0, 0, 0) / 1000; // midsummer, for the sun
const LAT = 47.6, LON = -121.0;

export class Game {
  constructor({ world, mod, canvas, ui, params, tier = null }) {
    this.world = world; this.mod = mod; this.canvas = canvas; this.uiRoot = ui; this.params = params;
    this.tier = tier; this.detailLevel = tier?.detail ?? 2; this.detail = DETAIL[this.detailLevel];
    this.frameMeter = new FrameMeter();
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
      frame: (t, now, dt) => this.frame(t, now, dt), dprCap: this.detail.dprCap,
      onSlow: (s) => this.onSlow(s), onFatal: (c, m) => StrataLoader.fallback(c, m),
      onRestore: () => this.onRestore(),
    });
    const { Places, CAMPS, LANDMARKS } = await import("./places.js");
    this.placesDefs = { CAMPS, LANDMARKS };
    this.places = new Places(this);
    progress(0.05, "Raising the mountains");
    b.terrain(w);
    progress(0.2, "Filling the rivers");
    this.waterTex = new WaterTextures(b, w.seed);
    this.texSlot = this.waterTex.rippleSlot;
    const wm = waterMesh(w);
    // Rivers are unlit: flowWater() tints their textures for the hour, like
    // the sky they reflect, so low sun and moonlight both read on the water.
    this.waterSlot = b.mesh({ ...wm, indices: wm.calm, color: [1, 1, 1, 0.86], flags: MESH_TRANSLUCENT | MESH_UNLIT, texture: this.texSlot });
    this.rapidSlot = b.mesh({ ...wm, indices: wm.rough, color: [1, 1, 1, 0.94], flags: MESH_TRANSLUCENT | MESH_UNLIT, texture: this.waterTex.foamSlot });
    this.shoreSlot = b.mesh(shoreMesh(w), () => shoreMesh(w));   // hides the grid's saw-toothed water edge; rebuilt after a lost context
    this.seaSlot = b.mesh({ ...seaMesh(w), color: [1, 1, 1, 0.9], flags: MESH_TRANSLUCENT, texture: this.texSlot });
    // Clouds are unlit too, tinted by a tiny texture that flowWater() updates.
    this.cloudSlot = b.mesh({ ...cloudMesh(w.size, w.seed, MeshBuilder), flags: MESH_TRANSLUCENT | MESH_UNLIT, texture: this.waterTex.cloudSlot });
    this.surf = surfLine(w, heightAt);
    progress(0.35, "Placing the rocks");
    this.features = buildFeatures(w);
    this.featureIdx = featureIndex(this.features);
    this.rapids = buildRapids(w);
    this.caller = new Caller(this.features, this.rapids);
    b.mesh(rockMeshes(w, this.features));
    progress(0.5, "Growing the forests");
    const density = forestDensity(w.preset, this.detailLevel);   // phones get the small world: fewer trees
    // The world worker usually built the forest already (main.js).
    const forest = w.forest && w.forest.density === density ? w.forest : forestMeshes(w, density, 4);
    w.forest = null;
    // Untextured: no uvs (8 B a vertex). The engine keeps no copy of the
    // forest (hundreds of MB on the full world); after a lost WebGL context it
    // is rebuilt here from the world (rebuildForest).
    const noUv = (m) => (m.texture == null ? { ...m, uvs: null } : m);
    this.forestDensity = density;
    forest.meshes.forEach((m, i) => b.mesh(noUv(m), () => this.rebuildForest().then((ms) => noUv(ms[i]))));
    // Ground cover (grass, flowers, reeds, pebbles) follows the same device tier.
    groundCover(w, (w.preset === "full" ? 0.5 : 0.25) * Math.min(1, density / (w.preset === "full" ? 1 : 0.3)), 4).meshes.forEach((m) => b.mesh(m));
    this.treeCount = forest.count;
    this.treeIdx = featureIndex(forest.trees, 12);

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
    const { Progress } = await import("./progress.js");
    this.progress = new Progress(this);
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
    this.walker = new Walker(this);
    this.coach = new GameCoach(this, this.uiRoot);   // first five minutes + quiet-river hints
    this.canvas.addEventListener("pointerdown", () => { this.camState.freeUntil = performance.now() + 4000; });
    this.canvas.addEventListener("wheel", () => { this.camState.freeUntil = performance.now() + 4000; }, { passive: true });
    this.boatsOwned = new Set(["raft"]);
    if (saved) this.save.apply(saved);
    const P = await import("../ui/panels.js");
    this.hud.register("title", new P.TitlePanel(this, this.uiRoot));
    this.hud.register("menu", new P.MenuPanel(this, this.uiRoot));
    this.hud.register("camp", new P.CampPanel(this, this.uiRoot));
    this.hud.register("map", new P.MapPanel(this, this.uiRoot));
    this.hud.register("journal", new P.JournalPanel(this, this.uiRoot));
    this.hud.register("players", new P.PlayersPanel(this, this.uiRoot));
    const saveNote = this.save.notice();
    if (saveNote) this.hud.toast(saveNote, 8);
    try { const A = await import("../audio/audio.js"); this.audio = new A.Audio(this); } catch (e) { this.audio = null; }
    const unlock = () => this.audio?.unlock?.();
    addEventListener("pointerdown", unlock, { once: true }); addEventListener("keydown", unlock, { once: true });
    b.shrink();
    progress(1, "Ready");
  }

  makeBoatMeshes(kind) {
    const b = this.bridge;
    this.rig?.dispose();
    const colour = this.colour || BOATS[kind].colour;
    this.rig = new BoatRig(b, kind, colour);
  }

  setBoat(kind) {
    const old = this.boat;
    this.boat = makeBoat(kind, old.x, old.z, old.heading);
    this.boat.y = old.y; this.boat.moored = old.moored;
    this.makeBoatMeshes(kind);
    this.progress?.fit(this.boat);
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
  // Where the player is: on foot, or in the boat.
  pos() { return this.walker?.active ? this.walker : this.boat; }

  playerStroke(kind) {
    const now = this.time;
    if (this.paused || this.walker?.active) return;
    const verdict = this.caller.judge(kind, now);
    let power = 1;
    if (verdict) {
      const j = verdict.judgment;
      power = j === "perfect" ? 1.35 : j === "good" ? 1.15 : j === "late" || j === "early" ? 1.0 : 0.6;
      if (j === "wrong" && !verdict.call.fill) this.penalty(0.12, "Wrong call!");
      this.hud.judgment(j, verdict.call.call);
      this.audio?.judgment(j);
    }
    if (this.boat.swimming) return;
    if (stroke(this.boat, kind, power * (1 + this.caller.flow * 0.25), now)) this.audio?.stroke(kind);
    // A clean stroke on a rock call takes the line round the rock (sim/boat.js dodge).
    const f = verdict?.call?.feature;
    if (f?.kind === "rock" && HIT.has(verdict.judgment)) dodge(this.boat, f, verdict.call.call);
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
    if (this.walker?.active) { this.walker.active = false; this.walker.setVisible(false); this.cameraOverride = null; this.boat.moored = false; }
    const b = this.boat, s = camp.sample;
    const x = camp.x + camp.nx * 15, z = camp.z + camp.nz * 15;
    b.x = x; b.z = z; b.vx = b.vz = 0; b.spin = 0; b.heading = s ? Math.atan2(s.tz, s.tx) : b.heading;
    b.y = waterAt(this.world, x, z) || b.y;
    this.jobs?.onShuttle?.();
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
    b.hull = Math.max(0, b.hull - amount * 0.3 * (b.spec.hullWear ?? 1));
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

  // The forest's meshes again, once per context restore. They must come from
  // the untouched terrain (places.build() flattens the camps afterwards, which
  // would move trees), so the world worker builds them again from the seed;
  // without a worker, a fresh world is built here.
  rebuildForest() {
    if (this.forestJob) return this.forestJob;
    const w = this.world, request = { seed: w.seed, preset: w.preset, forest: { density: this.forestDensity, chunks: 4 } };
    const onMain = async () => {
      const [{ generateWorld }] = await Promise.all([import("../world/terrain.js")]);
      return forestMeshes(generateWorld(w.seed, w.preset), this.forestDensity, 4).meshes;
    };
    this.forestJob = new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(new URL("../world/worker.js", import.meta.url), { type: "module" }); }
      catch (_) { onMain().then(resolve, reject); return; }
      worker.onmessage = (e) => {
        const d = e.data || {};
        if (d.error) { worker.terminate(); onMain().then(resolve, reject); }
        else if (d.grids) { worker.terminate(); d.forest ? resolve(d.forest.meshes) : onMain().then(resolve, reject); }
      };
      worker.onerror = (e) => { e.preventDefault?.(); worker.terminate(); onMain().then(resolve, reject); };
      worker.postMessage(request);
    });
    this.forestJob.finally(() => { this.forestJob = null; }).catch(() => {});
    return this.forestJob;
  }

  // The kit rebuilt the engine after a lost WebGL context: hand back the
  // meshes the engine did not keep (the forest pops back in a moment later).
  async onRestore() {
    const t0 = performance.now();
    this.restoring = true;
    try {
      const r = await this.bridge.restore();
      this.restored = { ...r, ms: Math.round(performance.now() - t0) };
      console.log(`forward-two: context restored; ${r.refilled} meshes rebuilt in ${this.restored.ms} ms${r.failed ? `, ${r.failed} failed` : ""}`);
    } finally { this.restoring = false; }
  }

  // The kit has lowered everything it can and frames are still slow: drop the
  // game's own detail, and remember it so the next visit starts lighter.
  onSlow({ frameMs } = {}) {
    noteSlow(this.world.preset, frameMs);
    if (this.detailLevel > 0) { this.detailLevel--; this.detail = DETAIL[this.detailLevel]; }
    if (this.world.preset === "full") this.hud?.toast("This device is struggling with the full valley. Next time it starts with the lighter world.", 6);
  }

  // One frame, measured. An exception is logged and the loop carries on; a
  // run of failing frames stops the loop and shows the error screen (no
  // save is written from a state that keeps throwing).
  frame(t, now, dt) {
    const t0 = performance.now();
    try { this.frameBody(t, now, dt); this.frameFails = 0; } catch (e) {
      this.frameMeter.errors++; this.frameFails = (this.frameFails || 0) + 1;
      if (this.frameMeter.errors <= 3) console.error("frame", e);
      if (this.frameFails === 90) {
        this.kit.running = false;
        import("../ui/errors.js").then((m) => m.showError(Object.assign(e instanceof Error ? e : new Error(String(e)), { code: "crash" })));
      }
    }
    this.frameMeter.add(performance.now() - t0);
    this.perfOverlay?.tick(dt || 0);
  }

  frameBody(t, now, dt) {
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
    this.walker.tick(dt);
    const evs = b.moored ? [] : stepBoat(this.world, b, dt, this.featureIdx);
    for (const e of evs) {
      if (e.type === "bank") this.penalty(Math.min(0.25, (e.speed - 1.2) * 0.08), null);
      if (e.type === "rock") {   // one rock, one penalty (sim/rapids.js rockHit)
        const p = this.caller.rockHit(e.feature, e.speed, this.time);
        if (p) { if (p.call) this.hud.judgment("miss", p.call.call); this.penalty(p.amount, p.text); }
      }
      if (e.type === "drop") { this.hud.flash(`Drop! ${e.height.toFixed(0)} m`); this.audio?.splash(1); this.journal.onDrop(e.height); }
    }
    for (const e of (b.moored ? [] : this.caller.update(this.time, b))) {
      if (e.type === "enter") { this.hud.rapid(e.rapid); this.audio?.rapid(e.rapid); }
      if (e.type === "leave") { this.hud.rapidDone(e.rapid, e.stats); this.journal.onRapid(e.rapid, e.stats, b); }
      if (e.type === "call") this.audio?.call(e.call, e.time - this.time);
      if (e.type === "miss") {
        this.hud.judgment("miss", e.call.call);
        const p = this.caller.missPenalty(e.call);   // null for drive and swim calls, or a rock already paid for
        if (p) this.penalty(p.amount, p.text);
        const f = e.call.feature;
        if (p && f && f.kind !== "rock") { b.vx *= 0.6; b.vz *= 0.6; b.spin += (Math.random() - 0.5) * 2; }
      }
    }
    if (b.swimming && this.caller.swim) {
      if (this.caller.swim.landed >= 2) { b.swimming = false; b.stability = 0.45; this.caller.endSwim(); this.hud.flash("Back in the boat!"); }
      else if (this.caller.swim.misses >= 2) { this.washAshore(); }
    }
    // Flow burst.
    if (this.caller.flow >= 1 && !this.flowBurst) { this.flowBurst = true; this.hud.flash("In the line!"); this.journal.onFlow(); }
    if (this.caller.flow < 0.6) this.flowBurst = false;
    for (const s of [this.places, this.journal, this.jobs, this.races, this.progress, this.net, this.others, this.save, this.coach]) s?.tick?.(dt);
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
    // Golden hour warms the sun and the shade; night cools the ambient.
    const dusk = clamp(1 - Math.abs(elev - 6) / 16, 0, 1), warm = elev > -2 ? clamp(1 - (elev - 2) / 30, 0, 1) : 0;
    this.warm = warm;
    this.bridge.levels(new Float32Array([
      1 + 0.04 * warm - 0.12 * night, 1 - 0.06 * warm - 0.05 * night, 1 - 0.2 * warm + 0.04 * night,
      // Moonlight: enough lift that banks, rocks and wakes stay readable at night.
      0.15 * night + 0.01, 0.19 * night + 0.012, 0.31 * night + 0.02,
      1 + dusk * 0.08, 1, 1 - warm * 0.38, 1 - warm * 0.75,
    ]));
    // Boat and crew: the rig paddles with the strokes, leans and bobs.
    this.rig.drive(b, this.paused ? 0 : dt);
    this.rig.fx(R.points, POINT_SOFT);

    // Spray and foam.
    const cur = b.current;
    if (cur && cur.cls >= 2) {
      for (let k = 0; k < this.detail.spray; k++) {
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 1.8;
        R.points.push(b.x + Math.cos(a) * r, b.y + 0.2 + Math.random() * 0.6 * cur.cls / 3, b.z + Math.sin(a) * r, 5, 0.35, 0.95, 0.97, 1, 0.55, POINT_SOFT);
      }
    }
    boatLantern(R, b, night);
    if (cur?.hit) foamStream(R, cur.hit.river.samples, cur.hit.sample.i, this.time, night);
    if (!this.walker?.active) sunGlitter(R, b, this.clock, elev, this.time, (x, z) => waterAt(w, x, z));
    // Features near the boat: foam on holes and waves, flags on calls.
    const tnow = this.time;
    for (const f of this.featureIdx.near(b.x, b.z, this.detail.foamRadius)) {
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
    drawStars(R, this.kit.cam, night, this.time);
    surfDraw(R, this.surf, this.kit.cam.tx, this.kit.cam.tz, this.time);
    this.bridge.transform(this.cloudSlot, driftClouds(this.time, this.cloudMat ||= new Float32Array(16)));
    this.walker.draw();
    for (const s of [this.places, this.races, this.others, this.jobs, this.progress, this.coach]) s?.draw?.(R, this.labelText, dt);
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

  // Scroll the water textures downstream and tint them (and the clouds) for the hour.
  flowWater(dt) { this.waterTex.update(dt, this.night || 0, this.warm || 0); }

  camera(dt) {
    const b = this.boat, cam = this.kit.cam, s = this.camState;
    if (this.cameraOverride) { this.cameraOverride(cam, dt); return; }
    // Targets from game/camera.js: smooth heading→travel blend, downstream framing in rapids.
    const T = chaseTargets(b, !!this.caller.rapid);
    const free = performance.now() < s.freeUntil;
    if (!free && !this.freeCamera) {
      let d = T.yaw - cam.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cam.yaw += d * clamp(dt * T.yawRate, 0, 1);
      cam.pitch = lerp(cam.pitch, T.pitch, clamp(dt * 1.5, 0, 1));
    }
    if (!free) cam.dist = lerp(cam.dist, T.dist, clamp(dt * 1.2, 0, 1));
    const tx = b.x + T.dx * T.ahead, tz = b.z + T.dz * T.ahead;
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

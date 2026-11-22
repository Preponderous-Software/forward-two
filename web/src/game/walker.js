// On foot: step off the boat at a camp and walk anywhere on land. The boat
// stays tied at the dock. Movement is relative to the camera (drag to look);
// the camera never turns by itself. Walk up to the fire, the job board, the
// boat rack, the truck or the dock and press E (or tap the prompt).
import { personMesh, legMesh, boatMatrix } from "../render/boats.js";
import { heightAt, waterAt } from "../world/terrain.js";
import { clamp, lerp } from "../world/noise.js";

const WALK = 3.0, RUN = 6.0, KNEE = 0.45, STEP_UP = 0.9;

export class Walker {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0; this.vx = 0; this.vz = 0;
    this.phase = 0; this.camp = null; this.slots = null;
    this.m = new Float32Array(16);
  }

  ensureMeshes() {
    if (this.slots) return;
    const g = this.game, colour = g.colour || g.boat.spec.colour;
    this.slots = { body: g.bridge.mesh(personMesh(colour, false)), legL: g.bridge.mesh(legMesh()), legR: g.bridge.mesh(legMesh()) };
  }

  setVisible(v) { if (this.slots) for (const s of Object.values(this.slots)) this.game.bridge.visible(s, v); }

  // Step ashore at camp c: on the bank by the dock, facing inland.
  disembark(c) {
    const g = this.game, b = g.boat;
    if (b.swimming) return false;
    this.ensureMeshes();
    // Moor the boat beside the dock.
    const [mx, mz] = c.P(8.5, 2.2);
    const wl = waterAt(g.world, mx, mz);
    if (!Number.isNaN(wl)) { b.x = mx; b.z = mz; b.y = wl; }
    b.vx = b.vz = 0; b.spin = 0; b.heading = c.yaw + Math.PI / 2; b.moored = true;
    // Stand on the bank at the foot of the dock.
    let [x, z] = c.P(2.5, 0);
    for (let k = 0; k < 20 && !this.standable(x, z); k++) [x, z] = c.P(2.5 - k * 0.5, 0);
    this.x = x; this.z = z; this.y = heightAt(g.world, x, z); this.vx = this.vz = 0;
    this.heading = c.yaw + Math.PI;        // inland
    this.camp = c; this.active = true;
    this.setVisible(true);
    g.caller.reset();
    // Look over the walker's shoulder, inland. Set once; never turned again.
    const cam = g.kit.cam;
    cam.yaw = Math.atan2(-Math.sin(this.heading), -Math.cos(this.heading));
    cam.pitch = 0.32; cam.dist = 7.5;
    cam.tx = x; cam.tz = z; cam.ty = this.y + 1.5;
    g.cameraOverride = (cm, dt) => this.camera(cm, dt);
    g.hud.toast(`You step ashore at ${c.name}. Walk anywhere; the dock takes you back to the boat.`, 4.5);
    g.net?.sendHello?.();
    return true;
  }

  embark() {
    const g = this.game, b = g.boat;
    this.active = false;
    this.setVisible(false);
    b.moored = false;
    g.cameraOverride = null;
    g.snapCamera();
    g.hud.prompt(null);
    g.hud.toast("Back in the boat.");
    g.net?.sendHello?.();
  }

  standable(x, z) {
    const w = this.game.world, h = heightAt(w, x, z), wl = waterAt(w, x, z);
    if (x < 2 || z < 2 || x > w.size - 2 || z > w.size - 2) return false;
    return Number.isNaN(wl) || wl - h < KNEE;
  }

  blocked(x, z) {
    for (const t of this.game.treeIdx?.near(x, z, 2) || []) if (Math.hypot(t.x - x, t.z - z) < t.r + 0.3) return true;
    for (const c of this.game.places.camps) {
      if (Math.abs(c.x - x) > 40 || Math.abs(c.z - z) > 40) continue;
      for (const o of c.obstacles || []) if (Math.hypot(o.x - x, o.z - z) < o.r) return true;
    }
    return false;
  }

  // The camp spot within reach, if any.
  spot() {
    let best = null, bd = Infinity;
    for (const c of this.game.places.camps) {
      if (Math.abs(c.x - this.x) > 40 || Math.abs(c.z - this.z) > 40) continue;
      for (const s of c.spots || []) {
        const d = Math.hypot(s.x - this.x, s.z - this.z);
        if (d < s.r && d < bd) { bd = d; best = { ...s, camp: c }; }
      }
    }
    return best;
  }

  interact() {
    const s = this.spot();
    if (!s) return false;
    const g = this.game;
    if (s.embark) {
      if (s.camp !== this.camp) this.moveBoatTo(s.camp);
      this.embark();
    } else g.hud.panels.camp?.openAt(s.camp, s.tab);
    return true;
  }

  // Walking to another camp's dock: the boat is fetched there (a camp hand rows it over).
  moveBoatTo(c) {
    const b = this.game.boat, [mx, mz] = c.P(8.5, 2.2), wl = waterAt(this.game.world, mx, mz);
    if (!Number.isNaN(wl)) { b.x = mx; b.z = mz; b.y = wl; b.heading = c.yaw + Math.PI / 2; }
    this.camp = c;
  }

  tick(dt) {
    if (!this.active) return;
    const g = this.game, held = g.input.held, cam = g.kit.cam;
    const f = (held.has("forward") ? 1 : 0) - (held.has("back") ? 1 : 0);
    const r = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    // Camera-relative: forward is away from the eye, right is screen-right.
    const fx = -Math.cos(cam.yaw), fz = -Math.sin(cam.yaw), rx = -Math.sin(cam.yaw), rz = Math.cos(cam.yaw);
    let mx = fx * f + rx * r, mz = fz * f + rz * r;
    const ml = Math.hypot(mx, mz);
    const speed = g.input.shift ? RUN : WALK;
    if (ml > 0) { mx /= ml; mz /= ml; }
    this.vx = lerp(this.vx, mx * speed, clamp(dt * 10, 0, 1));
    this.vz = lerp(this.vz, mz * speed, clamp(dt * 10, 0, 1));
    const step = (nx, nz) => {
      if (!this.standable(nx, nz) || this.blocked(nx, nz)) return false;
      const dh = heightAt(g.world, nx, nz) - this.y;
      return dh < STEP_UP * Math.max(0.05, Math.hypot(nx - this.x, nz - this.z)) + 0.05;
    };
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (step(nx, nz)) { this.x = nx; this.z = nz; }
    else if (step(nx, this.z)) { this.x = nx; this.vz = 0; }
    else if (step(this.x, nz)) { this.z = nz; this.vx = 0; }
    else { this.vx = 0; this.vz = 0; }
    this.y = lerp(this.y, heightAt(g.world, this.x, this.z), clamp(dt * 14, 0, 1));
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.2) {
      const want = Math.atan2(this.vz, this.vx);
      let d = want - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * clamp(dt * 10, 0, 1);
      this.phase += dt * sp * 2.6;
    } else this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, clamp(dt * 8, 0, 1));
    const s = this.spot();
    const touch = g.input.touch;
    g.hud.prompt(g.hud.anyOpen() ? null : s ? `${touch ? `<button class="btn" id="p-spot">${s.label}</button>` : `<kbd>E</kbd> ${s.label}`}` : touch ? null : `<span class="small"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> run · drag to look</span>`);
    const pb = document.getElementById("p-spot");
    if (pb && !pb.onclick) pb.onclick = () => this.interact();
  }

  camera(cam, dt) {
    cam.tx = lerp(cam.tx, this.x, clamp(dt * 8, 0, 1));
    cam.tz = lerp(cam.tz, this.z, clamp(dt * 8, 0, 1));
    cam.ty = lerp(cam.ty, this.y + 1.5, clamp(dt * 6, 0, 1));
    if (performance.now() > this.game.camState.freeUntil) cam.dist = lerp(cam.dist, 7.5, clamp(dt * 2, 0, 1));
    // Keep the eye out of the hillside.
    const cp = Math.cos(cam.pitch);
    const ex = cam.tx + cam.dist * cp * Math.cos(cam.yaw), ez = cam.tz + cam.dist * cp * Math.sin(cam.yaw);
    const ground = heightAt(this.game.world, ex, ez) + 1.2;
    if (cam.ty + cam.dist * Math.sin(cam.pitch) < ground) cam.pitch = Math.min(1.3, Math.asin(clamp((ground - cam.ty) / cam.dist, -1, 1)));
  }

  draw() {
    if (!this.active || !this.slots) return;
    const g = this.game, m = this.m, h = this.heading;
    const bob = Math.abs(Math.sin(this.phase)) * 0.05;
    boatMatrix(this.x, this.y + bob, this.z, h, 0, 0, 1, m);
    g.bridge.transform(this.slots.body, m);
    const swing = Math.sin(this.phase) * 0.6;
    const side = (s) => [this.x - Math.sin(h) * 0.12 * s, this.z + Math.cos(h) * 0.12 * s];
    const [lx, lz] = side(-1), [rx2, rz2] = side(1);
    boatMatrix(lx, this.y + 0.9 + bob, lz, h, swing, 0, 1, m); g.bridge.transform(this.slots.legL, m);
    boatMatrix(rx2, this.y + 0.9 + bob, rz2, h, -swing, 0, 1, m); g.bridge.transform(this.slots.legR, m);
  }
}

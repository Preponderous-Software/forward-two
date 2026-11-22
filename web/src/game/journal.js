// The River Journal: places found, feats done, pay earned, and the map's
// explored cells. Saved through Save.
export const FEATS = [
  { id: "first-rapid", name: "First Rapid", text: "Run any rapid.", icon: "wave" },
  { id: "clean-line", name: "Clean Line", text: "Run a class III+ rapid with no misses.", icon: "line" },
  { id: "throat", name: "Through the Throat", text: "Run the Throat without swimming.", icon: "throat" },
  { id: "falls", name: "Over the Falls", text: "Go over the High Falls in your boat.", icon: "falls" },
  { id: "swim", name: "Swimmer", text: "Swim a rapid. Everyone does.", icon: "swim" },
  { id: "flow", name: "In the Line", text: "Fill the flow meter.", icon: "flow" },
  { id: "night", name: "Night Paddler", text: "Paddle for two minutes after dark.", icon: "moon" },
  { id: "camps", name: "Every Camp", text: "Visit all eight camps.", icon: "tent" },
  { id: "landmarks", name: "Cartographer", text: "Find every landmark.", icon: "map" },
  { id: "courier", name: "Courier", text: "Deliver five loads.", icon: "crate" },
  { id: "gold", name: "Gold Medal", text: "Win gold on any race course.", icon: "medal" },
  { id: "sea", name: "Source to Sea", text: "Reach the sea after starting at Tarn Spring.", icon: "sea" },
];

export class Journal {
  constructor(game) {
    this.game = game;
    this.found = new Set();
    this.feats = new Set();
    this.visited = new Set();
    this.pay = 0;
    this.deliveries = 0;
    this.nightTime = 0;
    this.explored = new Uint8Array(64 * 64);
    this.fromSource = false;
  }

  has(id) { return this.found.has(id); }

  restore(data) {
    if (!data) return;
    (data.found || []).forEach((id) => this.found.add(id));
    (data.feats || []).forEach((id) => this.feats.add(id));
    (data.visited || []).forEach((id) => this.visited.add(id));
    this.pay = data.pay || 0; this.deliveries = data.deliveries || 0;
    if (data.explored) { try { const s = atob(data.explored); for (let i = 0; i < s.length && i < this.explored.length; i++) this.explored[i] = s.charCodeAt(i); } catch (_) { /* keep blank */ } }
    this.fromSource = !!data.fromSource;
  }

  data() {
    let s = ""; for (const v of this.explored) s += String.fromCharCode(v);
    return { found: [...this.found], feats: [...this.feats], visited: [...this.visited], pay: this.pay, deliveries: this.deliveries, explored: btoa(s), fromSource: this.fromSource };
  }

  discover(p) {
    if (this.found.has(p.id)) return;
    this.found.add(p.id);
    const g = this.game;
    g.hud.discovery(p);
    this.earn(p.kind ? 15 : 10, null);
    if (p.id === "spring") this.fromSource = true;
    const { CAMPS, LANDMARKS } = g.placesDefs;
    if (LANDMARKS.every((l) => this.found.has(l.id))) this.feat("landmarks");
    if (CAMPS.every((c) => this.found.has(c.id))) this.feat("camps");
    g.save?.soon();
  }

  visitCamp(c) { this.visited.add(c.id); }

  feat(id) {
    if (this.feats.has(id)) return;
    this.feats.add(id);
    const f = FEATS.find((x) => x.id === id);
    if (f) { this.game.hud.featCard(f); this.earn(25, null); this.game.audio?.bark?.("clean"); }
    this.game.save?.soon();
  }

  earn(n, why) { this.pay += n; if (why) this.game.hud.toast(`+${n} pay · ${why}`); }

  onRapid(rapid, stats, boat) {
    this.feat("first-rapid");
    if (rapid.cls >= 3 && stats.miss === 0 && stats.perfect + stats.good >= 3) { this.feat("clean-line"); this.game.audio?.bark?.("clean"); }
    if (rapid.name === "The Throat" && boat.flips === (this.throatFlips ?? boat.flips)) this.feat("throat");
    this.throatFlips = boat.flips;
  }
  onDrop(h) { if (h > 8) this.feat("falls"); }
  onFlow() { this.feat("flow"); }
  onFlip() { this.feat("swim"); }

  tick(dt) {
    const g = this.game, b = g.pos(), w = g.world;
    const i = Math.floor(b.x / w.size * 64), j = Math.floor(b.z / w.size * 64);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < 64 && jj < 64) this.explored[jj * 64 + ii] = 1;
    }
    if (g.night > 0.6 && !g.walker?.active && Math.hypot(b.vx, b.vz) > 0.5) { this.nightTime += dt; if (this.nightTime > 120) this.feat("night"); }
    if (this.fromSource && !g.walker?.active && w.water && b.current && !b.current.hit && !w.lake.inside(b.x, b.z) && b.x + b.z > w.size * 1.82) { this.feat("sea"); }
    if (!g.walker?.active && b.current?.hit?.river.id === "long" && b.current.hit.sample.s < 40) this.fromSource = true;
  }
}

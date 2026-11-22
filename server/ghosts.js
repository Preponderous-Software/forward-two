// Ghost and board store: top 20 per course, one JSON file per course under
// <data>/ghosts/, written atomically (temp file + rename), one write at a time
// per course.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { checkGhost, MAX_GHOST_CHARS } from "../web/src/net/ghost.js";
import { cleanName, validCourse, validRaceMs } from "./validate.js";
import { checkCourseRun } from "../web/src/game/courses.js";

export const KEEP = 20;

export class GhostStore {
  // courses: optional {id: course} from buildCourses(); when given, only those
  // courses take ghosts, and a ghost must pass each course's gates in order.
  constructor(dataDir, courses = null) {
    this.courses = courses;
    this.dir = join(dataDir, "ghosts");
    this.cache = new Map();   // course -> entries[]
    this.queue = new Map();   // course -> Promise (write chain)
    this.ready = mkdir(this.dir, { recursive: true });
  }

  file(course) { return join(this.dir, `${course}.json`); }

  async load(course) {
    if (this.cache.has(course)) return this.cache.get(course);
    await this.ready;
    let list = [];
    try {
      const j = JSON.parse(await readFile(this.file(course), "utf8"));
      if (Array.isArray(j)) list = j.filter((e) => e && typeof e.ghost === "string" && Number.isFinite(e.ms));
    } catch { /* missing or unreadable: start empty */ }
    this.cache.set(course, list);
    return list;
  }

  // Validates and ranks one run. Returns {ok, rank|null, status, reason?}.
  async submit(course, body) {
    if (!validCourse(course)) return { ok: false, status: 400, reason: "bad course id" };
    if (!body || typeof body !== "object") return { ok: false, status: 400, reason: "bad body" };
    const { ms, ghost } = body;
    if (!validRaceMs(ms)) return { ok: false, status: 400, reason: "bad time" };
    if (typeof ghost !== "string" || ghost.length > MAX_GHOST_CHARS) return { ok: false, status: 413, reason: "ghost too large" };
    if (this.courses && !this.courses[course]) return { ok: false, status: 404, reason: "unknown course" };
    const check = checkGhost(ghost, ms);
    if (!check.ok) return { ok: false, status: 422, reason: check.reason };
    if (this.courses) {
      const run = checkCourseRun(this.courses[course], check.decoded);
      if (!run.ok) return { ok: false, status: 422, reason: run.reason };
    }
    const name = cleanName(body.name);
    const entry = { name, ms: Math.round(ms), at: Date.now(), ghost };
    // Serialise per course so concurrent posts cannot lose each other.
    const prev = this.queue.get(course) || Promise.resolve();
    const run = prev.then(async () => {
      const list = (await this.load(course)).slice();
      // One entry per name: keep that paddler's best.
      const mine = list.findIndex((e) => e.name === name);
      if (mine >= 0 && list[mine].ms <= entry.ms) return { ok: true, status: 200, rank: null, best: list[mine].ms };
      if (mine >= 0) list.splice(mine, 1);
      list.push(entry);
      list.sort((a, b) => a.ms - b.ms || a.at - b.at);
      const kept = list.slice(0, KEEP);
      const idx = kept.indexOf(entry);
      if (idx < 0 && mine < 0) return { ok: true, status: 200, rank: null };
      await this.write(course, kept);
      this.cache.set(course, kept);
      return { ok: true, status: 201, rank: idx >= 0 ? idx + 1 : null };
    });
    this.queue.set(course, run.catch(() => {}));
    return run;
  }

  async write(course, list) {
    await this.ready;
    const f = this.file(course), tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(list));
    await rename(tmp, f);
  }

  async top(course, n = 5) {
    const list = await this.load(course);
    return list.slice(0, Math.max(1, Math.min(KEEP, n | 0 || 5))).map((e, i) => ({ rank: i + 1, name: e.name, ms: e.ms, at: e.at, ghost: e.ghost }));
  }

  async board(course) {
    const list = await this.load(course);
    return list.map((e, i) => ({ rank: i + 1, name: e.name, ms: e.ms, at: e.at }));
  }
}

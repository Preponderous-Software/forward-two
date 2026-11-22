// The HTTP side: /healthz, the ghost/board API, optional static files, and
// the WebSocket upgrade (any path; /ws by convention).
import { createServer as createHttp } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { upgrade } from "./ws.js";
import { Hub } from "./rooms.js";
import { GhostStore } from "./ghosts.js";
import { validCourse } from "./validate.js";

export const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const MAX_BODY = 96 * 1024;

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []; let n = 0;
    req.on("data", (d) => {
      n += d.length;
      if (n > limit) { fail(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

// opts: {data, static, hub (Hub options), postsPerMin (per IP, default 12), log}
export function createApp(opts = {}) {
  const store = new GhostStore(opts.data || "./data");
  const hub = new Hub(opts.hub || {});
  const staticRoot = opts.static ? resolve(opts.static) : null;
  const log = opts.log || (() => {});
  const postsPerMin = opts.postsPerMin ?? 12;
  // Behind a reverse proxy every socket is the proxy's: with trustProxy the
  // client is the LAST X-Forwarded-For entry (the one the proxy itself added).
  const trustProxy = !!opts.trustProxy;
  const clientOf = (req) => {
    if (trustProxy) {
      const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || "";
  };
  const posts = new Map(); // ip -> {n, reset}
  const conns = new Set();

  function postAllowed(ip) {
    const t = Date.now(); let e = posts.get(ip);
    if (!e || t > e.reset) { e = { n: 0, reset: t + 60_000 }; posts.set(ip, e); }
    if (posts.size > 10_000) for (const [k, v] of posts) if (t > v.reset) posts.delete(k);
    return ++e.n <= postsPerMin;
  }

  async function api(req, res, url) {
    const m = url.pathname.match(/^\/api\/(ghosts|board)\/([^/]*)$/);
    if (!m) return json(res, 404, { error: "not found" });
    const [, kind, course] = m;
    if (!validCourse(course)) return json(res, 400, { error: "bad course id" });
    if (kind === "board") {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, { course, board: await store.board(course) });
    }
    if (req.method === "GET") {
      const n = Number(url.searchParams.get("n") || 5);
      return json(res, 200, { course, ghosts: await store.top(course, n) });
    }
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!postAllowed(clientOf(req))) return json(res, 429, { error: "slow down" });
    let body;
    try { body = JSON.parse(await readBody(req, MAX_BODY)); } catch (e) { return json(res, e.status || 400, { error: e.status ? "too large" : "bad json" }); }
    const r = await store.submit(course, body);
    if (!r.ok) return json(res, r.status, { error: r.reason });
    log(`ghost ${course} ${body.ms} rank=${r.rank}`);
    return json(res, r.status, { ok: true, rank: r.rank, board: await store.board(course) });
  }

  async function serveStatic(req, res, url) {
    if (!staticRoot || (req.method !== "GET" && req.method !== "HEAD")) { res.writeHead(404, CORS); return res.end("not found"); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.includes("\0")) { res.writeHead(400); return res.end(); }
    let file = resolve(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) { res.writeHead(403); return res.end(); }
    let st;
    try { st = await stat(file); if (st.isDirectory()) { file = join(file, "index.html"); st = await stat(file); } } catch { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  }

  const server = createHttp(async (req, res) => {
    let url;
    try { url = new URL(req.url, "http://x"); } catch { res.writeHead(400); return res.end(); }
    try {
      if (url.pathname === "/healthz") return json(res, 200, { ok: true, ...hub.stats() });
      if (url.pathname.startsWith("/api/")) {
        if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
        return await api(req, res, url);
      }
      return await serveStatic(req, res, url);
    } catch (e) {
      log(`error ${e.stack || e}`);
      if (!res.headersSent) json(res, 500, { error: "server error" }); else res.destroy();
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const conn = upgrade(req, socket, head);
    if (!conn) return;
    conns.add(conn);
    conn.on("close", () => conns.delete(conn));
    const url = new URL(req.url, "http://x");
    hub.attach(conn, { seed: url.searchParams.get("seed") ?? undefined, room: url.searchParams.get("room") ?? undefined });
    if (head && head.length) conn.feed(head);
  });

  // Heartbeat: ping quiet connections, drop dead ones.
  const beat = setInterval(() => {
    const t = Date.now();
    for (const c of conns) {
      if (t - c.lastSeen > 45_000) c.destroy();
      else if (t - c.lastSeen > 20_000) c.ping();
    }
  }, 10_000);
  beat.unref?.();

  return {
    server, hub, store,
    listen(port = 8790, host) {
      return new Promise((ok, fail) => {
        server.once("error", fail);
        server.listen(port, host, () => ok(server.address().port));
      });
    },
    close() {
      clearInterval(beat);
      hub.stop();
      for (const c of conns) c.destroy();
      return new Promise((ok) => { server.close(() => ok()); server.closeAllConnections?.(); });
    },
  };
}

#!/usr/bin/env node
// Forward Two multiplayer service.
//   node server/main.js [--port 8790] [--host 0.0.0.0] [--data ./data] [--static web]
import { createApp } from "./app.js";

function args(argv) {
  const o = { port: Number(process.env.PORT) || 8790, host: process.env.HOST || undefined, data: process.env.F2_DATA || "./data", static: process.env.F2_STATIC || null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--port") { o.port = Number(v); i++; }
    else if (a === "--host") { o.host = v; i++; }
    else if (a === "--data") { o.data = v; i++; }
    else if (a === "--static") { o.static = v; i++; }
    else if (a === "--help" || a === "-h") {
      console.log("usage: node server/main.js [--port 8790] [--host H] [--data ./data] [--static <dir>]");
      process.exit(0);
    } else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) { console.error("bad --port"); process.exit(2); }
  return o;
}

const o = args(process.argv.slice(2));
const app = createApp({ data: o.data, static: o.static, log: (s) => console.log(new Date().toISOString(), s) });
const port = await app.listen(o.port, o.host);
console.log(`forward-two server on :${port}${o.static ? ` (static: ${o.static})` : ""} data=${o.data}`);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log(`${sig}: closing`);
    const t = setTimeout(() => process.exit(0), 3000); t.unref();
    await app.close();
    process.exit(0);
  });
}

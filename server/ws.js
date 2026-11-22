// A small RFC 6455 WebSocket server side: handshake, framing, ping/pong, close.
// Text frames only (binary is refused with 1003), 64 KB max message, client
// frames must be masked. No dependencies.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_FRAME = 64 * 1024;
const OP = { CONT: 0, TEXT: 1, BIN: 2, CLOSE: 8, PING: 9, PONG: 10 };
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

// Completes the handshake on an 'upgrade' request. Returns a WsConn or null
// (after answering 400/426 itself).
export function upgrade(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  const ok = req.method === "GET" &&
    String(req.headers.upgrade || "").toLowerCase() === "websocket" &&
    /\bupgrade\b/i.test(String(req.headers.connection || "")) &&
    typeof key === "string" && /^[A-Za-z0-9+/]{22}==$/.test(key);
  if (!ok) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return null;
  }
  if (req.headers["sec-websocket-version"] !== "13") {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return null;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  // The caller attaches its listeners, then feeds `head` (bytes that arrived
  // with the upgrade request) with conn.feed(head).
  return new WsConn(socket);
}

// Builds one frame. mask: a 4-byte Buffer (client side) or null (server side).
export function frame(opcode, payload, mask = null) {
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : (payload || Buffer.alloc(0));
  const len = data.length;
  const extra = len < 126 ? 0 : len < 65536 ? 2 : 8;
  const hdr = Buffer.alloc(2 + extra + (mask ? 4 : 0));
  hdr[0] = 0x80 | opcode;
  hdr[1] = (mask ? 0x80 : 0) | (len < 126 ? len : len < 65536 ? 126 : 127);
  if (extra === 2) hdr.writeUInt16BE(len, 2);
  else if (extra === 8) hdr.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([hdr, data]);
  mask.copy(hdr, 2 + extra);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([hdr, body]);
}

// Incremental frame parser. Calls onFrame({fin, opcode, masked, payload}) or
// onError(code, reason). Shared with the tests' raw client.
export class FrameParser {
  constructor({ maxFrame = MAX_FRAME, requireMask = true, onFrame, onError }) {
    this.buf = Buffer.alloc(0); this.maxFrame = maxFrame; this.requireMask = requireMask;
    this.onFrame = onFrame; this.onError = onError; this.dead = false;
  }
  push(chunk) {
    if (this.dead) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, rsv = b[0] & 0x70, opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (rsv) return this.fail(1002, "reserved bits set");
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxFrame)) return this.fail(1009, "frame too large");
        len = Number(big); off = 10;
      }
      if (len > this.maxFrame) return this.fail(1009, "frame too large");
      if (this.requireMask && !masked) return this.fail(1002, "client frames must be masked");
      const maskOff = off; if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) {
        const m = b.subarray(maskOff, maskOff + 4), out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i & 3];
        payload = out;
      } else payload = Buffer.from(payload);
      this.buf = b.subarray(off + len);
      this.onFrame({ fin, opcode, masked, payload });
      if (this.dead) return;
    }
  }
  fail(code, reason) { this.dead = true; this.onError(code, reason); }
}

// One server-side connection. Events: 'message' (string), 'close' (code, reason).
export class WsConn extends EventEmitter {
  constructor(socket, { maxMessage = MAX_FRAME } = {}) {
    super();
    this.socket = socket; this.open = true; this.maxMessage = maxMessage;
    this.frag = null; this.fragLen = 0; this.lastSeen = Date.now(); this.closeSent = false;
    this.remote = socket.remoteAddress || "";
    this.parser = new FrameParser({
      maxFrame: maxMessage, requireMask: true,
      onFrame: (f) => this.onFrame(f),
      onError: (code, reason) => this.close(code, reason),
    });
    socket.setNoDelay?.(true);
    socket.on("data", (d) => { this.lastSeen = Date.now(); this.parser.push(d); });
    socket.on("error", () => this.destroy());
    socket.on("close", () => this.finish(1006, ""));
    // http.Server sockets are half-open capable: a peer FIN alone never closes them.
    socket.on("end", () => { socket.end(); this.finish(1006, ""); });
  }
  feed(buf) { this.parser.push(buf); }

  onFrame({ fin, opcode, payload }) {
    if (opcode >= 8) {
      if (!fin || payload.length > 125) return this.close(1002, "bad control frame");
      if (opcode === OP.PING) return this.raw(OP.PONG, payload);
      if (opcode === OP.PONG) return;
      if (opcode === OP.CLOSE) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        if (!this.closeSent) this.raw(OP.CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0));
        this.closeSent = true;
        this.socket.end();
        return this.finish(code, "");
      }
      return this.close(1002, "unknown opcode");
    }
    if (opcode === OP.BIN) return this.close(1003, "text frames only");
    if (opcode === OP.TEXT) {
      if (this.frag) return this.close(1002, "expected continuation");
      if (fin) return this.deliver(payload);
      this.frag = [payload]; this.fragLen = payload.length; return;
    }
    if (opcode === OP.CONT) {
      if (!this.frag) return this.close(1002, "unexpected continuation");
      this.fragLen += payload.length;
      if (this.fragLen > this.maxMessage) return this.close(1009, "message too large");
      this.frag.push(payload);
      if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this.deliver(all); }
      return;
    }
    this.close(1002, "unknown opcode");
  }

  deliver(buf) {
    let s;
    try { s = utf8.decode(buf); } catch { return this.close(1007, "invalid utf-8"); }
    this.emit("message", s);
  }

  raw(opcode, payload) {
    if (!this.socket.writable) return;
    this.socket.write(frame(opcode, payload));
  }
  send(text) { if (this.open && !this.closeSent) this.raw(OP.TEXT, text); }
  ping() { if (this.open && !this.closeSent) this.raw(OP.PING, Buffer.alloc(0)); }

  close(code = 1000, reason = "") {
    if (!this.open) return;
    if (!this.closeSent) {
      const r = Buffer.from(String(reason).slice(0, 100), "utf8");
      const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
      this.raw(OP.CLOSE, p);
      this.closeSent = true;
    }
    this.parser.dead = true;
    // Give the peer a moment to answer, then drop the socket.
    const t = setTimeout(() => this.destroy(), 1000); t.unref?.();
    this.socket.end();
    this.finish(code, reason);
  }
  destroy() { this.socket.destroy(); this.finish(1006, ""); }
  finish(code, reason) {
    if (!this.open) return;
    this.open = false;
    this.emit("close", code, reason);
  }
}

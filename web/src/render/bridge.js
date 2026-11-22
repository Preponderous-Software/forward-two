// The page side of engine/bridge.cpp: copies typed arrays into the module's
// heap and calls the f2_* exports. One scratch allocation grows as needed.
export class Bridge {
  constructor(mod) {
    this.mod = mod;
    this.ptr = 0;
    this.cap = 0;
    this.textPtr = 0;
  }

  scratch(bytes) {
    if (bytes > this.cap) {
      if (this.ptr) this.mod._free(this.ptr);
      this.cap = Math.max(bytes, this.cap * 2, 1 << 16);
      this.ptr = this.mod._malloc(this.cap);
    }
    return this.ptr;
  }

  // Copy several arrays into one block; returns their pointers (0 for null).
  pack(arrays) {
    let total = 0;
    const offs = arrays.map((a) => { const o = total; if (a) total += (a.byteLength + 7) & ~7; return a ? o : -1; });
    const base = this.scratch(total || 8);
    const u8 = new Uint8Array(this.mod.HEAPF32.buffer);
    arrays.forEach((a, i) => { if (a) u8.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), base + offs[i]); });
    return offs.map((o) => (o < 0 ? 0 : base + o));
  }

  terrain(world) {
    const [h, c] = this.pack([world.heights, world.colors]);
    this.mod._f2_set_terrain(h, c, world.n, world.n, world.cell, 0, 0, 0);
  }

  texture(rgba, w, h, flags) {
    const [p] = this.pack([rgba]);
    return this.mod._f2_texture_create(p, w, h, flags);
  }

  updateTexture(slot, rgba) {
    const [p] = this.pack([rgba]);
    this.mod._f2_texture_update(slot, p);
  }

  // mesh: {positions, normals?, colors?, uvs?, indices, color?, flags?, texture?}
  mesh(m) {
    const pos = m.positions instanceof Float32Array ? m.positions : Float32Array.from(m.positions);
    const nrm = m.normals ? (m.normals instanceof Float32Array ? m.normals : Float32Array.from(m.normals)) : null;
    const col = m.colors ? (m.colors instanceof Float32Array ? m.colors : Float32Array.from(m.colors)) : null;
    const uv = m.uvs ? (m.uvs instanceof Float32Array ? m.uvs : Float32Array.from(m.uvs)) : null;
    const idx = m.indices instanceof Uint32Array ? m.indices : Uint32Array.from(m.indices);
    if (idx.length === 0) return -1;
    const [p, n, c, u, i] = this.pack([pos, nrm, col, uv, idx]);
    const k = m.color || [1, 1, 1, 1];
    return this.mod._f2_mesh_add(p, n, c, u, i, pos.length / 3, idx.length, k[0], k[1], k[2], k[3] ?? 1,
      m.flags || 0, m.texture ?? -1);
  }

  removeMesh(slot) { this.mod._f2_mesh_remove(slot); }

  transform(slot, m16) {
    const [p] = this.pack([m16]);
    this.mod._f2_mesh_transform(slot, p);
  }

  visible(slot, v) { this.mod._f2_mesh_visible(slot, v ? 1 : 0); }

  rows(fn, arr, stride) {
    const n = Math.floor(arr.length / stride);
    const [p] = this.pack([arr.length ? arr : new Float32Array(stride)]);
    this.mod[fn](p, n);
  }

  labels(rows, text) {
    const [p] = this.pack([rows.length ? rows : new Float32Array(8)]);
    if (this.textPtr) this.mod._free(this.textPtr);
    this.textPtr = this.mod.stringToNewUTF8(text);
    this.mod._f2_labels(p, Math.floor(rows.length / 8), this.textPtr);
  }

  levels(l10) {
    const [p] = this.pack([l10]);
    this.mod._f2_levels(p);
  }
}

// Mesh flags from strata.h.
export const MESH_UNLIT = 0x1, MESH_TRANSLUCENT = 0x2;
export const TEX_MIPMAPS = 0x1;
export const PRIM = { CUBE: 0, CAPSULE: 1, CYLINDER: 2, SPHERE: 3 };
export const POINT_SOFT = 1;

// A growable float row buffer for per-frame batches.
export class Rows {
  constructor(stride, cap = 256) { this.stride = stride; this.buf = new Float32Array(stride * cap); this.n = 0; }
  clear() { this.n = 0; }
  push(...v) {
    if ((this.n + 1) * this.stride > this.buf.length) {
      const b = new Float32Array(this.buf.length * 2); b.set(this.buf); this.buf = b;
    }
    this.buf.set(v, this.n * this.stride); this.n++;
  }
  view() { return this.buf.subarray(0, this.n * this.stride); }
}

# Forest memory and instancing (design note)

Lane: robustness and performance, 2026-11-24. (The wasm was rebuilt later in the lane; see the update at the end.)

## Where the memory goes today

`render/meshes.js` `forestMeshes()` bakes every tree into 16 chunk meshes in
world space: about 83 vertices a tree (a trunk frustum plus two canopy
frustums, flat shaded so no vertex is shared), each vertex carrying position,
normal and RGB colour (12 + 12 + 12 bytes) plus a uv pair (8 bytes) that is
always (0, 0), and about 1.45 indices a vertex (4 bytes each). Measured with
seed 1:

| world | density | trees | vertices | vertex + index data | without the uvs |
|---|---|---|---|---|---|
| small (phones) | 0.3 | 27,316 | 2.28 M | 108 MB | 91 MB |
| small, lowest detail | 0.18 | 16,447 | 1.37 M | 65 MB | 55 MB |
| full | 1.0 | 91,340 | 7.62 M | 362 MB | 304 MB |

That data exists more than once:

1. In the JS heap while it is built (now in the world worker, so it is
   handed over without a copy and dropped after upload).
2. In the **wasm heap**: `engine/bridge.cpp` keeps a `std::vector` copy of
   every mesh (`MeshSlot`) so it can re-upload after a lost WebGL context.
   That copy lives for the whole session, so the wasm memory grows past the
   table's figure. That is the likeliest phone crash: iOS Safari is known to
   refuse to grow wasm memory far beyond a few hundred MB.
3. On the **GPU**, in Strata's vertex and index buffers (the same size again).

So the full world costs roughly 0.7 GB (wasm plus GPU), and the small world
about 0.2 GB.

## What the bridge and Strata can do today

- `web/src/render/bridge.js` / `engine/bridge.cpp`: `f2_mesh_add` copies one
  mesh. `f2_mesh_transform` sets **one** model matrix per mesh slot. There is
  no way to draw one mesh N times.
- Strata 0.10.0 (`strata.h`, ABI 1.18; main is at 1.19 and ships in 0.11.0): `strata_add_textured_mesh` plus
  `strata_set_mesh_transform` (one matrix per mesh), at most 256 meshes
  (`STRATA_MAX_MESHES`). The only instanced path is `strata_submit_primitives`:
  per-frame `StrataRenderItem`s for four built-in shapes (cube, capsule,
  cylinder, sphere), scaled and translated but **not rotated**, and opaque.
  The bridge already exposes it as the `_f2_items` rows (`PRIM` in
  bridge.js).

So bridge.js does **not** support a shared mesh with per-instance matrices,
and adding it in bridge.cpp alone would not save memory: each instance would
still be its own Strata mesh (and the 256-mesh cap rules that out anyway).
No `web/src/render/forest.js` prototype was written for that reason.

## Done now (no engine change)

- The forest is untextured and its uvs are all zero, so the worker (and
  game.js's fallback) passes `uvs: null`; Strata treats NULL as (0, 0). That
  saves 8 bytes a vertex in the wasm copy and on the GPU: 17 MB on the small
  world and 58 MB on the full world (about 16%). Rendering is unchanged.
- The lowest detail tier already thins the small world to 0.18 density
  (65 MB, or 55 MB without uvs).

## Proposed: real instancing (needs a Strata ABI bump)

**Strata (new ABI 1.20, targeting Strata 0.12.0; 0.11.0 stays as prepped):**

```c
/* One mesh drawn `count` times. models: count column-major 4x4 matrices;
   tints: NULL or count linear RGB triples that multiply the vertex colours. */
STRATA_API StrataStatus strata_add_instanced_mesh(StrataEngine* engine, const StrataTexturedMesh* mesh,
                                                  const float* models, const float* tints, int32_t count,
                                                  uint32_t* out_id);
STRATA_API StrataStatus strata_set_mesh_instances(StrataEngine* engine, uint32_t id, const float* models,
                                                  const float* tints, int32_t count);
```

WebGL 2 has `drawElementsInstanced` and `vertexAttribDivisor`, so this is
a per-instance attribute buffer plus one draw call. Shadow passes draw the
same way. Frustum culling would run per instance batch (one batch per map
chunk keeps that cheap).

**bridge.cpp:** `f2_instanced_add(mesh..., const float* models, const float* tints, int count)`
and `f2_instances_set(slot, models, tints, count)`, keeping the CPU copy
for context restore as today, but now kilobytes, not hundreds of MB.

**bridge.js:** `instanced(mesh, models, tints)` returning a slot, and
`setInstances(slot, models, tints)`.

**New `web/src/render/forest.js`:** about six tree templates (conifer and
broadleaf, by two sizes and one random yaw baked as a matrix per tree),
built once, at about 100 vertices each. Per tree it stores a model matrix
(translation, yaw, scale) and a shade tint. `forestMeshes()` keeps its
placement loop and returns templates plus per-template instance lists
instead of baked chunks; `game.js` uploads them with `bridge.instanced`.

**Estimated memory** (instance data at 64 + 12 bytes a tree, templates about
40 KB):

| world | today | without uvs (done) | instanced |
|---|---|---|---|
| small | 108 MB (×2: wasm + GPU) | 91 MB (×2) | about 2.1 MB (×2) |
| full | 362 MB (×2) | 304 MB (×2) | about 6.9 MB (×2) |

That is about a 98% cut, and start-up gets faster too: the placement loop
stays, but no 7.6 M-vertex bake and no 300 MB upload.

**Files that change:** Strata (`include/strata/strata.h`, its renderer and
the web kit), `tools/build-engine.sh` (pin the new Strata and its SHA),
`engine/bridge.cpp` (two exports), `web/src/render/bridge.js` (two methods),
new `web/src/render/forest.js`, `web/src/render/meshes.js`
(`forestMeshes` returns templates and instances; owned by the visuals lane),
`web/src/game/game.js` (the upload line), `web/src/world/worker.js`
(transfers the instance arrays), plus a rebuilt `web/engine/forward-two.wasm`.

## A stopgap that needs no engine change (visuals lane's call)

Draw only nearby trees, as instanced primitives through the existing `_f2_items`
rows: trunk = cylinder, canopy = sphere or capsule (no cones, no rotation).
At 250 m around the camera that is about 4,000 trees, or 12,000 items ×
40 bytes = 0.5 MB a frame, with no forest meshes at all. The cost is the look
(rounded canopies instead of the low-poly cones) and no far forest, so it is a
fallback for the lowest tier, not a replacement.

## Update (wave 2b): the wasm-heap copy is gone

`engine/bridge.cpp` no longer keeps its copy of the forest (`f2_mesh_drop_copy`,
`f2_mesh_missing`, `f2_mesh_refill`; `Bridge.mesh(m, rebuild)` and
`Bridge.restore()` in bridge.js). After a lost context the game rebuilds the
forest in the world worker. Measured on the small world: the wasm heap went from
175.9 MB to 84.8 MB. The full world should save about 300 MB. Today's table
then reads "×1 (GPU only)" rather than "×2" for the forest, before any
instancing. Details in notes.md.

// Builds a world's grids off the main thread and hands them back
// (transferred). With `forest` in the request it also builds the forest
// meshes here, the slowest part of start-up, so the page stays responsive
// while the engine downloads. A failure is posted back as {error}, so the
// page can build on the main thread instead.
import { buildSkeleton, buildGrids } from "./terrain.js";
import { forestMeshes } from "../render/meshes.js";

self.onmessage = (e) => {
  try {
    const { seed, preset, forest } = e.data;
    const skel = buildSkeleton(seed, preset);
    const grids = buildGrids(skel, (f, label) => self.postMessage({ progress: f, label }));
    const transfer = Object.values(grids).map((a) => a.buffer);
    let trees = null;
    if (forest && forest.density > 0) {
      self.postMessage({ progress: 1, label: "Growing the forests" });
      try {
        const t0 = performance.now();
        trees = { ...forestMeshes({ ...skel, ...grids }, forest.density, forest.chunks || 4), density: forest.density, ms: performance.now() - t0 };
        // The forest is untextured and its uvs are all zero: drop them (8 bytes a vertex in the wasm heap and on the GPU).
        for (const m of trees.meshes) { m.uvs = null; for (const k of ["positions", "normals", "colors", "indices"]) if (m[k]) transfer.push(m[k].buffer); }
      } catch (_) { trees = null; /* the page builds the forest itself */ }
    }
    self.postMessage({ grids, forest: trees }, transfer);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};

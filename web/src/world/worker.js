// Builds a world's grids off the main thread and hands them back (transferred).
import { buildSkeleton, buildGrids } from "./terrain.js";

self.onmessage = (e) => {
  const { seed, preset } = e.data;
  const skel = buildSkeleton(seed, preset);
  const grids = buildGrids(skel, (f, label) => self.postMessage({ progress: f, label }));
  self.postMessage({ grids }, Object.values(grids).map((a) => a.buffer));
};

// Audio: the scheduling maths and the guide manifest (no browser needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clipDelay, nextBeat, pickVariant, ambienceTargets, validateManifest, CLIP_LEAD, Audio } from "../web/src/audio/audio.js";

const GUIDE = fileURLToPath(new URL("../web/audio/guide/", import.meta.url));

test("a call clip starts CLIP_LEAD before its beat, never in the past", () => {
  assert.equal(CLIP_LEAD, 0.35);
  assert.ok(Math.abs(clipDelay(1.6) - 1.25) < 1e-9);
  assert.equal(clipDelay(0.2), 0);
  assert.equal(clipDelay(-1), 0);
  assert.ok(Math.abs(clipDelay(1.0, 0.5) - 0.5) < 1e-9);
});

test("next beat lands on the caller's grid", () => {
  const interval = 60 / 92;
  assert.equal(nextBeat(10, interval, 9), 10);
  assert.equal(nextBeat(10, interval, 10), 10);
  const nb = nextBeat(10, interval, 10.1);
  assert.ok(Math.abs(nb - (10 + interval)) < 1e-9);
  const k = (nextBeat(10, interval, 15) - 10) / interval;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-9 && nextBeat(10, interval, 15) >= 15);
  assert.equal(nextBeat(10, 0, 12), 12);
});

test("variants: always a valid index; big water skips the plain clip", () => {
  for (let i = 0; i < 100; i++) {
    const r = i / 100;
    for (const cls of [0, 2, 3, 5]) {
      const v = pickVariant(3, cls, r);
      assert.ok(v >= 0 && v < 3);
      if (cls >= 3) assert.ok(v >= 1);
    }
    assert.equal(pickVariant(1, 5, r), 0);
  }
});

test("ambience follows the water", () => {
  const o = {};
  ambienceTargets(0.5, 1, 20, false, o);
  const calm = { ...o };
  ambienceTargets(4, 4, 20, false, o);
  assert.ok(o.river > calm.river && o.riverHz > calm.riverHz && o.roar > 0 && calm.roar === 0);
  ambienceTargets(0.15, 0, 20, true, o);
  assert.ok(o.lap > 0 && o.river === 0);
  ambienceTargets(1, 1, 300, false, o);
  assert.ok(o.wind > 0);
  assert.equal(ambienceTargets(1, 1, 300, false, o), o); // writes in place
});

test("the guide manifest is well formed, complete and small", () => {
  const m = JSON.parse(readFileSync(GUIDE + "index.json", "utf8"));
  assert.deepEqual(validateManifest(m), []);
  for (const id of ["forward", "back", "left", "right"]) {
    assert.ok(m.clips[id].length >= 3, `${id} has variants`);
    for (const e of m.clips[id]) assert.ok(Math.abs(e.stress - CLIP_LEAD) < 0.2, `${e.file} stress near the lead`);
  }
  for (const id of ["enter", "clean", "swim", "back_in", "falls", "camp", "night"]) assert.ok(m.clips[id]?.length, id);
  let total = 0;
  for (const list of Object.values(m.clips)) for (const e of list) {
    assert.ok(existsSync(GUIDE + e.file), `${e.file} exists`);
    const size = statSync(GUIDE + e.file).size;
    assert.ok(size > 0 && size < 60 * 1024, `${e.file} is ${size} bytes`);
    total += size;
  }
  assert.ok(total < 600 * 1024, `total ${total} bytes`);
  assert.ok(existsSync(GUIDE + "LICENSE.md"));
});

test("validateManifest catches bad shapes", () => {
  assert.ok(validateManifest(null).length);
  assert.ok(validateManifest({ clips: { a: [] } }).length);
  assert.ok(validateManifest({ clips: { a: [{ file: "../x.ogg" }] } }).length);
});

test("with no AudioContext every method is a silent no-op", () => {
  const a = new Audio({ boat: { current: null, y: 0 }, caller: {}, time: 0 });
  a.unlock(); a.tick(0.016); a.stroke("forward"); a.judgment("perfect"); a.call("left", 1);
  a.rapid({ name: "X", cls: 3 }); a.flip(); a.splash(1); a.bark("camp");
  a.setMuted(true); assert.equal(a.muted, true); a.setMuted(false); assert.equal(a.muted, false);
});

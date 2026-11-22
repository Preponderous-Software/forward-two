// Value noise and its fractal sums. Deterministic for a seed.
import { hash2 } from "./rng.js";

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function value2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = fade(xf), v = fade(yf);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v; // 0..1
}

// Fractal sum, roughly -1..1.
export function fbm(x, y, seed, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += (value2(x * f, y * f, seed + o * 1013) * 2 - 1) * amp;
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}

// Ridged sum, 0..1, sharp crests.
export function ridged(x, y, seed, octaves = 5) {
  let sum = 0, amp = 0.5, f = 1, prev = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(value2(x * f, y * f, seed + 77 + o * 31) * 2 - 1);
    n *= n;
    sum += n * amp * prev; norm += amp;
    prev = n; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

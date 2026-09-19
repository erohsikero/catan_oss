/**
 * Deterministic value noise.
 *
 * Every texture in the game is painted at runtime rather than shipped as an
 * image, so the noise has to be seedable (a tile must look the same on every
 * client) and cheap enough to run a few million samples at load time.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export interface FbmOptions {
  octaves?: number;
  frequency?: number;
  lacunarity?: number;
  gain?: number;
  seed?: number;
}

/** Fractal noise: layered octaves, normalised to [0, 1]. */
export function fbm(x: number, y: number, opts: FbmOptions = {}): number {
  const { octaves = 4, frequency = 1, lacunarity = 2, gain = 0.5, seed = 0 } = opts;
  let amplitude = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x * freq, y * freq, seed + i * 101);
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise, for rock strata and mountain faces. */
export function ridged(x: number, y: number, opts: FbmOptions = {}): number {
  const n = fbm(x, y, opts);
  return 1 - Math.abs(n * 2 - 1);
}

/**
 * Worley (cellular) noise, returning distance to the nearest feature point.
 * Used for clay cracks, pebbles and the cropped look of grazed pasture.
 */
export function worley(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 7919);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best);
}

/** Seeded PRNG for scattering props; mirrors the engine's mulberry32. */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

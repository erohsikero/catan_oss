/**
 * Small seeded PRNG (mulberry32).
 *
 * The server owns every roll and shuffle, but keeping them seeded and
 * serialisable means a game can be replayed from its seed and action log,
 * which makes desyncs and bot behaviour reproducible in tests.
 */
export interface RngState {
  seed: number;
}

export function makeRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Advances the state and returns a float in [0, 1). */
export function next(rng: RngState): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(rng: RngState, n: number): number {
  return Math.floor(next(rng) * n);
}

/** A single six-sided die. */
export function rollDie(rng: RngState): number {
  return 1 + nextInt(rng, 6);
}

/** Fisher-Yates, in place. */
export function shuffle<T>(rng: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

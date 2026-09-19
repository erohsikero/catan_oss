/**
 * Deterministic value noise.
 *
 * Every texture in the game is painted at runtime rather than shipped as an
 * image, so the noise has to be seedable (a tile must look the same on every
 * client) and cheap enough to run a few million samples at load time.
 */
/** Smoothstep-interpolated value noise in [0, 1). */
export declare function valueNoise(x: number, y: number, seed: number): number;
export interface FbmOptions {
    octaves?: number;
    frequency?: number;
    lacunarity?: number;
    gain?: number;
    seed?: number;
}
/** Fractal noise: layered octaves, normalised to [0, 1]. */
export declare function fbm(x: number, y: number, opts?: FbmOptions): number;
/** Ridged noise, for rock strata and mountain faces. */
export declare function ridged(x: number, y: number, opts?: FbmOptions): number;
/**
 * Worley (cellular) noise, returning distance to the nearest feature point.
 * Used for clay cracks, pebbles and the cropped look of grazed pasture.
 */
export declare function worley(x: number, y: number, seed: number): number;
/** Seeded PRNG for scattering props; mirrors the engine's mulberry32. */
export declare function makeRandom(seed: number): () => number;
//# sourceMappingURL=noise.d.ts.map
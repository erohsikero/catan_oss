import {
  DIRS,
  edgeEndpoints,
  edgeIdOf,
  hexDistanceFromOrigin,
  hexEdges,
  hexId,
  hexNeighbor,
  hexSpiral,
  hexVertices,
  type EdgeId,
  type Hex,
  type HexId,
  type VertexId,
} from './hex.js';
import { nextInt, shuffle, type RngState } from './rng.js';
import type { Board, Harbor, Resource, Terrain, Tile } from './types.js';

export const BOARD_RADIUS = 2;

/** Terrain mix of the standard 19-tile island. */
const TERRAIN_COUNTS: ReadonlyArray<readonly [Terrain, number]> = [
  ['fields', 4],
  ['forest', 4],
  ['pasture', 4],
  ['hills', 3],
  ['mountains', 3],
  ['desert', 1],
];

/** The 18 number tokens, in the order they are dealt around the spiral. */
const NUMBER_TOKENS: readonly number[] = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

/** Dots printed under each number: how many of the 36 dice combinations hit it. */
export function pipsFor(n: number | null): number {
  if (n === null) return 0;
  return 6 - Math.abs(7 - n);
}

/** Harbour types in clockwise order from the north-west coast. */
const HARBOR_SEQUENCE: ReadonlyArray<Resource | null> = [
  null,
  'wool',
  null,
  'ore',
  'grain',
  null,
  'brick',
  'lumber',
  null,
];

/**
 * Which coastal edges carry a harbour, as indices into the clockwise coastal
 * walk. The gaps run 3,3,4 three times over, which is the standard spacing:
 * far enough apart that no two harbours ever share a corner.
 */
const HARBOR_EDGE_INDICES: readonly number[] = [0, 3, 6, 10, 13, 16, 20, 23, 26];

/** One ring of hexes at exactly `radius`, walked clockwise from the north. */
export function hexRing(radius: number): Hex[] {
  if (radius === 0) return [{ q: 0, r: 0 }];
  // Start at the northern corner (radius steps along NW) and walk the ring.
  const out: Hex[] = [];
  let h: Hex = { q: 0, r: -radius };
  // Walking clockwise from the north corner means stepping E first.
  const walkOrder = [0, 1, 2, 3, 4, 5];
  for (const d of walkOrder) {
    for (let i = 0; i < radius; i++) {
      out.push(h);
      h = hexNeighbor(h, d);
    }
  }
  return out;
}

/** All board hexes ordered outside-in, which is how number tokens are dealt. */
export function spiralOrder(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let r = radius; r >= 0; r--) out.push(...hexRing(r));
  return out;
}

/**
 * The coastal edges of the island, walked clockwise.
 *
 * For a convex hexagonal board every outer tile's water-facing directions form
 * one contiguous cyclic run, so rotating each tile's outward directions to
 * begin just after its last inland neighbour stitches the runs into a single
 * unbroken loop around the coast.
 */
export function coastalEdges(radius: number): Array<{ hex: Hex; dir: number; edge: EdgeId }> {
  const out: Array<{ hex: Hex; dir: number; edge: EdgeId }> = [];
  for (const hex of hexRing(radius)) {
    const outward: number[] = [];
    for (let d = 0; d < 6; d++) {
      if (hexDistanceFromOrigin(hexNeighbor(hex, d)) > radius) outward.push(d);
    }
    const start = outward.find((d) => !outward.includes((d + 5) % 6));
    if (start === undefined) throw new Error(`tile ${hexId(hex)} is entirely surrounded by water`);
    const ordered: number[] = [];
    for (let i = 0; i < 6 && ordered.length < outward.length; i++) {
      const d = (start + i) % 6;
      if (outward.includes(d)) ordered.push(d);
    }
    for (const dir of ordered) out.push({ hex, dir, edge: edgeIdOf(hex, dir) });
  }
  return out;
}

export interface BoardOptions {
  /**
   * `classic` reproduces the fixed beginner island; `random` shuffles terrain
   * and deals the tokens around the spiral; `balanced` additionally rejects
   * layouts that place two red numbers (6 or 8) side by side.
   */
  layout?: 'classic' | 'random' | 'balanced';
  /** Shuffle which harbour sits where. */
  shuffleHarbors?: boolean;
  radius?: number;
}

/**
 * The fixed beginner island, listed in the same outside-in spiral order that
 * `spiralOrder` walks: the twelve coastal tiles, then the six inner tiles, then
 * the desert in the centre.
 */
const CLASSIC_TERRAIN: readonly Terrain[] = [
  // outer ring, clockwise from the north corner
  'mountains', 'pasture', 'forest', 'fields', 'hills', 'pasture',
  'hills', 'fields', 'forest', 'mountains', 'forest', 'fields',
  // inner ring, clockwise from the north
  'pasture', 'hills', 'fields', 'forest', 'mountains', 'pasture',
  // centre
  'desert',
];

function buildTiles(terrains: readonly Terrain[], order: readonly Hex[]): Tile[] {
  const tiles: Tile[] = [];
  let tokenIdx = 0;
  for (let i = 0; i < order.length; i++) {
    const hex = order[i];
    const terrain = terrains[i];
    const number = terrain === 'desert' ? null : NUMBER_TOKENS[tokenIdx++];
    tiles.push({
      id: hexId(hex),
      q: hex.q,
      r: hex.r,
      terrain,
      number,
      pips: pipsFor(number),
    });
  }
  return tiles;
}

/** True when any two tiles rolling 6 or 8 are neighbours. */
function hasAdjacentRedNumbers(tiles: readonly Tile[]): boolean {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  for (const t of tiles) {
    if (t.number !== 6 && t.number !== 8) continue;
    for (const d of DIRS) {
      const n = byId.get(hexId({ q: t.q + d.q, r: t.r + d.r }));
      if (n && (n.number === 6 || n.number === 8)) return true;
    }
  }
  return false;
}

function terrainPool(): Terrain[] {
  const pool: Terrain[] = [];
  for (const [terrain, count] of TERRAIN_COUNTS) {
    for (let i = 0; i < count; i++) pool.push(terrain);
  }
  return pool;
}

export function generateBoard(rng: RngState, opts: BoardOptions = {}): Board {
  const radius = opts.radius ?? BOARD_RADIUS;
  const layout = opts.layout ?? 'balanced';
  const order = spiralOrder(radius);

  let tiles: Tile[];
  if (layout === 'classic') {
    tiles = buildTiles(CLASSIC_TERRAIN, order);
  } else {
    const maxAttempts = layout === 'balanced' ? 200 : 1;
    let attempt = 0;
    do {
      tiles = buildTiles(shuffle(rng, terrainPool()), order);
      attempt++;
    } while (layout === 'balanced' && attempt < maxAttempts && hasAdjacentRedNumbers(tiles));
  }

  // --- harbours -----------------------------------------------------------
  const coast = coastalEdges(radius);
  const types = opts.shuffleHarbors ? shuffle(rng, [...HARBOR_SEQUENCE]) : [...HARBOR_SEQUENCE];
  // A random rotation keeps the classic spacing while varying which stretch of
  // coast each harbour lands on.
  const rotation = opts.shuffleHarbors ? nextInt(rng, coast.length) : 0;
  const harbors: Harbor[] = HARBOR_EDGE_INDICES.map((idx, i) => {
    const slot = coast[(idx + rotation) % coast.length];
    const resource = types[i];
    return {
      edge: slot.edge,
      hex: hexId(slot.hex),
      dir: slot.dir,
      resource,
      ratio: resource === null ? 3 : 2,
      vertices: edgeEndpoints(slot.edge),
    };
  });

  // --- derived topology ---------------------------------------------------
  const tileById: Record<HexId, Tile> = {};
  for (const t of tiles) tileById[t.id] = t;

  const vertexSet = new Set<VertexId>();
  const edgeSet = new Set<EdgeId>();
  const vertexHexMap: Record<VertexId, HexId[]> = {};
  const hexesByNumber: Record<number, HexId[]> = {};

  for (const t of tiles) {
    const hex: Hex = { q: t.q, r: t.r };
    for (const v of hexVertices(hex)) {
      vertexSet.add(v);
      (vertexHexMap[v] ??= []).push(t.id);
    }
    for (const e of hexEdges(hex)) edgeSet.add(e);
    if (t.number !== null) (hexesByNumber[t.number] ??= []).push(t.id);
  }

  return {
    tiles,
    tileById,
    vertices: [...vertexSet].sort(),
    edges: [...edgeSet].sort(),
    harbors,
    vertexHexes: vertexHexMap,
    hexesByNumber,
    radius,
  };
}

/** The desert tile, where the robber starts. */
export function desertHex(board: Board): HexId {
  const desert = board.tiles.find((t) => t.terrain === 'desert');
  return desert ? desert.id : board.tiles[0].id;
}

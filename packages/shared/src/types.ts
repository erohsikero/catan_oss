import type { EdgeId, HexId, VertexId } from './hex.js';

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];

/** Terrain types. `desert` produces nothing; `sea` is the surrounding water. */
export const TERRAINS = [
  'hills', // brick
  'forest', // lumber
  'pasture', // wool
  'fields', // grain
  'mountains', // ore
  'desert',
  'sea',
] as const;
export type Terrain = (typeof TERRAINS)[number];

export const TERRAIN_YIELD: Readonly<Record<Terrain, Resource | null>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
  sea: null,
};

export type ResourceBag = Record<Resource, number>;

export function emptyBag(): ResourceBag {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

export function bagTotal(bag: Partial<ResourceBag>): number {
  let n = 0;
  for (const r of RESOURCES) n += bag[r] ?? 0;
  return n;
}

export function bagClone(bag: ResourceBag): ResourceBag {
  return { ...bag };
}

/** True when `bag` holds at least everything in `cost`. */
export function bagCovers(bag: Partial<ResourceBag>, cost: Partial<ResourceBag>): boolean {
  for (const r of RESOURCES) {
    if ((cost[r] ?? 0) > (bag[r] ?? 0)) return false;
  }
  return true;
}

export function bagAdd(bag: ResourceBag, delta: Partial<ResourceBag>, sign = 1): void {
  for (const r of RESOURCES) bag[r] += (delta[r] ?? 0) * sign;
}

/** Flattens a bag into one entry per card, for random draws. */
export function bagToCards(bag: ResourceBag): Resource[] {
  const cards: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < bag[r]; i++) cards.push(r);
  return cards;
}

// ---------------------------------------------------------------------------

export const PLAYER_COLORS = ['red', 'blue', 'white', 'orange', 'green', 'brown'] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export type PlayerId = string;

export const DEV_CARDS = [
  'knight',
  'road_building',
  'year_of_plenty',
  'monopoly',
  'victory_point',
] as const;
export type DevCard = (typeof DEV_CARDS)[number];

export type DevCardCounts = Record<DevCard, number>;

export function emptyDevCounts(): DevCardCounts {
  return { knight: 0, road_building: 0, year_of_plenty: 0, monopoly: 0, victory_point: 0 };
}

export function devTotal(c: DevCardCounts): number {
  return DEV_CARDS.reduce((n, k) => n + c[k], 0);
}

// ---------------------------------------------------------------------------

/** 3:1 harbours have `resource: null`; 2:1 harbours name their resource. */
export interface Harbor {
  readonly edge: EdgeId;
  /** The land hex the harbour serves; used to orient the pier in 3D. */
  readonly hex: HexId;
  readonly dir: number;
  readonly resource: Resource | null;
  readonly ratio: 2 | 3;
  /** The two coastal corners where this harbour can be used. */
  readonly vertices: readonly VertexId[];
}

export interface Tile {
  readonly id: HexId;
  readonly q: number;
  readonly r: number;
  readonly terrain: Terrain;
  /** Dice number, or null for desert and sea. */
  readonly number: number | null;
  /** Pip count (dots under the number): how likely the roll is. */
  readonly pips: number;
}

export interface Board {
  readonly tiles: readonly Tile[];
  /** Land tiles only, indexed by hex id. */
  readonly tileById: Readonly<Record<HexId, Tile>>;
  readonly vertices: readonly VertexId[];
  readonly edges: readonly EdgeId[];
  readonly harbors: readonly Harbor[];
  /** vertex -> land hexes touching it */
  readonly vertexHexes: Readonly<Record<VertexId, readonly HexId[]>>;
  /** dice number -> land hexes carrying it */
  readonly hexesByNumber: Readonly<Record<number, readonly HexId[]>>;
  readonly radius: number;
}

export type BuildingKind = 'settlement' | 'city';

export interface Building {
  readonly vertex: VertexId;
  readonly owner: PlayerId;
  kind: BuildingKind;
}

export interface Road {
  readonly edge: EdgeId;
  readonly owner: PlayerId;
}

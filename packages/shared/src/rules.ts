import type { DevCard, PlayerColor, ResourceBag } from './types.js';

export const BUILD_COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  development_card: { wool: 1, grain: 1, ore: 1 },
} as const satisfies Record<string, Partial<ResourceBag>>;

export type Buildable = keyof typeof BUILD_COSTS;

/** Pieces each player starts with. */
export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 } as const;

export const VICTORY_POINTS_TO_WIN = 10;
export const HAND_LIMIT_BEFORE_DISCARD = 7;
export const KNIGHTS_FOR_LARGEST_ARMY = 3;
export const ROADS_FOR_LONGEST_ROAD = 5;
export const LONGEST_ROAD_VP = 2;
export const LARGEST_ARMY_VP = 2;

/** Composition of the 25-card development deck. */
export const DEV_DECK_COUNTS: Readonly<Record<DevCard, number>> = {
  knight: 14,
  victory_point: 5,
  road_building: 2,
  year_of_plenty: 2,
  monopoly: 2,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const DEFAULT_COLOR_ORDER: readonly PlayerColor[] = [
  'red',
  'blue',
  'white',
  'orange',
  'green',
  'brown',
];

/** Fallback bank trade rate with no harbour. */
export const DEFAULT_BANK_RATIO = 4;

/** How many of each resource the bank holds. Trades fail when the bank is dry. */
export const BANK_SUPPLY_PER_RESOURCE = 19;

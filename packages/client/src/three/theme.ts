import type { PlayerColor, Resource, Terrain } from '@hexhaven/shared';

/**
 * One palette for the whole game, so a player's colour is identical on their
 * pieces, their panel and their entry in the log.
 */
export const PLAYER_PALETTE: Record<PlayerColor, { base: string; dark: string; light: string; label: string }> = {
  red: { base: '#c3392f', dark: '#7d1f18', light: '#e8776c', label: 'Red' },
  blue: { base: '#2f6fb5', dark: '#1a3f6d', light: '#74a8e0', label: 'Blue' },
  white: { base: '#e6e2d6', dark: '#a39c8a', light: '#fbf9f2', label: 'White' },
  orange: { base: '#df8a2c', dark: '#96540f', light: '#f4b666', label: 'Orange' },
  green: { base: '#3f8f4f', dark: '#22582d', light: '#79c184', label: 'Green' },
  brown: { base: '#7a5230', dark: '#4a2f19', light: '#ab8158', label: 'Brown' },
};

/** Artwork for each resource lives in ui/Icons.tsx; this is the palette side. */
export const RESOURCE_META: Record<Resource, { label: string; color: string; terrain: Terrain }> = {
  brick: { label: 'Brick', color: '#b5623a', terrain: 'hills' },
  lumber: { label: 'Lumber', color: '#3c6b39', terrain: 'forest' },
  wool: { label: 'Wool', color: '#8fbc6a', terrain: 'pasture' },
  grain: { label: 'Grain', color: '#d8a435', terrain: 'fields' },
  ore: { label: 'Ore', color: '#6f7d88', terrain: 'mountains' },
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  hills: 'Hills',
  forest: 'Forest',
  pasture: 'Pasture',
  fields: 'Fields',
  mountains: 'Mountains',
  desert: 'Desert',
  sea: 'Sea',
};

/** Tint applied to the tile's terrain texture, to separate neighbouring tiles. */
export const TERRAIN_TINT: Record<Terrain, string> = {
  hills: '#ffffff',
  forest: '#ffffff',
  pasture: '#ffffff',
  fields: '#ffffff',
  mountains: '#ffffff',
  desert: '#ffffff',
  sea: '#2b6f93',
};

export const DEV_CARD_META = {
  knight: { label: 'Knight', blurb: 'Move the robber and steal a card. Three knights take Largest Army.' },
  road_building: { label: 'Road Building', blurb: 'Place two roads for free.' },
  year_of_plenty: { label: 'Year of Plenty', blurb: 'Take any two resources from the bank.' },
  monopoly: { label: 'Monopoly', blurb: 'Name a resource; every opponent hands you all of theirs.' },
  victory_point: { label: 'Victory Point', blurb: 'Worth one point. Kept hidden until you win.' },
} as const;

/** Board scale, shared by the geometry and the layout maths. */
export const HEX_SIZE = 1;
export const TILE_THICKNESS = 0.34;
/** Height of the tile surface that pieces stand on. */
export const SURFACE_Y = TILE_THICKNESS;

import type { PlayerColor, Resource, Terrain } from '@hexhaven/shared';
/**
 * One palette for the whole game, so a player's colour is identical on their
 * pieces, their panel and their entry in the log.
 */
export declare const PLAYER_PALETTE: Record<PlayerColor, {
    base: string;
    dark: string;
    light: string;
    label: string;
}>;
/** Artwork for each resource lives in ui/Icons.tsx; this is the palette side. */
export declare const RESOURCE_META: Record<Resource, {
    label: string;
    color: string;
    terrain: Terrain;
}>;
export declare const TERRAIN_LABEL: Record<Terrain, string>;
/** Tint applied to the tile's terrain texture, to separate neighbouring tiles. */
export declare const TERRAIN_TINT: Record<Terrain, string>;
export declare const DEV_CARD_META: {
    readonly knight: {
        readonly label: "Knight";
        readonly blurb: "Move the robber and steal a card. Three knights take Largest Army.";
    };
    readonly road_building: {
        readonly label: "Road Building";
        readonly blurb: "Place two roads for free.";
    };
    readonly year_of_plenty: {
        readonly label: "Year of Plenty";
        readonly blurb: "Take any two resources from the bank.";
    };
    readonly monopoly: {
        readonly label: "Monopoly";
        readonly blurb: "Name a resource; every opponent hands you all of theirs.";
    };
    readonly victory_point: {
        readonly label: "Victory Point";
        readonly blurb: "Worth one point. Kept hidden until you win.";
    };
};
/** Board scale, shared by the geometry and the layout maths. */
export declare const HEX_SIZE = 1;
export declare const TILE_THICKNESS = 0.34;
/** Height of the tile surface that pieces stand on. */
export declare const SURFACE_Y = 0.34;
//# sourceMappingURL=theme.d.ts.map
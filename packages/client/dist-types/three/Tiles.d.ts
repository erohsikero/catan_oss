import { type Tile } from '@hexhaven/shared';
/**
 * The island's land tiles.
 *
 * Each tile gets its own material instance so it can carry a small random
 * rotation and tint of the shared terrain texture. Without that, nineteen
 * tiles cut from six textures read as obvious copies.
 */
export declare function Tiles({ tiles, onPick }: {
    tiles: readonly Tile[];
    onPick?: (hexId: string) => void;
}): import("react").JSX.Element;
//# sourceMappingURL=Tiles.d.ts.map
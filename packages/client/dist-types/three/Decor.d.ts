import { type Board, type Tile } from '@hexhaven/shared';
/**
 * Number tokens.
 *
 * Each sits proud of the tile as a carved disc, and the robber's tile is
 * dimmed so a blocked number is obvious without reading the board.
 */
export declare function NumberTokens({ tiles, robber }: {
    tiles: readonly Tile[];
    robber: string;
}): import("react").JSX.Element;
/**
 * Harbours: a pier reaching into the water with its rate on a board, angled
 * back towards the island so it is readable from the usual camera position.
 */
export declare function Harbors({ board }: {
    board: Board;
}): import("react").JSX.Element;
//# sourceMappingURL=Decor.d.ts.map
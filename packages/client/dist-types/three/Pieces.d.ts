import { type Building, type PlayerColor, type Road } from '@hexhaven/shared';
export declare function Buildings({ buildings, colorOf, }: {
    buildings: Record<string, Building>;
    colorOf: (playerId: string) => PlayerColor;
}): import("react").JSX.Element;
export declare function Roads({ roads, colorOf, }: {
    roads: Record<string, Road>;
    colorOf: (playerId: string) => PlayerColor;
}): import("react").JSX.Element;
/** The robber, drifting gently so the eye is drawn to the blocked tile. */
export declare function Robber({ hex }: {
    hex: string;
}): import("react").JSX.Element;
//# sourceMappingURL=Pieces.d.ts.map
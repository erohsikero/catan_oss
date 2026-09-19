import { type DevCard, type PlayerView, type Resource } from '@hexhaven/shared';
/** The player's own hand: one card per resource, plus playable development cards. */
export declare function Hand({ view, onPlayDev, canPlayDev, }: {
    view: PlayerView;
    onPlayDev: (card: DevCard) => void;
    canPlayDev: boolean;
}): import("react").JSX.Element | null;
export interface ActionBarProps {
    view: PlayerView;
    isMyTurn: boolean;
    mode: string | null;
    onRoll: () => void;
    onBuild: (what: 'road' | 'settlement' | 'city') => void;
    onBuyDev: () => void;
    onTrade: () => void;
    onEndTurn: () => void;
    onCancel: () => void;
}
/** Everything the player can do on their turn, with affordability shown. */
export declare function ActionBar({ view, isMyTurn, mode, onRoll, onBuild, onBuyDev, onTrade, onEndTurn, onCancel, }: ActionBarProps): import("react").JSX.Element | null;
export type { Resource };
//# sourceMappingURL=Dock.d.ts.map
import { type Action, type PlayerView, type Resource, type ResourceBag } from '@hexhaven/shared';
/** Forced discard after a seven: exactly half, rounded down. */
export declare function DiscardDialog({ view, owed, onSubmit }: {
    view: PlayerView;
    owed: number;
    onSubmit: (bag: Partial<ResourceBag>) => void;
}): import("react").JSX.Element;
/** Year of Plenty: take any two cards from the bank. */
export declare function YearOfPlentyDialog({ view, onSubmit, onCancel }: {
    view: PlayerView;
    onSubmit: (picks: Resource[]) => void;
    onCancel: () => void;
}): import("react").JSX.Element;
/** Monopoly: name a resource and collect every one in play. */
export declare function MonopolyDialog({ onSubmit, onCancel }: {
    onSubmit: (r: Resource) => void;
    onCancel: () => void;
}): import("react").JSX.Element;
/** Pick which neighbour to rob, when the robber's tile touches several. */
export declare function StealDialog({ view, candidates, onPick }: {
    view: PlayerView;
    candidates: string[];
    onPick: (id: string) => void;
}): import("react").JSX.Element;
/** Bank and harbour trades, plus offers to the other players. */
export declare function TradeDialog({ view, onAct, onClose, }: {
    view: PlayerView;
    onAct: (action: Action) => void;
    onClose: () => void;
}): import("react").JSX.Element;
/** Live trade offers: respond to others', and close out your own. */
export declare function TradeOffers({ view, playerId, onAct, }: {
    view: PlayerView;
    playerId: string;
    onAct: (action: Action) => void;
}): import("react").JSX.Element | null;
/** Final scoreboard, with hidden victory-point cards revealed. */
export declare function VictoryDialog({ view, onLeave }: {
    view: PlayerView;
    onLeave: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=Dialogs.d.ts.map
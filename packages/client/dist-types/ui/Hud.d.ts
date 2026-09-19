import type { PlayerView } from '@hexhaven/shared';
import type { ChatMessage } from '../net/useConnection.js';
/** Opponent summary cards: points, hand size, army and awards at a glance. */
export declare function PlayerPanels({ view, playerId, }: {
    view: PlayerView;
    playerId: string | null;
}): import("react").JSX.Element;
export declare function Dice({ dice }: {
    dice: [number, number] | null;
}): import("react").JSX.Element | null;
/** One line telling the player exactly what the game is waiting for. */
export declare function TurnBanner({ view, playerId }: {
    view: PlayerView;
    playerId: string | null;
}): import("react").JSX.Element;
/** Game log and table chat, sharing one scrolling panel. */
export declare function LogPanel({ view, chat, onSend, }: {
    view: PlayerView;
    chat: ChatMessage[];
    onSend: (text: string) => void;
}): import("react").JSX.Element;
//# sourceMappingURL=Hud.d.ts.map
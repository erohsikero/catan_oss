import type { Action, ClientMessage, GameSettings, PlayerView, RoomSummary } from '@hexhaven/shared';
export interface ChatMessage {
    from: string;
    name: string;
    text: string;
    at: number;
}
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface Connection {
    status: ConnectionStatus;
    playerId: string | null;
    name: string;
    rooms: RoomSummary[];
    roomId: string | null;
    view: PlayerView | null;
    settings: GameSettings | null;
    chat: ChatMessage[];
    error: string | null;
    send: (msg: ClientMessage) => void;
    act: (action: Action) => void;
    dismissError: () => void;
    setName: (name: string) => void;
}
/**
 * The single websocket to the game server.
 *
 * The server is authoritative, so this holds no game logic: it sends actions,
 * receives whole redacted views, and reconnects. The session token is kept in
 * local storage so a refresh or a dropped connection rejoins the same seat
 * rather than starting a new player.
 */
export declare function useConnection(): Connection;
//# sourceMappingURL=useConnection.d.ts.map
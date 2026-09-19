import type { Connection } from '../net/useConnection.js';
/** The front door: pick a name, then host a table or join one by code. */
export declare function Lobby({ conn }: {
    conn: Connection;
}): import("react").JSX.Element;
/** The waiting room: seats, colours, bots and the host's settings. */
export declare function RoomView({ conn }: {
    conn: Connection;
}): import("react").JSX.Element;
//# sourceMappingURL=Lobby.d.ts.map
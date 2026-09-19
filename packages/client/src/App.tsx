import { useConnection } from './net/useConnection.js';
import { Lobby, RoomView } from './ui/Lobby.js';
import { GameScreen } from './ui/GameScreen.js';

/**
 * Three screens, chosen by where the player is: the lobby, the waiting room,
 * and the game. The server's view drives the switch, so a reconnect lands the
 * player straight back wherever their seat is.
 */
export function App() {
  const conn = useConnection();
  const inGame = conn.roomId !== null && conn.view !== null && conn.view.phase !== 'lobby';

  return (
    <>
      {conn.roomId === null ? <Lobby conn={conn} /> : inGame ? <GameScreen conn={conn} /> : <RoomView conn={conn} />}

      {conn.error && (
        <div className="toast" role="alert">
          <span>{conn.error}</span>
          <button className="btn btn-sm btn-ghost" onClick={conn.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <ConnectionPill status={conn.status} />
    </>
  );
}

function ConnectionPill({ status }: { status: ReturnType<typeof useConnection>['status'] }) {
  if (status === 'open') return null;
  const label =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'reconnecting'
        ? 'Reconnecting… your seat is held'
        : 'Disconnected';
  return (
    <div className="connection-pill">
      <span className={`dot ${status === 'closed' ? 'bad' : 'warn'}`} />
      {label}
    </div>
  );
}

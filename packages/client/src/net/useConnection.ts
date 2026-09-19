import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Action,
  Board,
  ClientMessage,
  GameSettings,
  PlayerView,
  RoomSummary,
  ServerMessage,
} from '@hexhaven/shared';

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

const TOKEN_KEY = 'hexhaven.token';
const NAME_KEY = 'hexhaven.name';

/**
 * Where the game server lives.
 *
 * By default the client talks to whatever host served it, which is the case
 * when the Node server serves both. Setting `VITE_SERVER_URL` at build time
 * points a statically hosted client at a game server elsewhere — that is what
 * makes a Pages/Netlify deployment plus a separate server work.
 */
function socketUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) {
    const base = configured.replace(/\/$/, '');
    if (base.startsWith('ws://') || base.startsWith('wss://')) return `${base}/ws`;
    return `${base.replace(/^http/, 'ws')}/ws`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The single websocket to the game server.
 *
 * The server is authoritative, so this holds no game logic: it sends actions,
 * receives whole redacted views, and reconnects. The session token is kept in
 * local storage so a refresh or a dropped connection rejoins the same seat
 * rather than starting a new player.
 */
export function useConnection(): Connection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setNameState] = useState(storedName);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<ClientMessage[]>([]);
  const attemptsRef = useRef(0);
  // The server sends the board once per game and omits it from later
  // updates, so the last one received is kept here and spliced back in.
  const boardRef = useRef<Board | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    // Buffer anything sent while the socket is down; it flushes on reconnect.
    else queueRef.current.push(msg);
  }, []);

  const act = useCallback((action: Action) => send({ t: 'action', action }), [send]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting');
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
        boardRef.current = null;
        setStatus('open');
        let token: string | undefined;
        try {
          token = localStorage.getItem(TOKEN_KEY) ?? undefined;
        } catch {
          token = undefined;
        }
        socket.send(JSON.stringify({ t: 'hello', name: nameRef.current || 'Player', token }));
        for (const queued of queueRef.current.splice(0)) socket.send(JSON.stringify(queued));
      };

      socket.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.t) {
          case 'welcome':
            setPlayerId(msg.playerId);
            setNameState(msg.name);
            try {
              localStorage.setItem(TOKEN_KEY, msg.token);
              localStorage.setItem(NAME_KEY, msg.name);
            } catch {
              /* private browsing; the session simply will not survive a refresh */
            }
            break;
          case 'rooms':
            setRooms(msg.rooms);
            break;
          case 'joined':
            setRoomId(msg.roomId);
            setSettings(msg.settings);
            setChat([]);
            break;
          case 'left':
            setRoomId(null);
            setView(null);
            setSettings(null);
            break;
          case 'state': {
            if (msg.view.board) boardRef.current = msg.view.board;
            const board = msg.view.board ?? boardRef.current;
            if (board) {
              setView({ ...msg.view, board } as PlayerView);
            } else {
              // Nothing to draw without a board. Ordered delivery means this
              // should not happen, but asking for a full state is cheap and
              // beats leaving the player staring at a blank screen.
              socket.send(JSON.stringify({ t: 'resync' }));
            }
            setSettings(msg.settings);
            break;
          }
          case 'chat':
            setChat((prev) => [...prev.slice(-80), msg]);
            break;
          case 'error':
            setError(msg.message);
            break;
          case 'pong':
            break;
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (disposed) return;
        setStatus('reconnecting');
        // Back off, but keep trying: a dropped player has two minutes of grace.
        const delay = Math.min(8000, 400 * 2 ** attemptsRef.current);
        attemptsRef.current += 1;
        retryTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      // `disposed` is scoped to this effect run, so React's StrictMode
      // double-mount cannot latch it and disable reconnects for the session.
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, []);

  // A heartbeat keeps intermediaries from culling an idle game.
  useEffect(() => {
    const timer = window.setInterval(() => send({ t: 'ping' }), 25_000);
    return () => window.clearInterval(timer);
  }, [send]);

  const setName = useCallback(
    (next: string) => {
      const trimmed = next.slice(0, 24);
      setNameState(trimmed);
      try {
        localStorage.setItem(NAME_KEY, trimmed);
      } catch {
        /* ignore */
      }
      send({ t: 'hello', name: trimmed || 'Player', token: localStorage.getItem(TOKEN_KEY) ?? undefined });
    },
    [send],
  );

  return {
    status,
    playerId,
    name,
    rooms,
    roomId,
    view,
    settings,
    chat,
    error,
    send,
    act,
    dismissError: () => setError(null),
    setName,
  };
}

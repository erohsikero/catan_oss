import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  RuleError,
  type ClientMessage,
  type PlayerId,
  type ServerMessage,
} from '@hexhaven/shared';
import { Room, RECONNECT_GRACE_MS, type Member } from './room.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIR = process.env.CLIENT_DIR ?? path.resolve(here, '../../client/dist');

// ---------------------------------------------------------------------------
// Session and room registries
// ---------------------------------------------------------------------------

interface Session {
  playerId: PlayerId;
  token: string;
  name: string;
  socket: WebSocket | null;
  roomId: string | null;
  /** Set when the socket drops; the seat is released when it fires. */
  graceTimer: NodeJS.Timeout | null;
}

const sessionsByToken = new Map<string, Session>();
const rooms = new Map<string, Room>();

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/** Four-letter room codes are easy to read out loud. */
function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return newId('room');
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function publicRooms(): ServerMessage {
  return {
    t: 'rooms',
    rooms: [...rooms.values()]
      .filter((r) => r.state.phase === 'lobby')
      .sort((a, b) => b.state.createdAt - a.state.createdAt)
      .slice(0, 50)
      .map((r) => r.summary()),
  };
}

function broadcastRoomList(): void {
  const msg = publicRooms();
  for (const session of sessionsByToken.values()) {
    if (session.socket && session.roomId === null) send(session.socket, msg);
  }
}

function disposeRoomIfAbandoned(room: Room): void {
  if (!room.isEmptyOfHumans) return;
  room.dispose();
  rooms.delete(room.id);
  broadcastRoomList();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, sessions: sessionsByToken.size, uptime: process.uptime() });
});

app.use(
  express.static(CLIENT_DIR, {
    // Hashed asset filenames can be cached hard; index.html must not be.
    // Vite emits `name-HASH.ext` with a base64url hash, not hex.
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

// Single-page app: anything that is not a file falls through to the client.
app.get(/^(?!\/(healthz|ws)).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'), (err) => {
    if (err) res.status(404).type('text/plain').send('Client build not found. Run: npm run build');
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------

function memberFor(session: Session): Member {
  return {
    playerId: session.playerId,
    name: session.name,
    online: true,
    send: (msg) => {
      if (session.socket) send(session.socket, msg);
    },
  };
}

function leaveCurrentRoom(session: Session, permanent: boolean): void {
  if (!session.roomId) return;
  const room = rooms.get(session.roomId);
  session.roomId = null;
  if (!room) return;
  room.leave(session.playerId, permanent);
  if (room.playerCount === 0 || room.isEmptyOfHumans) disposeRoomIfAbandoned(room);
  broadcastRoomList();
}

wss.on('connection', (socket: WebSocket) => {
  let session: Session | null = null;
  let alive = true;
  socket.on('pong', () => (alive = true));

  const reply = (msg: ServerMessage) => send(socket, msg);
  const fail = (err: unknown) => {
    if (err instanceof RuleError) reply({ t: 'error', message: err.message, code: err.code });
    else {
      console.error('[ws] unexpected error', err);
      reply({ t: 'error', message: 'Something went wrong on the server.' });
    }
  };

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      reply({ t: 'error', message: 'Malformed message.' });
      return;
    }

    try {
      // `hello` establishes or resumes a session; everything else needs one.
      if (msg.t === 'hello') {
        const name = String(msg.name ?? '').slice(0, 24).trim() || 'Player';
        const existing = msg.token ? sessionsByToken.get(msg.token) : undefined;
        if (existing) {
          // Resume: adopt this socket and cancel the seat-release timer.
          if (existing.graceTimer) clearTimeout(existing.graceTimer);
          existing.graceTimer = null;
          existing.socket = socket;
          existing.name = name;
          session = existing;
        } else {
          session = {
            playerId: newId('p'),
            token: randomBytes(24).toString('hex'),
            name,
            socket,
            roomId: null,
            graceTimer: null,
          };
          sessionsByToken.set(session.token, session);
        }
        reply({ t: 'welcome', playerId: session.playerId, token: session.token, name: session.name });

        const room = session.roomId ? rooms.get(session.roomId) : undefined;
        if (room) {
          room.join(memberFor(session));
          reply({ t: 'joined', roomId: room.id, settings: room.settings });
        } else {
          session.roomId = null;
          reply(publicRooms());
        }
        return;
      }

      if (!session) {
        reply({ t: 'error', message: 'Send hello first.', code: 'no_session' });
        return;
      }
      const current = session;
      const room = current.roomId ? rooms.get(current.roomId) : undefined;

      switch (msg.t) {
        case 'ping':
          reply({ t: 'pong' });
          break;

        case 'list_rooms':
          reply(publicRooms());
          break;

        case 'create_room': {
          leaveCurrentRoom(current, true);
          const id = newRoomCode();
          const created = new Room(
            id,
            String(msg.name ?? '').slice(0, 40).trim() || `${current.name}'s table`,
            current.playerId,
            msg.settings ?? {},
            msg.password,
          );
          rooms.set(id, created);
          created.join(memberFor(current));
          current.roomId = id;
          reply({ t: 'joined', roomId: id, settings: created.settings });
          created.broadcast();
          broadcastRoomList();
          break;
        }

        case 'join_room': {
          const target = rooms.get(String(msg.roomId ?? '').toUpperCase());
          if (!target) throw new RuleError('no_room', 'No room with that code.');
          if (target.password && target.password !== msg.password) {
            throw new RuleError('bad_password', 'Wrong password.');
          }
          if (current.roomId && current.roomId !== target.id) leaveCurrentRoom(current, true);
          target.join(memberFor(current));
          current.roomId = target.id;
          reply({ t: 'joined', roomId: target.id, settings: target.settings });
          broadcastRoomList();
          break;
        }

        case 'leave_room':
          leaveCurrentRoom(current, true);
          reply({ t: 'left' });
          reply(publicRooms());
          break;

        case 'add_bot':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.addBot();
          broadcastRoomList();
          break;

        case 'remove_player':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.removePlayer(current.playerId, msg.playerId);
          broadcastRoomList();
          break;

        case 'set_color':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.setColor(current.playerId, msg.color);
          break;

        case 'set_settings':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.setSettings(current.playerId, msg.settings);
          break;

        case 'start_game':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.start(current.playerId);
          broadcastRoomList();
          break;

        case 'action':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.handleAction(current.playerId, msg.action);
          break;

        case 'chat':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.sendChat(current.playerId, String(msg.text ?? ''));
          break;

        case 'resync':
          if (!room) throw new RuleError('no_room', 'You are not in a room.');
          room.resync(current.playerId);
          break;

        default:
          reply({ t: 'error', message: 'Unknown message.' });
      }
    } catch (err) {
      fail(err);
    }
  });

  socket.on('close', () => {
    alive = false;
    if (!session) return;
    const closing = session;
    closing.socket = null;
    const room = closing.roomId ? rooms.get(closing.roomId) : undefined;
    if (room) {
      // Hold the seat: bots cover the player's turns until they return.
      room.leave(closing.playerId, false);
      broadcastRoomList();
    }
    // Release the session, and the seat with it, if they do not come back.
    closing.graceTimer = setTimeout(() => {
      sessionsByToken.delete(closing.token);
      const held = closing.roomId ? rooms.get(closing.roomId) : undefined;
      if (held) {
        held.leave(closing.playerId, true);
        disposeRoomIfAbandoned(held);
      }
      broadcastRoomList();
    }, RECONNECT_GRACE_MS);
  });

  // Drop sockets that stop answering, so seats are not held by dead clients.
  const heartbeat = setInterval(() => {
    if (!alive) {
      clearInterval(heartbeat);
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, 30_000);
  socket.on('close', () => clearInterval(heartbeat));
});

server.listen(PORT, () => {
  console.log(`Hexhaven server listening on http://localhost:${PORT}`);
  console.log(`  serving client from ${CLIENT_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    for (const room of rooms.values()) room.dispose();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

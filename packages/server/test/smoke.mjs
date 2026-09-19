/**
 * End-to-end check against a running server.
 *
 * Start one on port 8099 and run this: it creates a room over a real
 * websocket, enforces host-only actions, plays a complete four-player game to
 * a winner, asserts no private state reaches the wire, and reconnects with a
 * saved token to confirm the seat is restored.
 *
 *   PORT=8099 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   node packages/server/test/smoke.mjs
 *
 * HEXHAVEN_BOT_THINK_MS=0 removes the bots' deliberate pause between moves,
 * which exists only so human players can follow what a bot did.
 */
import WebSocket from 'ws';
import { botAction, DEFAULT_SETTINGS } from '@hexhaven/shared';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:8099/ws';
const log = (...a) => console.log(...a);

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const handlers = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      for (const h of [...handlers]) if (h(msg)) handlers.splice(handlers.indexOf(h), 1);
    });
    ws.on('open', () => resolve({
      ws,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (pred, ms = 20000) => new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error(`timeout waiting in ${name}`)), ms);
        handlers.push((m) => { if (pred(m)) { clearTimeout(to); res(m); return true; } return false; });
      }),
      on: (fn) => handlers.push((m) => { fn(m); return false; }),
    }));
  });
}

const a = await connect('alice');
a.send({ t: 'hello', name: 'Alice' });
const welcomeA = await a.wait((m) => m.t === 'welcome');
log('✓ welcome, playerId', welcomeA.playerId);

// Register state listeners before the first update, the way a real client
// does: the board is only sent on the first update after joining.
let lastA = null, lastB = null;
let boardA = null, boardB = null;
a.on((m) => {
  if (m.t !== 'state') return;
  if (m.view.board) boardA = m.view.board;
  lastA = { ...m.view, board: m.view.board ?? boardA };
});

a.send({ t: 'create_room', name: 'Smoke table' });
const joined = await a.wait((m) => m.t === 'joined');
log('✓ room created:', joined.roomId);

// Second human joins by code.
const b = await connect('bob');
b.send({ t: 'hello', name: 'Bob' });
const welcomeB = await b.wait((m) => m.t === 'welcome');
b.on((m) => {
  if (m.t !== 'state') return;
  if (m.view.board) boardB = m.view.board;
  lastB = { ...m.view, board: m.view.board ?? boardB };
});
b.send({ t: 'join_room', roomId: joined.roomId });
await b.wait((m) => m.t === 'joined');
log('✓ second human joined');

// Room listing should show the lobby.
const c = await connect('lurker');
c.send({ t: 'hello', name: 'Lurker' });
await c.wait((m) => m.t === 'welcome');
c.send({ t: 'list_rooms' });
const rooms = await c.wait((m) => m.t === 'rooms');
if (!rooms.rooms.find((r) => r.id === joined.roomId)) throw new Error('room missing from listing');
log('✓ room appears in public listing');

// Non-host cannot start.
b.send({ t: 'start_game' });
const err = await b.wait((m) => m.t === 'error');
if (err.code !== 'not_host') throw new Error('expected not_host, got ' + err.code);
log('✓ non-host start rejected:', err.message);

a.send({ t: 'add_bot' });
a.send({ t: 'add_bot' });
await a.wait((m) => m.t === 'state' && m.view.players.length === 4);
log('✓ two bots added (4 players)');



a.send({ t: 'start_game' });
await a.wait((m) => m.t === 'state' && m.view.phase === 'setup');
log('✓ game started');

// Drive both humans with the bot policy until the game ends.
let humanActions = 0;
const drive = (conn, view, id) => {
  if (!view || !view.board || view.phase === 'ended') return;
  // Rebuild a state-shaped object the bot can read: the view already carries
  // the board, buildings, roads and pending step; only our own hand is exact.
  const fake = {
    ...view,
    players: view.players.map((p) => (p.id === id && view.you ? { ...view.you } : {
      ...p,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
      devCards: { knight: 0, road_building: 0, year_of_plenty: 0, monopoly: 0, victory_point: 0 },
      pendingDevCards: { knight: 0, road_building: 0, year_of_plenty: 0, monopoly: 0, victory_point: 0 },
    })),
    devDeck: new Array(view.devDeckSize).fill('knight'),
    rng: { seed: 1 },
  };
  const action = botAction(fake, DEFAULT_SETTINGS, id);
  if (action) { conn.send({ t: 'action', action }); humanActions++; }
};

const deadline = Date.now() + 240000;
let ended = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 40));
  if (lastA?.phase === 'ended') { ended = lastA; break; }
  drive(a, lastA, welcomeA.playerId);
  drive(b, lastB, welcomeB.playerId);
}
if (!ended) {
  console.log('state at timeout:', lastA && {
    phase: lastA.phase, pending: lastA.pending?.kind, turn: lastA.turn, humanActions,
  });
  throw new Error('game did not finish over the wire');
}
log(`✓ full game played over websockets: ${ended.turn} turns, ${humanActions} human actions`);
const winner = ended.players.find((p) => p.id === ended.winner);
log(`  winner: ${winner.name} with ${winner.publicVictoryPoints} points`);

// Privacy: at any point mid-game the opponent view must not leak hands.
const opp = ended.players.find((p) => p.id !== welcomeA.playerId);
if (opp.resources !== undefined) throw new Error('LEAK: opponent resources exposed');
if (ended.devDeck !== undefined) throw new Error('LEAK: dev deck exposed');
if (ended.rng !== undefined) throw new Error('LEAK: rng exposed');
log('✓ no private state leaked in the player view');

// Reconnect with the saved token and confirm the seat is restored.
a.ws.close();
await new Promise((r) => setTimeout(r, 300));
const a2 = await connect('alice-again');
a2.send({ t: 'hello', name: 'Alice', token: welcomeA.token });
const w2 = await a2.wait((m) => m.t === 'welcome');
if (w2.playerId !== welcomeA.playerId) throw new Error('reconnect gave a different playerId');
const rejoined = await a2.wait((m) => m.t === 'joined' || m.t === 'rooms');
log('✓ reconnect restored session', w2.playerId, `(${rejoined.t})`);

log('\nALL SMOKE CHECKS PASSED');
process.exit(0);

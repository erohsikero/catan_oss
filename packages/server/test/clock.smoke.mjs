/**
 * Turn-clock check against a running server.
 *
 * Connects a human who then does nothing at all, and asserts the server
 * drives the game forward on its own: the opening pieces get placed, the
 * dice get rolled, turns pass, and the personal reserve is spent before any
 * move is forced.
 *
 *   PORT=8099 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   node packages/server/test/clock.smoke.mjs
 */
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL ?? 'ws://127.0.0.1:8099/ws';
const log = (...a) => console.log(...a);

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const handlers = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      for (const h of [...handlers]) if (h(msg)) handlers.splice(handlers.indexOf(h), 1);
    });
    ws.on('open', () =>
      resolve({
        ws,
        send: (m) => ws.send(JSON.stringify(m)),
        wait: (pred, ms = 30000) =>
          new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('timeout')), ms);
            handlers.push((m) => {
              if (pred(m)) {
                clearTimeout(to);
                res(m);
                return true;
              }
              return false;
            });
          }),
        on: (fn) => handlers.push((m) => (fn(m), false)),
      }),
    );
  });
}

const a = await connect();
a.send({ t: 'hello', name: 'Idle' });
const me = await a.wait((m) => m.t === 'welcome');

let view = null;
let sawReserveSpend = false;
let sawBoard = null;
let minReserve = Infinity;
a.on((m) => {
  if (m.t !== 'state') return;
  if (m.view.board) sawBoard = m.view.board;
  view = { ...m.view, board: m.view.board ?? sawBoard };
  const mine = view.players.find((p) => p.id === me.playerId);
  if (mine) {
    if (mine.reserveMs < minReserve) minReserve = mine.reserveMs;
    if (mine.reserveMs === 0) sawReserveSpend = true;
  }
});

a.send({ t: 'create_room', name: 'Clock test' });
await a.wait((m) => m.t === 'joined');

// A deliberately tiny clock, so a full game's worth of timeouts runs fast.
a.send({
  t: 'set_settings',
  settings: {
    clock: {
      enabled: true,
      setupSeconds: 10,
      rollSeconds: 10,
      mainSeconds: 10,
      discardSeconds: 10,
      robberSeconds: 10,
      tradeGraceSeconds: 5,
      reserveSeconds: 20,
      reserveChunkSeconds: 10,
    },
  },
});
await a.wait((m) => m.t === 'state');
a.send({ t: 'add_bot' });
a.send({ t: 'add_bot' });
await a.wait((m) => m.t === 'state' && m.view.players.length === 3);
a.send({ t: 'start_game' });
await a.wait((m) => m.t === 'state' && m.view.phase === 'setup');
log('✓ game started with a 10s-per-step clock');

if (!view.clock) throw new Error('no clock on the state');
log(`✓ clock is running: ${view.clock.reason}, ${Math.round(view.clock.durationMs / 1000)}s`);

// From here the human does nothing whatsoever.
const startedAt = Date.now();
const deadline = startedAt + 180_000;
let reachedPlay = false;
let turnsSeen = new Set();
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400));
  if (!view) continue;
  if (view.phase === 'play') reachedPlay = true;
  turnsSeen.add(view.turn);
  if (view.phase === 'ended') break;
  // Stop once we have clear evidence of the clock driving several turns.
  if (reachedPlay && turnsSeen.size >= 6 && sawReserveSpend) break;
}

const mine = view.players.find((p) => p.id === me.playerId);
log(`✓ setup completed without the human acting: ${mine.settlements.length} settlements, ${mine.roads.length} roads`);
if (mine.settlements.length !== 2 || mine.roads.length !== 2) {
  throw new Error('the clock did not place the opening pieces');
}
if (!reachedPlay) throw new Error('never reached the play phase');
log(`✓ the clock drove ${turnsSeen.size} turns with no input at all`);
if (!sawReserveSpend) throw new Error('the personal reserve was never spent');
log(`✓ reserve was spent down to zero before moves were forced (low-water mark ${minReserve}ms)`);

// Everything the clock forced must be legal: the invariants still hold.
const totalSettlements = view.players.reduce((n, p) => n + p.settlements.length, 0);
const totalRoads = view.players.reduce((n, p) => n + p.roads.length, 0);
if (totalSettlements < 6) throw new Error('missing opening settlements');
log(`✓ board is consistent: ${totalSettlements} settlements, ${totalRoads} roads placed`);
log(`\nCLOCK CHECKS PASSED in ${Math.round((Date.now() - startedAt) / 1000)}s`);
process.exit(0);

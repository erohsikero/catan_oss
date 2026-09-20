import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayer,
  applyAction,
  bagTotal,
  clockFor,
  createGame,
  DEFAULT_CLOCK,
  DEFAULT_SETTINGS,
  extendFromReserve,
  forcedAction,
  NO_CLOCK,
  playerById,
  startClock,
  startGame,
  waitingOn,
  type GameSettings,
  type GameState,
} from '../dist/index.js';

const T0 = 1_700_000_000_000;

function game(clock = DEFAULT_CLOCK, players = 3): { g: GameState; settings: GameSettings } {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, clock };
  const g = createGame('clk', 21, settings);
  for (let i = 0; i < players; i++) addPlayer(g, `p${i}`, `P${i}`);
  startGame(g);
  startClock(g, settings, T0);
  return { g, settings };
}

/** Walks setup to completion so tests can work in the main phase. */
function finishSetup(g: GameState, settings: GameSettings, now = T0): void {
  let guard = 0;
  while (g.phase === 'setup' && guard++ < 60) {
    const p = g.players[g.currentPlayer];
    const pending = g.pending;
    if (pending.kind !== 'setup') break;
    const action = forcedAction(g, p.id, (state, id) => {
      // Reuse the bot policy the server passes in.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return botPick(state, id);
    });
    assert.ok(action, 'setup needs a forced choice');
    applyAction(g, settings, p.id, action, now);
  }
}

// Imported lazily to keep the helper above readable.
import { botAction } from '../dist/index.js';
const botPick = (state: GameState, id: string) => botAction(state, DEFAULT_SETTINGS, id);

test('the clock starts on the opening placement and names who it waits for', () => {
  const { g } = game();
  assert.ok(g.clock, 'a clock should be running');
  assert.equal(g.clock!.reason, 'setup');
  assert.deepEqual(g.clock!.players, [g.players[g.currentPlayer].id]);
  assert.equal(g.clock!.deadline, T0 + DEFAULT_CLOCK.setupSeconds * 1000);
});

test('a disabled clock produces no deadlines at all', () => {
  const { g, settings } = game(NO_CLOCK);
  assert.equal(g.clock, null);
  finishSetup(g, settings);
  applyAction(g, settings, g.players[g.currentPlayer].id, { type: 'roll_dice' }, T0 + 1000);
  assert.equal(g.clock, null);
});

test('actions inside one step do not refill its budget', () => {
  const { g, settings } = game();
  finishSetup(g, settings);
  const me = g.players[g.currentPlayer];

  applyAction(g, settings, me.id, { type: 'roll_dice' }, T0);
  // A seven diverts into the robber steps; re-roll the scenario if so.
  if (g.pending.kind !== 'main') return;
  const first = g.clock!.deadline;
  assert.equal(g.clock!.reason, 'main');

  // Give them something to spend so the action is legal, then act later in
  // the same step: the deadline must not move.
  Object.assign(me.resources, { ore: 8 });
  applyAction(g, settings, me.id, { type: 'bank_trade', give: 'ore', want: 'grain' }, T0 + 30_000);
  assert.equal(g.clock!.deadline, first, 'the main phase is one budget, not one per action');
});

test('passing the turn starts a fresh budget for the next player', () => {
  const { g, settings } = game();
  finishSetup(g, settings);
  const me = g.players[g.currentPlayer];
  applyAction(g, settings, me.id, { type: 'roll_dice' }, T0);
  if (g.pending.kind !== 'main') return;

  applyAction(g, settings, me.id, { type: 'end_turn' }, T0 + 40_000);
  const next = g.players[g.currentPlayer];
  assert.notEqual(next.id, me.id);
  assert.equal(g.clock!.reason, 'roll');
  assert.deepEqual(g.clock!.players, [next.id]);
  assert.equal(g.clock!.deadline, T0 + 40_000 + DEFAULT_CLOCK.rollSeconds * 1000);
});

test('a completed trade buys the turn extra time', () => {
  const { g, settings } = game();
  finishSetup(g, settings);
  const me = g.players[g.currentPlayer];
  applyAction(g, settings, me.id, { type: 'roll_dice' }, T0);
  if (g.pending.kind !== 'main') return;
  const before = g.clock!.deadline;

  const partner = g.players.find((p) => p.id !== me.id)!;
  Object.assign(me.resources, { brick: 2 });
  Object.assign(partner.resources, { ore: 2 });
  // Production may already have paid these out, so compare the change.
  const myOre = me.resources.ore;
  const theirBrick = partner.resources.brick;
  applyAction(g, settings, me.id, { type: 'offer_trade', give: { brick: 1 }, want: { ore: 1 } }, T0 + 1000);
  const offer = g.trades[0];
  applyAction(g, settings, partner.id, { type: 'respond_trade', offerId: offer.id, accept: true }, T0 + 2000);
  applyAction(g, settings, me.id, { type: 'confirm_trade', offerId: offer.id, partner: partner.id }, T0 + 3000);

  assert.equal(
    g.clock!.deadline,
    before + DEFAULT_CLOCK.tradeGraceSeconds * 1000,
    'a trade should extend the current step',
  );
  assert.equal(me.resources.ore - myOre, 1, 'one ore should have changed hands');
  assert.equal(partner.resources.brick - theirBrick, 1, 'one brick should have gone the other way');
});

test('the reserve extends an expired step and is spent doing so', () => {
  const { g, settings } = game();
  const me = g.players[g.currentPlayer];
  const startingReserve = me.reserveMs;
  assert.equal(startingReserve, DEFAULT_CLOCK.reserveSeconds * 1000);
  const expired = g.clock!.deadline;

  const extended = extendFromReserve(g, settings, expired);
  assert.equal(extended, true);
  const chunk = DEFAULT_CLOCK.reserveChunkSeconds * 1000;
  assert.equal(me.reserveMs, startingReserve - chunk);
  assert.equal(g.clock!.deadline, expired + chunk);
});

test('an exhausted reserve stops extending', () => {
  const { g, settings } = game();
  const me = g.players[g.currentPlayer];
  me.reserveMs = 0;
  assert.equal(extendFromReserve(g, settings, g.clock!.deadline), false);
});

test('a forced move resolves the step and never spends resources speculatively', () => {
  const { g, settings } = game();
  finishSetup(g, settings);
  const me = g.players[g.currentPlayer];

  // Waiting to roll: the forced move is the roll itself.
  assert.deepEqual(forcedAction(g, me.id, botPick), { type: 'roll_dice' });
  applyAction(g, settings, me.id, { type: 'roll_dice' }, T0);
  if (g.pending.kind !== 'main') return;

  // Mid-turn with a full hand: the forced move ends the turn rather than
  // building something the player never asked for.
  Object.assign(me.resources, { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 });
  const held = bagTotal(me.resources);
  assert.deepEqual(forcedAction(g, me.id, botPick), { type: 'end_turn' });
  applyAction(g, settings, me.id, { type: 'end_turn' }, T0 + 1000);
  assert.equal(bagTotal(playerById(g, me.id)!.resources), held, 'nothing should have been spent');
});

test('a forced discard hands over exactly what is owed, largest stacks first', () => {
  const { g, settings } = game();
  finishSetup(g, settings);
  const me = g.players[g.currentPlayer];
  Object.assign(me.resources, { brick: 6, lumber: 3, wool: 1, grain: 0, ore: 0 });
  g.pending = { kind: 'discard', owed: { [me.id]: 5 } };

  const action = forcedAction(g, me.id, botPick);
  assert.ok(action && action.type === 'discard');
  const bag = (action as { type: 'discard'; resources: Record<string, number> }).resources;
  const total = Object.values(bag).reduce((n, v) => n + v, 0);
  assert.equal(total, 5, 'must discard exactly what is owed');
  assert.ok((bag.brick ?? 0) >= (bag.wool ?? 0), 'should take from the biggest stack first');

  // And it must be accepted by the engine.
  applyAction(g, settings, me.id, action, T0 + 1000);
  assert.equal(bagTotal(me.resources), 5);
});

test('a discard clock waits on every player who owes cards', () => {
  const { g, settings } = game(DEFAULT_CLOCK, 3);
  finishSetup(g, settings);
  const [a, b] = g.players;
  g.pending = { kind: 'discard', owed: { [a.id]: 2, [b.id]: 3 } };
  assert.deepEqual(waitingOn(g).sort(), [a.id, b.id].sort());
  const clock = clockFor(g, DEFAULT_CLOCK, T0);
  assert.equal(clock!.reason, 'discard');
  assert.deepEqual(clock!.players.sort(), [a.id, b.id].sort());
});

test('each step carries its own budget', () => {
  const { g } = game();
  const budgets: Array<[GameState['pending'], number]> = [
    [{ kind: 'roll' }, DEFAULT_CLOCK.rollSeconds],
    [{ kind: 'main' }, DEFAULT_CLOCK.mainSeconds],
    [{ kind: 'move_robber', reason: 'dice', resume: 'main' }, DEFAULT_CLOCK.robberSeconds],
  ];
  g.phase = 'play';
  for (const [pending, seconds] of budgets) {
    g.pending = pending;
    const clock = clockFor(g, DEFAULT_CLOCK, T0);
    assert.equal(clock!.durationMs, seconds * 1000, `${pending.kind} budget`);
  }
});

test('no clock runs once the game is over', () => {
  const { g } = game();
  g.phase = 'ended';
  g.pending = { kind: 'ended', winner: g.players[0].id };
  assert.equal(clockFor(g, DEFAULT_CLOCK, T0), null);
});

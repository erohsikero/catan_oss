import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayer,
  applyAction,
  bagTotal,
  BANK_SUPPLY_PER_RESOURCE,
  botAction,
  createGame,
  DEFAULT_SETTINGS,
  DEV_DECK_COUNTS,
  devTotal,
  PIECE_LIMITS,
  RESOURCES,
  RuleError,
  satisfiesDistanceRule,
  startGame,
  totalVictoryPoints,
  vertexNeighbors,
  type GameState,
} from '../dist/index.js';

/**
 * Invariants that must hold after every single action of every game.
 * These are what catch a rules bug that a scripted test would walk straight past.
 */
function checkInvariants(g: GameState, where: string): void {
  // Cards are conserved: nothing is created except by drawing from the bank.
  for (const r of RESOURCES) {
    const held = g.players.reduce((n, p) => n + p.resources[r], 0);
    assert.equal(g.bank[r] + held, BANK_SUPPLY_PER_RESOURCE, `${where}: ${r} supply drifted`);
    assert.ok(g.bank[r] >= 0, `${where}: bank went negative on ${r}`);
  }

  // The development deck is conserved too.
  const totalDev = Object.values(DEV_DECK_COUNTS).reduce((a, b) => a + b, 0);
  const inHands = g.players.reduce((n, p) => n + devTotal(p.devCards) + devTotal(p.pendingDevCards), 0);
  const played = g.players.reduce((n, p) => n + devTotal(p.playedDevCards), 0);
  assert.equal(g.devDeck.length + inHands + played, totalDev, `${where}: dev cards drifted`);

  for (const p of g.players) {
    for (const r of RESOURCES) assert.ok(p.resources[r] >= 0, `${where}: ${p.name} has negative ${r}`);

    // Pieces placed plus pieces in hand equals the starting supply. Upgrading
    // returns the settlement piece to stock, so the settlement total holds at
    // five however many cities are on the board.
    assert.equal(p.roads.length + p.piecesLeft.road, PIECE_LIMITS.road, `${where}: road count`);
    assert.equal(
      p.settlements.length + p.piecesLeft.settlement,
      PIECE_LIMITS.settlement,
      `${where}: settlement count`,
    );
    assert.equal(p.cities.length + p.piecesLeft.city, PIECE_LIMITS.city, `${where}: city count`);
    assert.ok(p.piecesLeft.road >= 0 && p.piecesLeft.settlement >= 0 && p.piecesLeft.city >= 0);

    // Every piece the player claims is on the board and owned by them.
    for (const e of p.roads) assert.equal(g.roads[e]?.owner, p.id, `${where}: stray road`);
    for (const v of p.settlements) {
      assert.equal(g.buildings[v]?.owner, p.id, `${where}: stray settlement`);
      assert.equal(g.buildings[v]?.kind, 'settlement');
    }
    for (const v of p.cities) {
      assert.equal(g.buildings[v]?.owner, p.id, `${where}: stray city`);
      assert.equal(g.buildings[v]?.kind, 'city');
    }
  }

  // No two buildings are ever adjacent.
  for (const v of Object.keys(g.buildings)) {
    for (const n of vertexNeighbors(v)) {
      assert.ok(!g.buildings[n], `${where}: buildings adjacent at ${v} and ${n}`);
    }
  }

  // The robber always stands on a land tile.
  assert.ok(g.board.tileById[g.robber], `${where}: robber is off the board`);

  // At most one player holds each award.
  assert.ok(g.players.filter((p) => p.hasLongestRoad).length <= 1, `${where}: two longest roads`);
  assert.ok(g.players.filter((p) => p.hasLargestArmy).length <= 1, `${where}: two largest armies`);
}

interface Outcome {
  winner: string;
  turns: number;
  points: number;
  actions: number;
}

function playOneGame(seed: number, playerCount: number): Outcome {
  const g = createGame(`sp-${seed}`, seed, DEFAULT_SETTINGS);
  for (let i = 0; i < playerCount; i++) addPlayer(g, `p${i}`, `Bot ${i}`, true);
  startGame(g);
  checkInvariants(g, `seed ${seed} start`);

  let actions = 0;
  const maxActions = 40000;

  while (g.phase !== 'ended' && actions < maxActions) {
    // Whoever the game is waiting on acts next: the current player normally,
    // but any player during a discard or when answering a trade.
    let acted = false;
    for (const p of g.players) {
      const action = botAction(g, DEFAULT_SETTINGS, p.id);
      if (!action) continue;
      try {
        applyAction(g, DEFAULT_SETTINGS, p.id, action);
      } catch (err) {
        if (err instanceof RuleError) {
          assert.fail(`seed ${seed}: bot produced an illegal action ${JSON.stringify(action)} -> ${err.code}: ${err.message}`);
        }
        throw err;
      }
      actions++;
      acted = true;
      checkInvariants(g, `seed ${seed} after ${action.type}`);
      break;
    }
    assert.ok(acted, `seed ${seed}: no player could act in phase ${g.phase}/${g.pending.kind} on turn ${g.turn}`);
  }

  assert.equal(g.phase, 'ended', `seed ${seed}: game did not finish within ${maxActions} actions`);
  const winner = g.players.find((p) => p.id === g.winner)!;
  assert.ok(totalVictoryPoints(winner) >= DEFAULT_SETTINGS.victoryPoints, `seed ${seed}: winner is short of points`);
  // Nobody else should have been left sitting on a winning score.
  for (const p of g.players) {
    if (p.id === winner.id) continue;
    assert.ok(
      totalVictoryPoints(p) < DEFAULT_SETTINGS.victoryPoints,
      `seed ${seed}: ${p.name} also had a winning score`,
    );
  }
  return { winner: winner.name, turns: g.turn, points: totalVictoryPoints(winner), actions };
}

test('bots play complete legal games', { timeout: 300000 }, () => {
  const outcomes: Outcome[] = [];
  for (let seed = 1; seed <= 24; seed++) {
    outcomes.push(playOneGame(seed, 2 + (seed % 3)));
  }
  const avgTurns = outcomes.reduce((n, o) => n + o.turns, 0) / outcomes.length;
  const avgActions = outcomes.reduce((n, o) => n + o.actions, 0) / outcomes.length;
  // A game that ends in a handful of turns means the engine is skipping work.
  assert.ok(avgTurns > 15, `games ended suspiciously fast (avg ${avgTurns.toFixed(1)} turns)`);
  console.log(
    `  ${outcomes.length} games: avg ${avgTurns.toFixed(1)} turns, ${avgActions.toFixed(0)} actions, ` +
      `longest ${Math.max(...outcomes.map((o) => o.turns))} turns`,
  );
});

test('the setup phase always leaves every player with two settlements and two roads', () => {
  for (let seed = 100; seed < 112; seed++) {
    const g = createGame(`s-${seed}`, seed, DEFAULT_SETTINGS);
    const count = 2 + (seed % 3);
    for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `Bot ${i}`, true);
    startGame(g);
    let guard = 0;
    while (g.phase === 'setup' && guard++ < 200) {
      const p = g.players[g.currentPlayer];
      const action = botAction(g, DEFAULT_SETTINGS, p.id);
      assert.ok(action, `seed ${seed}: bot stalled during setup`);
      applyAction(g, DEFAULT_SETTINGS, p.id, action);
    }
    assert.equal(g.phase, 'play');
    for (const p of g.players) {
      assert.equal(p.settlements.length, 2, `seed ${seed}: ${p.name} settlements`);
      assert.equal(p.roads.length, 2, `seed ${seed}: ${p.name} roads`);
      assert.ok(p.settlements.every((v) => !satisfiesDistanceRule(g, v)));
    }
    // Setup deals a full turn order and returns to the first player.
    assert.equal(g.currentPlayer, g.setupOrder[0]);
    assert.equal(g.pending.kind, 'roll');
  }
});

test('production never overdraws the bank', () => {
  // Drive a game to a state where the bank is nearly empty and confirm the
  // shortage rule fires rather than the bank going negative.
  const g = createGame('bank', 5, DEFAULT_SETTINGS);
  for (let i = 0; i < 3; i++) addPlayer(g, `p${i}`, `Bot ${i}`, true);
  startGame(g);
  let guard = 0;
  while (g.phase !== 'ended' && guard < 4000) {
    for (const p of g.players) {
      const action = botAction(g, DEFAULT_SETTINGS, p.id);
      if (!action) continue;
      applyAction(g, DEFAULT_SETTINGS, p.id, action);
      guard++;
      for (const r of RESOURCES) assert.ok(g.bank[r] >= 0, `bank went negative on ${r}`);
      break;
    }
  }
  assert.ok(bagTotal(g.bank) <= BANK_SUPPLY_PER_RESOURCE * RESOURCES.length);
});

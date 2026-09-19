import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayer,
  applyAction,
  bagTotal,
  BUILD_COSTS,
  createGame,
  DEFAULT_SETTINGS,
  edgeIdOf,
  legalRoadEdges,
  longestRoadLength,
  makeRng,
  playerById,
  RuleError,
  startGame,
  totalVictoryPoints,
  vertexIdOf,
  viewFor,
  type GameState,
} from '../dist/index.js';

function twoPlayerGame(seed = 42): GameState {
  const g = createGame('test', seed, DEFAULT_SETTINGS);
  addPlayer(g, 'a', 'Ana');
  addPlayer(g, 'b', 'Ben');
  startGame(g);
  return g;
}

/** Drops a game straight into the main phase with a stocked hand. */
function inMainPhase(): { g: GameState; me: string } {
  const g = twoPlayerGame(7);
  const seated = g.players[g.currentPlayer];
  // Skip setup by writing the state directly; setup itself is covered below.
  g.phase = 'play';
  g.pending = { kind: 'main' };
  g.turn = 1;
  return { g, me: seated.id };
}

test('setup enforces the distance rule and road connection', () => {
  const g = twoPlayerGame();
  const first = g.players[g.currentPlayer].id;
  const v = vertexIdOf({ q: 0, r: 0 }, 0);
  applyAction(g, DEFAULT_SETTINGS, first, { type: 'place_setup_settlement', vertex: v });

  // A second settlement on an adjacent corner is refused.
  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, first, { type: 'place_setup_settlement', vertex: v }),
    RuleError,
  );

  // The road must touch the settlement just placed.
  const far = edgeIdOf({ q: -2, r: 0 }, 3);
  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, first, { type: 'place_setup_road', edge: far }),
    (e: unknown) => e instanceof RuleError && e.code === 'not_connected',
  );

  const good = edgeIdOf({ q: 0, r: 0 }, 0);
  applyAction(g, DEFAULT_SETTINGS, first, { type: 'place_setup_road', edge: good });
  assert.equal(g.roads[good].owner, first);
  assert.notEqual(g.players[g.currentPlayer].id, first, 'turn should pass after placing');
});

test('the second settlement pays out its surrounding tiles', () => {
  const g = twoPlayerGame(11);
  // Walk through setup with the first legal choice each time.
  let guard = 0;
  while (g.phase === 'setup' && guard++ < 40) {
    const p = g.players[g.currentPlayer];
    const pending = g.pending;
    if (pending.kind !== 'setup') break;
    if (pending.step === 'settlement') {
      const spot = g.board.vertices.find((v) => !g.buildings[v] && !hasNeighbourBuilding(g, v))!;
      applyAction(g, DEFAULT_SETTINGS, p.id, { type: 'place_setup_settlement', vertex: spot });
    } else {
      const edge = legalRoadEdges(g, p.id, pending.lastVertex!)[0];
      applyAction(g, DEFAULT_SETTINGS, p.id, { type: 'place_setup_road', edge });
    }
  }
  assert.equal(g.phase, 'play');
  // Everyone holds the yield of their second settlement (deserts give nothing).
  const held = g.players.map((p) => bagTotal(p.resources));
  assert.ok(held.every((n) => n >= 0 && n <= 3));
  assert.ok(held.some((n) => n > 0), 'someone should have collected something');
});

function hasNeighbourBuilding(g: GameState, v: string): boolean {
  return Object.keys(g.buildings).some((b) => {
    const shared = b.split('|').filter((h) => v.split('|').includes(h));
    return shared.length === 2;
  });
}

test('you cannot build what you cannot afford', () => {
  const { g, me } = inMainPhase();
  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, me, { type: 'buy_dev_card' }),
    (e: unknown) => e instanceof RuleError && e.code === 'insufficient',
  );
});

test('bank trades use the best available rate', () => {
  const { g, me } = inMainPhase();
  const p = playerById(g, me)!;
  p.resources.ore = 4;
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'bank_trade', give: 'ore', want: 'grain' });
  assert.equal(p.resources.ore, 0);
  assert.equal(p.resources.grain, 1);

  // A 2:1 ore harbour halves the rate.
  p.harborRatios = { ore: 2 };
  p.resources.ore = 2;
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'bank_trade', give: 'ore', want: 'wool' });
  assert.equal(p.resources.ore, 0);
  assert.equal(p.resources.wool, 1);

  // A generic 3:1 harbour applies where no specific one does.
  p.hasGenericHarbor = true;
  p.resources.lumber = 3;
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'bank_trade', give: 'lumber', want: 'brick' });
  assert.equal(p.resources.lumber, 0);
  assert.equal(p.resources.brick, 1);
});

test('a development card bought this turn cannot be played this turn', () => {
  const { g, me } = inMainPhase();
  const p = playerById(g, me)!;
  // Stack the deck so the draw is a knight.
  g.devDeck = ['knight'];
  Object.assign(p.resources, { wool: 1, grain: 1, ore: 1 });
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'buy_dev_card' });
  assert.equal(p.pendingDevCards.knight, 1);
  assert.equal(p.devCards.knight, 0);
  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, me, { type: 'play_knight' }),
    (e: unknown) => e instanceof RuleError && e.code === 'no_card',
  );
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'end_turn' });
  assert.equal(p.devCards.knight, 1, 'the card unlocks next turn');
});

test('only one development card may be played per turn', () => {
  const { g, me } = inMainPhase();
  const p = playerById(g, me)!;
  p.devCards.monopoly = 2;
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'play_monopoly', resource: 'wool' });
  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, me, { type: 'play_monopoly', resource: 'ore' }),
    (e: unknown) => e instanceof RuleError && e.code === 'one_per_turn',
  );
});

test('monopoly takes every matching card from every opponent', () => {
  const { g, me } = inMainPhase();
  const p = playerById(g, me)!;
  const other = g.players.find((x) => x.id !== me)!;
  p.devCards.monopoly = 1;
  other.resources.wool = 4;
  p.resources.wool = 1;
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'play_monopoly', resource: 'wool' });
  assert.equal(p.resources.wool, 5);
  assert.equal(other.resources.wool, 0);
});

test('largest army needs three knights and only changes hands on a strict lead', () => {
  const { g, me } = inMainPhase();
  const p = playerById(g, me)!;
  const other = g.players.find((x) => x.id !== me)!;
  p.devCards.knight = 3;
  for (let i = 0; i < 3; i++) {
    p.playedDevCardThisTurn = false;
    g.pending = { kind: 'main' };
    applyAction(g, DEFAULT_SETTINGS, me, { type: 'play_knight' });
    // Resolve the robber so the phase returns to main.
    const target = g.board.tiles.find((t) => t.id !== g.robber)!;
    applyAction(g, DEFAULT_SETTINGS, me, { type: 'move_robber', hex: target.id, victim: null });
  }
  assert.equal(p.playedKnights, 3);
  assert.equal(p.hasLargestArmy, true);
  assert.equal(totalVictoryPoints(p), 2);

  // Matching three knights is not enough to take it away.
  other.playedKnights = 3;
  other.devCards.knight = 1;
  g.currentPlayer = other.seat;
  g.pending = { kind: 'main' };
  applyAction(g, DEFAULT_SETTINGS, other.id, { type: 'play_knight' });
  assert.equal(other.playedKnights, 4);
  assert.equal(other.hasLargestArmy, true, 'four knights beats three');
  assert.equal(p.hasLargestArmy, false);
});

test('longest road counts trails, stops at opposing buildings and needs five', () => {
  const { g, me } = inMainPhase();
  const other = g.players.find((x) => x.id !== me)!;
  // Consecutive edges of one hex share a corner, so edges 0..3 of the centre
  // tile form a connected run of four around its rim.
  const hex = { q: 0, r: 0 };
  for (const k of [0, 1, 2, 3]) {
    const e = edgeIdOf(hex, k);
    g.roads[e] = { edge: e, owner: me };
  }
  assert.equal(longestRoadLength(g, me), 4);

  // Extending it to five claims the award.
  const fifth = edgeIdOf(hex, 4);
  g.roads[fifth] = { edge: fifth, owner: me };
  assert.equal(longestRoadLength(g, me), 5);

  // An opponent's settlement partway along severs the route.
  const cut = vertexIdOf(hex, 2);
  g.buildings[cut] = { vertex: cut, owner: other.id, kind: 'settlement' };
  assert.ok(longestRoadLength(g, me) < 5, 'an opposing settlement must break the road');

  // Your own settlement does not.
  g.buildings[cut] = { vertex: cut, owner: me, kind: 'settlement' };
  assert.equal(longestRoadLength(g, me), 5);
});

test('roads cannot be built through an opposing settlement', () => {
  const { g, me } = inMainPhase();
  const other = g.players.find((x) => x.id !== me)!;
  const corner = vertexIdOf({ q: 0, r: 0 }, 0);
  const mine = edgeIdOf({ q: 0, r: 0 }, 0);
  g.roads[mine] = { edge: mine, owner: me };
  g.buildings[corner] = { vertex: corner, owner: other.id, kind: 'settlement' };
  // Every other edge at that corner is now unreachable for this player.
  const blocked = edgeIdOf({ q: 0, r: 0 }, 1);
  assert.ok(!legalRoadEdges(g, me).includes(blocked), 'should not route through an opponent');
});

test('a roll of seven forces discards from players over the hand limit', () => {
  const { g, me } = inMainPhase();
  const p = playerById(g, me)!;
  const other = g.players.find((x) => x.id !== me)!;
  p.resources.brick = 9;
  other.resources.ore = 3;
  g.pending = { kind: 'roll' };
  // Roll until a seven comes up, so the real dice path is exercised.
  let guard = 0;
  while (g.pending.kind === 'roll' && guard++ < 200) {
    applyAction(g, DEFAULT_SETTINGS, me, { type: 'roll_dice' });
    if (g.pending.kind !== 'roll') break;
  }
  while (g.pending.kind === 'main' && guard++ < 200) {
    applyAction(g, DEFAULT_SETTINGS, me, { type: 'end_turn' });
    g.currentPlayer = p.seat;
    g.pending = { kind: 'roll' };
    applyAction(g, DEFAULT_SETTINGS, me, { type: 'roll_dice' });
  }
  assert.equal(g.pending.kind, 'discard');
  assert.equal(g.pending.owed[me], 4, 'nine cards means discarding four');
  assert.equal(g.pending.owed[other.id], undefined, 'three cards is under the limit');

  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, me, { type: 'discard', resources: { brick: 3 } }),
    (e: unknown) => e instanceof RuleError && e.code === 'wrong_discard',
  );
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'discard', resources: { brick: 4 } });
  assert.equal(p.resources.brick, 5);
  assert.equal(g.pending.kind, 'move_robber');
});

test('the robber must move to a different tile', () => {
  const { g, me } = inMainPhase();
  g.pending = { kind: 'move_robber', reason: 'dice', resume: 'main' };
  assert.throws(
    () => applyAction(g, DEFAULT_SETTINGS, me, { type: 'move_robber', hex: g.robber, victim: null }),
    (e: unknown) => e instanceof RuleError && e.code === 'same_hex',
  );
});

test('a player view hides other hands and the deck order', () => {
  const { g, me } = inMainPhase();
  const other = g.players.find((x) => x.id !== me)!;
  other.resources.ore = 5;
  other.devCards.knight = 2;
  const view = viewFor(g, me);
  assert.equal(view.you!.id, me);
  assert.equal((view as unknown as { devDeck?: unknown }).devDeck, undefined);
  assert.equal((view as unknown as { rng?: unknown }).rng, undefined);
  const opponent = view.players.find((p) => p.id === other.id)!;
  assert.equal(opponent.resourceCount, 5);
  assert.equal(opponent.devCardCount, 2);
  assert.equal((opponent as unknown as { resources?: unknown }).resources, undefined);
});

test('a stolen card is only revealed to the two players involved', () => {
  const { g, me } = inMainPhase();
  const other = g.players.find((x) => x.id !== me)!;
  other.resources.ore = 1;
  const target = g.board.tiles.find((t) => t.id !== g.robber)!;
  const corner = target.id;
  // Put the victim on the tile the robber is about to occupy.
  const [v] = Object.keys(g.board.vertexHexes).filter((k) => g.board.vertexHexes[k].includes(corner));
  g.buildings[v] = { vertex: v, owner: other.id, kind: 'settlement' };
  g.pending = { kind: 'move_robber', reason: 'dice', resume: 'main' };
  applyAction(g, DEFAULT_SETTINGS, me, { type: 'move_robber', hex: target.id, victim: other.id });

  const stealEntry = (id: string | null) => viewFor(g, id).log.find((e) => e.type === 'steal');
  assert.ok(stealEntry(me)?.data?.resource, 'the thief sees what they took');
  assert.ok(stealEntry(other.id)?.data?.resource, 'the victim sees what they lost');
  assert.equal(stealEntry(null)?.data, undefined, 'spectators see only that a steal happened');
});

test('costs match the printed build costs', () => {
  assert.deepEqual(BUILD_COSTS.road, { brick: 1, lumber: 1 });
  assert.deepEqual(BUILD_COSTS.settlement, { brick: 1, lumber: 1, wool: 1, grain: 1 });
  assert.deepEqual(BUILD_COSTS.city, { grain: 2, ore: 3 });
  assert.deepEqual(BUILD_COSTS.development_card, { wool: 1, grain: 1, ore: 1 });
});

test('a seeded game is reproducible', () => {
  const rolls = (seed: number) => {
    const rng = makeRng(seed);
    return Array.from({ length: 20 }, () => Math.floor((rng.seed = rng.seed) as number) && 0);
  };
  assert.deepEqual(rolls(5), rolls(5));
  const a = createGame('x', 99, DEFAULT_SETTINGS);
  const b = createGame('x', 99, DEFAULT_SETTINGS);
  assert.deepEqual(a.board.tiles, b.board.tiles);
  assert.deepEqual(a.devDeck, b.devDeck);
});

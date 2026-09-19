import { desertHex, generateBoard } from './board.js';
import {
  edgeEndpoints,
  hexVertices,
  parseHexId,
  vertexEdges,
  vertexNeighbors,
  type EdgeId,
  type HexId,
  type VertexId,
} from './hex.js';
import { recomputeRoadLengths } from './longestRoad.js';
import type { Action } from './protocol.js';
import { makeRng, nextInt, rollDie, shuffle, type RngState } from './rng.js';
import {
  BANK_SUPPLY_PER_RESOURCE,
  BUILD_COSTS,
  DEFAULT_BANK_RATIO,
  DEFAULT_COLOR_ORDER,
  DEV_DECK_COUNTS,
  HAND_LIMIT_BEFORE_DISCARD,
  KNIGHTS_FOR_LARGEST_ARMY,
  LARGEST_ARMY_VP,
  LONGEST_ROAD_VP,
  PIECE_LIMITS,
  ROADS_FOR_LONGEST_ROAD,
  VICTORY_POINTS_TO_WIN,
} from './rules.js';
import type { GameSettings } from './protocol.js';
import { currentPlayer, playerById, type GameState, type PlayerState } from './state.js';
import {
  bagAdd,
  bagClone,
  bagCovers,
  bagTotal,
  bagToCards,
  devTotal,
  emptyBag,
  emptyDevCounts,
  RESOURCES,
  TERRAIN_YIELD,
  type DevCard,
  type PlayerColor,
  type PlayerId,
  type Resource,
  type ResourceBag,
} from './types.js';

export class RuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RuleError(code, message);
}

export const DEFAULT_SETTINGS: GameSettings = {
  victoryPoints: VICTORY_POINTS_TO_WIN,
  board: { layout: 'balanced', shuffleHarbors: true },
  turnSeconds: 0,
};

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function buildDevDeck(rng: RngState): DevCard[] {
  const deck: DevCard[] = [];
  for (const [card, count] of Object.entries(DEV_DECK_COUNTS) as Array<[DevCard, number]>) {
    for (let i = 0; i < count; i++) deck.push(card);
  }
  return shuffle(rng, deck);
}

export function createGame(id: string, seed: number, settings: GameSettings = DEFAULT_SETTINGS): GameState {
  const rng = makeRng(seed);
  const board = generateBoard(rng, settings.board);
  const bank = emptyBag();
  for (const r of RESOURCES) bank[r] = BANK_SUPPLY_PER_RESOURCE;
  return {
    id,
    board,
    players: [],
    currentPlayer: 0,
    turn: 0,
    phase: 'lobby',
    pending: { kind: 'lobby' },
    dice: null,
    robber: desertHex(board),
    buildings: {},
    roads: {},
    devDeck: buildDevDeck(rng),
    bank,
    trades: [],
    log: [],
    nextLogId: 1,
    largestArmyHolder: null,
    longestRoadHolder: null,
    setupOrder: [],
    setupIndex: 0,
    rng,
    seed,
    winner: null,
    createdAt: Date.now(),
    version: 0,
  };
}

export function createPlayer(id: PlayerId, name: string, seat: number, color: PlayerColor, isBot = false): PlayerState {
  return {
    id,
    name,
    color,
    isBot,
    connected: true,
    seat,
    resources: emptyBag(),
    devCards: emptyDevCounts(),
    pendingDevCards: emptyDevCounts(),
    playedDevCards: emptyDevCounts(),
    playedKnights: 0,
    playedDevCardThisTurn: false,
    roads: [],
    settlements: [],
    cities: [],
    piecesLeft: { ...PIECE_LIMITS },
    harborRatios: {},
    hasGenericHarbor: false,
    longestRoadLength: 0,
    hasLongestRoad: false,
    hasLargestArmy: false,
  };
}

export function nextFreeColor(state: GameState): PlayerColor {
  const taken = new Set(state.players.map((p) => p.color));
  return DEFAULT_COLOR_ORDER.find((c) => !taken.has(c)) ?? 'red';
}

export function addPlayer(state: GameState, id: PlayerId, name: string, isBot = false): PlayerState {
  if (state.phase !== 'lobby') fail('game_started', 'The game has already started.');
  const player = createPlayer(id, name, state.players.length, nextFreeColor(state), isBot);
  state.players.push(player);
  return player;
}

function log(state: GameState, type: string, text: string, player?: PlayerId, data?: Record<string, unknown>): void {
  state.log.push({ id: state.nextLogId++, turn: state.turn, type, player, text, data });
  // The log is a rolling window; older entries are not needed to replay state.
  if (state.log.length > 250) state.log.splice(0, state.log.length - 250);
}

export function startGame(state: GameState): void {
  if (state.phase !== 'lobby') fail('game_started', 'The game has already started.');
  if (state.players.length < 2) fail('not_enough_players', 'At least two players are needed.');

  shuffle(state.rng, state.players);
  state.players.forEach((p, i) => (p.seat = i));

  const n = state.players.length;
  const forward = state.players.map((_, i) => i);
  // Snake draft: seats 0..n-1 place their first settlement, then n-1..0 place
  // their second, so the last player to place first also places last.
  state.setupOrder = [...forward, ...forward.slice().reverse()];
  state.setupIndex = 0;
  state.currentPlayer = state.setupOrder[0];
  state.phase = 'setup';
  state.turn = 1;
  state.pending = { kind: 'setup', round: 1, step: 'settlement', lastVertex: null };
  log(state, 'game_started', 'The game begins.');
}

// ---------------------------------------------------------------------------
// Board queries — shared by validation, the UI's highlighting and the bots
// ---------------------------------------------------------------------------

/** Land hexes on the board that touch this corner. */
export function landHexesAt(state: GameState, vertex: VertexId): HexId[] {
  return [...(state.board.vertexHexes[vertex] ?? [])];
}

/** A corner is open when it is empty and no neighbouring corner is built on. */
export function satisfiesDistanceRule(state: GameState, vertex: VertexId): boolean {
  if (state.buildings[vertex]) return false;
  for (const n of vertexNeighbors(vertex)) {
    if (state.buildings[n]) return false;
  }
  return true;
}

function isBoardVertex(state: GameState, vertex: VertexId): boolean {
  return state.board.vertexHexes[vertex] !== undefined;
}

function isBoardEdge(state: GameState, edge: EdgeId): boolean {
  return state.board.edges.includes(edge);
}

/** Corners where `playerId` could legally place a settlement right now. */
export function legalSettlementVertices(state: GameState, playerId: PlayerId, setup: boolean): VertexId[] {
  const out: VertexId[] = [];
  for (const v of state.board.vertices) {
    if (!satisfiesDistanceRule(state, v)) continue;
    if (!setup && !touchesOwnRoad(state, playerId, v)) continue;
    out.push(v);
  }
  return out;
}

function touchesOwnRoad(state: GameState, playerId: PlayerId, vertex: VertexId): boolean {
  return vertexEdges(vertex).some((e) => state.roads[e]?.owner === playerId);
}

/**
 * Roads extend from your own network. A corner occupied by an opponent blocks
 * the connection, so you cannot build straight through their settlement.
 */
export function legalRoadEdges(state: GameState, playerId: PlayerId, fromVertex?: VertexId): EdgeId[] {
  const out: EdgeId[] = [];
  for (const e of state.board.edges) {
    if (state.roads[e]) continue;
    const [a, b] = edgeEndpoints(e);
    if (fromVertex) {
      if (a === fromVertex || b === fromVertex) out.push(e);
      continue;
    }
    for (const v of [a, b]) {
      const building = state.buildings[v];
      if (building && building.owner !== playerId) continue; // blocked corner
      const ownsBuilding = building?.owner === playerId;
      const ownsRoad = vertexEdges(v).some((other) => other !== e && state.roads[other]?.owner === playerId);
      if (ownsBuilding || ownsRoad) {
        out.push(e);
        break;
      }
    }
  }
  return out;
}

export function legalCityVertices(state: GameState, playerId: PlayerId): VertexId[] {
  const p = playerById(state, playerId);
  return p ? [...p.settlements] : [];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function publicVictoryPoints(p: PlayerState): number {
  return (
    p.settlements.length +
    p.cities.length * 2 +
    (p.hasLongestRoad ? LONGEST_ROAD_VP : 0) +
    (p.hasLargestArmy ? LARGEST_ARMY_VP : 0)
  );
}

export function totalVictoryPoints(p: PlayerState): number {
  return publicVictoryPoints(p) + p.devCards.victory_point + p.pendingDevCards.victory_point;
}

/**
 * Longest Road is claimed at five segments and only ever changes hands on a
 * strictly longer route, so a tie leaves the incumbent holding it. Losing the
 * length — usually because an opponent's new settlement cut the route — drops
 * the award, and it then goes to whoever is now uniquely longest.
 */
function updateLongestRoad(state: GameState): void {
  recomputeRoadLengths(state);
  const holder = state.longestRoadHolder ? playerById(state, state.longestRoadHolder) : undefined;
  const holderLength = holder && holder.longestRoadLength >= ROADS_FOR_LONGEST_ROAD ? holder.longestRoadLength : 0;

  let best = Math.max(holderLength, ROADS_FOR_LONGEST_ROAD - 1);
  let bestPlayers: PlayerState[] = [];
  for (const p of state.players) {
    if (p.longestRoadLength < ROADS_FOR_LONGEST_ROAD) continue;
    if (p.longestRoadLength > best) {
      best = p.longestRoadLength;
      bestPlayers = [p];
    } else if (p.longestRoadLength === best) {
      bestPlayers.push(p);
    }
  }

  if (holderLength > 0 && bestPlayers.every((p) => p.longestRoadLength <= holderLength)) {
    return; // incumbent keeps it; ties do not transfer
  }
  const winner = bestPlayers.length === 1 ? bestPlayers[0] : null;
  if (!winner) {
    if (holderLength === 0 && state.longestRoadHolder) {
      for (const p of state.players) p.hasLongestRoad = false;
      state.longestRoadHolder = null;
      log(state, 'longest_road_lost', 'Longest Road is no longer held.');
    }
    return;
  }
  if (state.longestRoadHolder === winner.id) return;
  for (const p of state.players) p.hasLongestRoad = false;
  winner.hasLongestRoad = true;
  state.longestRoadHolder = winner.id;
  log(state, 'longest_road', `${winner.name} takes Longest Road (${winner.longestRoadLength}).`, winner.id);
}

function updateLargestArmy(state: GameState): void {
  const holder = state.largestArmyHolder ? playerById(state, state.largestArmyHolder) : undefined;
  const threshold = Math.max(holder?.playedKnights ?? 0, KNIGHTS_FOR_LARGEST_ARMY - 1);
  let winner: PlayerState | null = null;
  for (const p of state.players) {
    if (p.playedKnights > threshold && (!winner || p.playedKnights > winner.playedKnights)) winner = p;
  }
  if (!winner || winner.id === state.largestArmyHolder) return;
  for (const p of state.players) p.hasLargestArmy = false;
  winner.hasLargestArmy = true;
  state.largestArmyHolder = winner.id;
  log(state, 'largest_army', `${winner.name} takes Largest Army (${winner.playedKnights} knights).`, winner.id);
}

/** A win is only declared on the winner's own turn, as the rules require. */
function checkVictory(state: GameState, settings: GameSettings, actor: PlayerState): void {
  if (state.phase === 'ended') return;
  if (actor.seat !== state.currentPlayer) return;
  if (totalVictoryPoints(actor) < settings.victoryPoints) return;
  state.phase = 'ended';
  state.winner = actor.id;
  state.pending = { kind: 'ended', winner: actor.id };
  log(state, 'victory', `${actor.name} wins with ${totalVictoryPoints(actor)} victory points.`, actor.id);
}

// ---------------------------------------------------------------------------
// Resource movement
// ---------------------------------------------------------------------------

function payToBank(state: GameState, p: PlayerState, cost: Partial<ResourceBag>): void {
  bagAdd(p.resources, cost, -1);
  bagAdd(state.bank, cost, +1);
}

function takeFromBank(state: GameState, p: PlayerState, gain: Partial<ResourceBag>): void {
  bagAdd(p.resources, gain, +1);
  bagAdd(state.bank, gain, -1);
}

/**
 * Pays out production for a dice roll.
 *
 * The bank can run dry. When it cannot cover everyone owed a given resource,
 * the rules say that nobody receives it — unless exactly one player is owed
 * any, in which case they take whatever is left.
 */
function distributeResources(state: GameState, roll: number): void {
  const owed = new Map<PlayerId, ResourceBag>();
  const demand = emptyBag();

  for (const hexIdStr of state.board.hexesByNumber[roll] ?? []) {
    if (hexIdStr === state.robber) continue;
    const tile = state.board.tileById[hexIdStr];
    const resource = TERRAIN_YIELD[tile.terrain];
    if (!resource) continue;
    for (const v of hexVertices(parseHexId(hexIdStr))) {
      const building = state.buildings[v];
      if (!building) continue;
      const amount = building.kind === 'city' ? 2 : 1;
      let bag = owed.get(building.owner);
      if (!bag) owed.set(building.owner, (bag = emptyBag()));
      bag[resource] += amount;
      demand[resource] += amount;
    }
  }
  if (owed.size === 0) {
    log(state, 'no_production', `No one produces on ${roll}.`);
    return;
  }

  for (const resource of RESOURCES) {
    if (demand[resource] <= state.bank[resource]) continue;
    const claimants = [...owed.values()].filter((bag) => bag[resource] > 0);
    if (claimants.length === 1) {
      claimants[0][resource] = state.bank[resource];
    } else {
      for (const bag of claimants) bag[resource] = 0;
      log(state, 'bank_empty', `The bank is out of ${resource}; no one collects it.`);
    }
  }

  for (const [playerId, bag] of owed) {
    const p = playerById(state, playerId);
    if (!p || bagTotal(bag) === 0) continue;
    takeFromBank(state, p, bag);
    const summary = RESOURCES.filter((r) => bag[r] > 0)
      .map((r) => `${bag[r]} ${r}`)
      .join(', ');
    log(state, 'produce', `${p.name} collects ${summary}.`, p.id, { gained: bag });
  }
}

/** Grants the yield of every land hex around a corner, for the second settlement. */
function grantInitialResources(state: GameState, p: PlayerState, vertex: VertexId): void {
  const gain = emptyBag();
  for (const hexIdStr of landHexesAt(state, vertex)) {
    const resource = TERRAIN_YIELD[state.board.tileById[hexIdStr].terrain];
    if (resource) gain[resource] += 1;
  }
  if (bagTotal(gain) === 0) return;
  takeFromBank(state, p, gain);
  const summary = RESOURCES.filter((r) => gain[r] > 0)
    .map((r) => `${gain[r]} ${r}`)
    .join(', ');
  log(state, 'produce', `${p.name} collects ${summary} from their second settlement.`, p.id, { gained: gain });
}

/** Refreshes which harbour rates a player's buildings unlock. */
function updateHarbors(state: GameState, p: PlayerState): void {
  const owned = new Set([...p.settlements, ...p.cities]);
  p.harborRatios = {};
  p.hasGenericHarbor = false;
  for (const harbor of state.board.harbors) {
    if (!harbor.vertices.some((v) => owned.has(v))) continue;
    if (harbor.resource === null) p.hasGenericHarbor = true;
    else p.harborRatios[harbor.resource] = harbor.ratio;
  }
}

/** Cards the player must hand over for one of `want` at the bank. */
export function bankTradeRatio(p: PlayerState, give: Resource): number {
  const specific = p.harborRatios[give];
  if (specific) return specific;
  return p.hasGenericHarbor ? 3 : DEFAULT_BANK_RATIO;
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function advanceSetup(state: GameState): void {
  state.setupIndex += 1;
  const n = state.players.length;
  if (state.setupIndex >= state.setupOrder.length) {
    state.phase = 'play';
    state.currentPlayer = state.setupOrder[0];
    state.pending = { kind: 'roll' };
    log(state, 'setup_complete', 'Setup is complete. Roll to begin.');
    return;
  }
  state.currentPlayer = state.setupOrder[state.setupIndex];
  state.pending = {
    kind: 'setup',
    round: state.setupIndex < n ? 1 : 2,
    step: 'settlement',
    lastVertex: null,
  };
}

function endTurn(state: GameState, settings: GameSettings): void {
  const p = currentPlayer(state);
  for (const card of Object.keys(p.pendingDevCards) as DevCard[]) {
    p.devCards[card] += p.pendingDevCards[card];
    p.pendingDevCards[card] = 0;
  }
  p.playedDevCardThisTurn = false;
  state.trades = [];
  state.dice = null;
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.turn += 1;
  state.pending = { kind: 'roll' };
  log(state, 'turn', `${currentPlayer(state).name}'s turn.`, currentPlayer(state).id);
  // An award can change hands during someone else's turn, so a player may
  // already be at the target when their turn opens. Wins are only declared on
  // your own turn, which this now is.
  checkVictory(state, settings, currentPlayer(state));
}

/** Enters the discard step if anyone is over the hand limit, else moves the robber. */
function beginRobberSequence(state: GameState, resume: 'roll' | 'main'): void {
  const owed: Record<PlayerId, number> = {};
  for (const p of state.players) {
    const total = bagTotal(p.resources);
    if (total > HAND_LIMIT_BEFORE_DISCARD) owed[p.id] = Math.floor(total / 2);
  }
  if (Object.keys(owed).length > 0) {
    state.pending = { kind: 'discard', owed };
    log(state, 'discard_required', 'Players holding more than seven cards must discard half.');
  } else {
    state.pending = { kind: 'move_robber', reason: 'dice', resume };
  }
}

function resolveRobberMove(state: GameState, mover: PlayerState, hex: HexId, resume: 'roll' | 'main', victim?: PlayerId | null): void {
  state.robber = hex;
  log(state, 'robber', `${mover.name} moves the robber.`, mover.id, { hex });

  const candidates = new Set<PlayerId>();
  for (const v of hexVertices(parseHexId(hex))) {
    const building = state.buildings[v];
    if (!building || building.owner === mover.id) continue;
    const other = playerById(state, building.owner);
    if (other && bagTotal(other.resources) > 0) candidates.add(other.id);
  }

  const list = [...candidates];
  if (list.length === 0) {
    state.pending = resume === 'roll' ? { kind: 'roll' } : { kind: 'main' };
    return;
  }
  if (victim != null) {
    if (!candidates.has(victim)) fail('bad_victim', 'That player cannot be robbed here.');
    stealCard(state, mover, victim);
    state.pending = resume === 'roll' ? { kind: 'roll' } : { kind: 'main' };
    return;
  }
  if (list.length === 1) {
    stealCard(state, mover, list[0]);
    state.pending = resume === 'roll' ? { kind: 'roll' } : { kind: 'main' };
    return;
  }
  state.pending = { kind: 'steal', candidates: list, resume };
}

function stealCard(state: GameState, thief: PlayerState, victimId: PlayerId): void {
  const victim = playerById(state, victimId);
  if (!victim) fail('bad_victim', 'Unknown player.');
  const cards = bagToCards(victim.resources);
  if (cards.length === 0) return;
  const stolen = cards[nextInt(state.rng, cards.length)];
  victim.resources[stolen] -= 1;
  thief.resources[stolen] += 1;
  // The resource is deliberately not written into the log text: only the two
  // players involved may learn what changed hands.
  log(state, 'steal', `${thief.name} steals a card from ${victim.name}.`, thief.id, {
    victim: victimId,
    resource: stolen,
    private: true,
  });
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

function requireTurn(state: GameState, p: PlayerState): void {
  if (p.seat !== state.currentPlayer) fail('not_your_turn', 'It is not your turn.');
}

function requirePending<K extends GameState['pending']['kind']>(
  state: GameState,
  kind: K,
): Extract<GameState['pending'], { kind: K }> {
  if (state.pending.kind !== kind) fail('bad_phase', `Expected to be in the ${kind} step.`);
  return state.pending as Extract<GameState['pending'], { kind: K }>;
}

function placeRoad(state: GameState, p: PlayerState, edge: EdgeId): void {
  state.roads[edge] = { edge, owner: p.id };
  p.roads.push(edge);
  p.piecesLeft.road -= 1;
}

function placeBuilding(state: GameState, p: PlayerState, vertex: VertexId, kind: 'settlement' | 'city'): void {
  state.buildings[vertex] = { vertex, owner: p.id, kind };
  if (kind === 'settlement') {
    p.settlements.push(vertex);
    p.piecesLeft.settlement -= 1;
  } else {
    p.settlements = p.settlements.filter((v) => v !== vertex);
    p.cities.push(vertex);
    p.piecesLeft.city -= 1;
    p.piecesLeft.settlement += 1; // the settlement returns to your supply
  }
  updateHarbors(state, p);
}

export interface ApplyResult {
  state: GameState;
  /** Log entries produced by this action, for incremental UI updates. */
  events: GameState['log'];
}

/**
 * Validates and applies one action, mutating `state`.
 *
 * Throws `RuleError` and leaves the state untouched when the action is not
 * legal — callers should treat a throw as "reject the message", not as a bug.
 */
export function applyAction(
  state: GameState,
  settings: GameSettings,
  playerId: PlayerId,
  action: Action,
): ApplyResult {
  if (state.phase === 'ended') fail('game_over', 'The game is over.');
  const p = playerById(state, playerId);
  if (!p) fail('unknown_player', 'You are not in this game.');
  const logStart = state.log.length;

  switch (action.type) {
    // --- setup -----------------------------------------------------------
    case 'place_setup_settlement': {
      requireTurn(state, p);
      const pending = requirePending(state, 'setup');
      if (pending.step !== 'settlement') fail('bad_phase', 'Place your road first.');
      if (!isBoardVertex(state, action.vertex)) fail('off_board', 'That corner is not on the board.');
      if (!satisfiesDistanceRule(state, action.vertex)) {
        fail('too_close', 'Settlements must be at least two corners apart.');
      }
      placeBuilding(state, p, action.vertex, 'settlement');
      log(state, 'build', `${p.name} places a settlement.`, p.id, { vertex: action.vertex });
      if (pending.round === 2) grantInitialResources(state, p, action.vertex);
      state.pending = { ...pending, step: 'road', lastVertex: action.vertex };
      break;
    }

    case 'place_setup_road': {
      requireTurn(state, p);
      const pending = requirePending(state, 'setup');
      if (pending.step !== 'road' || !pending.lastVertex) fail('bad_phase', 'Place your settlement first.');
      if (!isBoardEdge(state, action.edge)) fail('off_board', 'That edge is not on the board.');
      if (state.roads[action.edge]) fail('occupied', 'There is already a road there.');
      const [a, b] = edgeEndpoints(action.edge);
      if (a !== pending.lastVertex && b !== pending.lastVertex) {
        fail('not_connected', 'The road must touch the settlement you just placed.');
      }
      placeRoad(state, p, action.edge);
      log(state, 'build', `${p.name} places a road.`, p.id, { edge: action.edge });
      updateLongestRoad(state);
      advanceSetup(state);
      break;
    }

    // --- dice ------------------------------------------------------------
    case 'roll_dice': {
      requireTurn(state, p);
      requirePending(state, 'roll');
      const d1 = rollDie(state.rng);
      const d2 = rollDie(state.rng);
      state.dice = [d1, d2];
      const sum = d1 + d2;
      log(state, 'roll', `${p.name} rolls ${sum}.`, p.id, { dice: [d1, d2], sum });
      if (sum === 7) beginRobberSequence(state, 'main');
      else {
        distributeResources(state, sum);
        state.pending = { kind: 'main' };
      }
      break;
    }

    case 'discard': {
      const pending = requirePending(state, 'discard');
      const owed = pending.owed[p.id];
      if (owed === undefined) fail('nothing_to_discard', 'You do not need to discard.');
      const total = RESOURCES.reduce((n, r) => n + (action.resources[r] ?? 0), 0);
      if (total !== owed) fail('wrong_discard', `You must discard exactly ${owed} cards.`);
      if (!bagCovers(p.resources, action.resources)) fail('insufficient', 'You do not hold those cards.');
      payToBank(state, p, action.resources);
      log(state, 'discard', `${p.name} discards ${owed} cards.`, p.id);
      const remaining = { ...pending.owed };
      delete remaining[p.id];
      if (Object.keys(remaining).length > 0) state.pending = { kind: 'discard', owed: remaining };
      else state.pending = { kind: 'move_robber', reason: 'dice', resume: 'main' };
      break;
    }

    case 'move_robber': {
      requireTurn(state, p);
      const pending = requirePending(state, 'move_robber');
      if (!state.board.tileById[action.hex]) fail('off_board', 'The robber must stand on a land tile.');
      if (action.hex === state.robber) fail('same_hex', 'The robber must move to a different tile.');
      resolveRobberMove(state, p, action.hex, pending.resume, action.victim ?? null);
      break;
    }

    case 'steal': {
      requireTurn(state, p);
      const pending = requirePending(state, 'steal');
      if (!pending.candidates.includes(action.victim)) fail('bad_victim', 'That player cannot be robbed here.');
      stealCard(state, p, action.victim);
      state.pending = pending.resume === 'roll' ? { kind: 'roll' } : { kind: 'main' };
      break;
    }

    // --- building --------------------------------------------------------
    case 'build_road': {
      requireTurn(state, p);
      const free = state.pending.kind === 'build_roads';
      if (!free) requirePending(state, 'main');
      if (!isBoardEdge(state, action.edge)) fail('off_board', 'That edge is not on the board.');
      if (state.roads[action.edge]) fail('occupied', 'There is already a road there.');
      if (p.piecesLeft.road <= 0) fail('no_pieces', 'You have no roads left.');
      if (!legalRoadEdges(state, p.id).includes(action.edge)) {
        fail('not_connected', 'Roads must extend your own network.');
      }
      if (!free) {
        if (!bagCovers(p.resources, BUILD_COSTS.road)) fail('insufficient', 'You cannot afford a road.');
        payToBank(state, p, BUILD_COSTS.road);
      }
      placeRoad(state, p, action.edge);
      log(state, 'build', `${p.name} builds a road.`, p.id, { edge: action.edge, free });
      updateLongestRoad(state);
      if (free) {
        const left = (state.pending as { kind: 'build_roads'; roadsLeft: number }).roadsLeft - 1;
        state.pending = left > 0 && p.piecesLeft.road > 0 ? { kind: 'build_roads', roadsLeft: left } : { kind: 'main' };
      }
      checkVictory(state, settings, p);
      break;
    }

    case 'build_settlement': {
      requireTurn(state, p);
      requirePending(state, 'main');
      if (!isBoardVertex(state, action.vertex)) fail('off_board', 'That corner is not on the board.');
      if (p.piecesLeft.settlement <= 0) fail('no_pieces', 'You have no settlements left.');
      if (!satisfiesDistanceRule(state, action.vertex)) {
        fail('too_close', 'Settlements must be at least two corners apart.');
      }
      if (!touchesOwnRoad(state, p.id, action.vertex)) fail('not_connected', 'Settlements must touch one of your roads.');
      if (!bagCovers(p.resources, BUILD_COSTS.settlement)) fail('insufficient', 'You cannot afford a settlement.');
      payToBank(state, p, BUILD_COSTS.settlement);
      placeBuilding(state, p, action.vertex, 'settlement');
      log(state, 'build', `${p.name} builds a settlement.`, p.id, { vertex: action.vertex });
      // A new settlement can cut an opponent's route, so re-evaluate the award.
      updateLongestRoad(state);
      checkVictory(state, settings, p);
      break;
    }

    case 'build_city': {
      requireTurn(state, p);
      requirePending(state, 'main');
      const building = state.buildings[action.vertex];
      if (!building || building.owner !== p.id || building.kind !== 'settlement') {
        fail('no_settlement', 'You must upgrade one of your own settlements.');
      }
      if (p.piecesLeft.city <= 0) fail('no_pieces', 'You have no cities left.');
      if (!bagCovers(p.resources, BUILD_COSTS.city)) fail('insufficient', 'You cannot afford a city.');
      payToBank(state, p, BUILD_COSTS.city);
      placeBuilding(state, p, action.vertex, 'city');
      log(state, 'build', `${p.name} upgrades to a city.`, p.id, { vertex: action.vertex });
      checkVictory(state, settings, p);
      break;
    }

    // --- development cards ------------------------------------------------
    case 'buy_dev_card': {
      requireTurn(state, p);
      requirePending(state, 'main');
      if (state.devDeck.length === 0) fail('deck_empty', 'The development deck is empty.');
      if (!bagCovers(p.resources, BUILD_COSTS.development_card)) {
        fail('insufficient', 'You cannot afford a development card.');
      }
      payToBank(state, p, BUILD_COSTS.development_card);
      const card = state.devDeck.pop()!;
      // Bought cards are locked until the next turn; victory points are the
      // one exception and count towards a win immediately.
      p.pendingDevCards[card] += 1;
      log(state, 'buy_dev', `${p.name} buys a development card.`, p.id, { card, private: true });
      checkVictory(state, settings, p);
      break;
    }

    case 'play_knight': {
      requireTurn(state, p);
      if (state.pending.kind !== 'main' && state.pending.kind !== 'roll') {
        fail('bad_phase', 'You cannot play a knight right now.');
      }
      if (p.playedDevCardThisTurn) fail('one_per_turn', 'You have already played a development card.');
      if (p.devCards.knight <= 0) fail('no_card', 'You have no knight to play.');
      p.devCards.knight -= 1;
      p.playedDevCards.knight += 1;
      p.playedKnights += 1;
      p.playedDevCardThisTurn = true;
      log(state, 'play_dev', `${p.name} plays a Knight.`, p.id, { card: 'knight' });
      updateLargestArmy(state);
      const resume = state.pending.kind === 'roll' ? 'roll' : 'main';
      state.pending = { kind: 'move_robber', reason: 'knight', resume };
      checkVictory(state, settings, p);
      break;
    }

    case 'play_road_building': {
      requireTurn(state, p);
      requirePending(state, 'main');
      if (p.playedDevCardThisTurn) fail('one_per_turn', 'You have already played a development card.');
      if (p.devCards.road_building <= 0) fail('no_card', 'You have no Road Building card.');
      p.devCards.road_building -= 1;
      p.playedDevCards.road_building += 1;
      p.playedDevCardThisTurn = true;
      log(state, 'play_dev', `${p.name} plays Road Building.`, p.id, { card: 'road_building' });
      const roadsLeft = Math.min(2, p.piecesLeft.road);
      state.pending = roadsLeft > 0 ? { kind: 'build_roads', roadsLeft } : { kind: 'main' };
      break;
    }

    case 'play_year_of_plenty': {
      requireTurn(state, p);
      requirePending(state, 'main');
      if (p.playedDevCardThisTurn) fail('one_per_turn', 'You have already played a development card.');
      if (p.devCards.year_of_plenty <= 0) fail('no_card', 'You have no Year of Plenty card.');
      if (action.resources.length !== 2) fail('bad_choice', 'Choose exactly two resources.');
      const want = emptyBag();
      for (const r of action.resources) want[r] += 1;
      if (!bagCovers(state.bank, want)) fail('bank_empty', 'The bank cannot supply those resources.');
      p.devCards.year_of_plenty -= 1;
      p.playedDevCards.year_of_plenty += 1;
      p.playedDevCardThisTurn = true;
      takeFromBank(state, p, want);
      log(state, 'play_dev', `${p.name} plays Year of Plenty.`, p.id, { card: 'year_of_plenty' });
      break;
    }

    case 'play_monopoly': {
      requireTurn(state, p);
      requirePending(state, 'main');
      if (p.playedDevCardThisTurn) fail('one_per_turn', 'You have already played a development card.');
      if (p.devCards.monopoly <= 0) fail('no_card', 'You have no Monopoly card.');
      p.devCards.monopoly -= 1;
      p.playedDevCards.monopoly += 1;
      p.playedDevCardThisTurn = true;
      let taken = 0;
      for (const other of state.players) {
        if (other.id === p.id) continue;
        taken += other.resources[action.resource];
        other.resources[action.resource] = 0;
      }
      p.resources[action.resource] += taken;
      log(state, 'play_dev', `${p.name} plays Monopoly on ${action.resource} and takes ${taken}.`, p.id, {
        card: 'monopoly',
        resource: action.resource,
        taken,
      });
      break;
    }

    // --- trading ----------------------------------------------------------
    case 'bank_trade': {
      requireTurn(state, p);
      requirePending(state, 'main');
      if (action.give === action.want) fail('bad_trade', 'Trade for a different resource.');
      const ratio = bankTradeRatio(p, action.give);
      if (p.resources[action.give] < ratio) fail('insufficient', `You need ${ratio} ${action.give}.`);
      if (state.bank[action.want] < 1) fail('bank_empty', `The bank has no ${action.want} left.`);
      p.resources[action.give] -= ratio;
      state.bank[action.give] += ratio;
      p.resources[action.want] += 1;
      state.bank[action.want] -= 1;
      log(state, 'bank_trade', `${p.name} trades ${ratio} ${action.give} for 1 ${action.want}.`, p.id);
      break;
    }

    case 'offer_trade': {
      requireTurn(state, p);
      requirePending(state, 'main');
      const give = normaliseBag(action.give);
      const want = normaliseBag(action.want);
      if (bagTotal(give) === 0 && bagTotal(want) === 0) fail('bad_trade', 'An offer must move something.');
      if (!bagCovers(p.resources, give)) fail('insufficient', 'You do not hold what you are offering.');
      if (state.trades.length >= 4) fail('too_many_offers', 'Resolve your open offers first.');
      const responses: Record<PlayerId, 'pending'> = {};
      for (const other of state.players) {
        if (other.id === p.id) continue;
        if (action.to && !action.to.includes(other.id)) continue;
        responses[other.id] = 'pending';
      }
      if (Object.keys(responses).length === 0) fail('no_partners', 'There is no one to trade with.');
      state.trades.push({
        id: `t${state.nextLogId}_${state.trades.length}`,
        from: p.id,
        give,
        want,
        to: action.to ?? null,
        responses,
      });
      log(state, 'trade_offer', `${p.name} offers a trade.`, p.id);
      break;
    }

    case 'respond_trade': {
      const offer = state.trades.find((t) => t.id === action.offerId);
      if (!offer) fail('no_offer', 'That offer is no longer open.');
      if (!(p.id in offer.responses)) fail('not_invited', 'That offer is not open to you.');
      offer.responses[p.id] = action.accept ? 'accept' : 'reject';
      if (action.accept) log(state, 'trade_accept', `${p.name} is willing to trade.`, p.id);
      break;
    }

    case 'confirm_trade': {
      requireTurn(state, p);
      const offer = state.trades.find((t) => t.id === action.offerId);
      if (!offer) fail('no_offer', 'That offer is no longer open.');
      if (offer.from !== p.id) fail('not_yours', 'Only the player who offered can confirm.');
      if (offer.responses[action.partner] !== 'accept') fail('not_accepted', 'That player has not accepted.');
      const partner = playerById(state, action.partner);
      if (!partner) fail('unknown_player', 'Unknown player.');
      // Hands move between the offer and the confirmation, so re-check both.
      if (!bagCovers(p.resources, offer.give)) fail('insufficient', 'You no longer hold what you offered.');
      if (!bagCovers(partner.resources, offer.want)) fail('insufficient', 'They no longer hold what you asked for.');
      bagAdd(p.resources, offer.give, -1);
      bagAdd(partner.resources, offer.give, +1);
      bagAdd(partner.resources, offer.want, -1);
      bagAdd(p.resources, offer.want, +1);
      state.trades = state.trades.filter((t) => t.id !== offer.id);
      log(state, 'trade', `${p.name} trades with ${partner.name}.`, p.id, { partner: partner.id });
      break;
    }

    case 'cancel_trade': {
      const offer = state.trades.find((t) => t.id === action.offerId);
      if (!offer) break;
      if (offer.from !== p.id) fail('not_yours', 'Only the player who offered can withdraw it.');
      state.trades = state.trades.filter((t) => t.id !== offer.id);
      break;
    }

    // --- turn end ---------------------------------------------------------
    case 'end_turn': {
      requireTurn(state, p);
      if (state.pending.kind !== 'main' && state.pending.kind !== 'build_roads') {
        fail('bad_phase', 'You cannot end your turn yet.');
      }
      endTurn(state, settings);
      break;
    }

    default: {
      const never: never = action;
      fail('unknown_action', `Unknown action: ${JSON.stringify(never)}`);
    }
  }

  state.version += 1;
  return { state, events: state.log.slice(logStart) };
}

function normaliseBag(bag: Partial<ResourceBag>): Partial<ResourceBag> {
  const out: Partial<ResourceBag> = {};
  for (const r of RESOURCES) {
    const n = Math.max(0, Math.floor(bag[r] ?? 0));
    if (n > 0) out[r] = n;
  }
  return out;
}

/** Cheap structural clone, used for speculative bot planning and tests. */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      resources: bagClone(p.resources),
      devCards: { ...p.devCards },
      pendingDevCards: { ...p.pendingDevCards },
      playedDevCards: { ...p.playedDevCards },
      roads: [...p.roads],
      settlements: [...p.settlements],
      cities: [...p.cities],
      piecesLeft: { ...p.piecesLeft },
      harborRatios: { ...p.harborRatios },
    })),
    buildings: Object.fromEntries(Object.entries(state.buildings).map(([k, v]) => [k, { ...v }])),
    roads: Object.fromEntries(Object.entries(state.roads).map(([k, v]) => [k, { ...v }])),
    devDeck: [...state.devDeck],
    bank: bagClone(state.bank),
    trades: state.trades.map((t) => ({ ...t, responses: { ...t.responses } })),
    log: [...state.log],
    setupOrder: [...state.setupOrder],
    rng: { ...state.rng },
  };
}

export { devTotal };

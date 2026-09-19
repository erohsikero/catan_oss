import {
  bankTradeRatio,
  landHexesAt,
  legalRoadEdges,
  legalSettlementVertices,
} from './engine.js';
import { edgeEndpoints, hexVertices, parseHexId, vertexNeighbors, type EdgeId, type VertexId } from './hex.js';
import type { Action, GameSettings } from './protocol.js';
import { nextInt } from './rng.js';
import { BUILD_COSTS } from './rules.js';
import { currentPlayer, playerById, type GameState, type PlayerState } from './state.js';
import {
  bagCovers,
  bagTotal,
  RESOURCES,
  TERRAIN_YIELD,
  type Resource,
  type ResourceBag,
} from './types.js';

/**
 * A heuristic opponent.
 *
 * It is deliberately not a search: it scores board positions with the same
 * rules of thumb a human learns first — pips, resource variety, harbours — and
 * spends resources down a fixed priority list. That plays a recognisably sane
 * game and, more usefully, never stalls a room waiting on a long think.
 */

/** How much a bot wants each resource, before board context. */
const BASE_VALUE: Record<Resource, number> = {
  brick: 1.05,
  lumber: 1.05,
  wool: 0.85,
  grain: 1.0,
  ore: 1.0,
};

function pipsAt(state: GameState, vertex: VertexId): number {
  let total = 0;
  for (const h of landHexesAt(state, vertex)) total += state.board.tileById[h].pips;
  return total;
}

/** Scores a corner for settlement placement. */
function scoreVertex(state: GameState, vertex: VertexId, owned: ResourceBag | null): number {
  const hexes = landHexesAt(state, vertex);
  let score = 0;
  const seen = new Set<Resource>();
  for (const h of hexes) {
    const tile = state.board.tileById[h];
    const resource = TERRAIN_YIELD[tile.terrain];
    if (!resource) {
      score += 0.2; // a desert corner is weak but still coastal frontage
      continue;
    }
    let weight = BASE_VALUE[resource];
    // Resources you already produce are worth less than ones you lack.
    if (owned && owned[resource] > 0) weight *= 0.72;
    if (!seen.has(resource)) {
      weight *= 1.15;
      seen.add(resource);
    }
    score += tile.pips * weight;
  }
  // Variety matters more than raw pips on a first settlement.
  score += seen.size * 1.6;
  for (const harbor of state.board.harbors) {
    if (!harbor.vertices.includes(vertex)) continue;
    score += harbor.resource === null ? 1.2 : 2.0;
  }
  return score;
}

/** What a player currently produces, in pips per resource. */
function productionProfile(state: GameState, p: PlayerState): ResourceBag {
  const profile: ResourceBag = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  for (const v of [...p.settlements, ...p.cities]) {
    const multiplier = p.cities.includes(v) ? 2 : 1;
    for (const h of landHexesAt(state, v)) {
      const tile = state.board.tileById[h];
      const resource = TERRAIN_YIELD[tile.terrain];
      if (resource) profile[resource] += tile.pips * multiplier;
    }
  }
  return profile;
}

function bestSetupVertex(state: GameState, p: PlayerState): VertexId | null {
  const options = legalSettlementVertices(state, p.id, true);
  if (options.length === 0) return null;
  const profile = p.settlements.length > 0 ? productionProfile(state, p) : null;
  let best = options[0];
  let bestScore = -Infinity;
  for (const v of options) {
    const score = scoreVertex(state, v, profile);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/** From the settlement just placed, head towards the best nearby open corner. */
function bestSetupRoad(state: GameState, p: PlayerState, from: VertexId): EdgeId | null {
  const options = legalRoadEdges(state, p.id, from).filter((e) => !state.roads[e]);
  if (options.length === 0) return null;
  let best = options[0];
  let bestScore = -Infinity;
  const profile = productionProfile(state, p);
  for (const e of options) {
    const [a, b] = edgeEndpoints(e);
    const target = a === from ? b : a;
    if (!state.board.vertexHexes[target]) continue;
    // Value the corner past this one: roads are only worth what they reach.
    let score = state.buildings[target] ? -5 : scoreVertex(state, target, profile) * 0.35;
    for (const onward of vertexNeighbors(target)) {
      if (state.buildings[onward] || !state.board.vertexHexes[onward]) continue;
      score += scoreVertex(state, onward, profile) * 0.2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Corners this player could reach by building one more road. */
function expansionTargets(state: GameState, p: PlayerState): Array<{ edge: EdgeId; vertex: VertexId; score: number }> {
  const profile = productionProfile(state, p);
  const out: Array<{ edge: EdgeId; vertex: VertexId; score: number }> = [];
  for (const e of legalRoadEdges(state, p.id)) {
    const [a, b] = edgeEndpoints(e);
    for (const v of [a, b]) {
      if (!state.board.vertexHexes[v]) continue;
      if (state.buildings[v]) continue;
      const blocked = vertexNeighbors(v).some((n) => state.buildings[n]);
      const score = blocked ? scoreVertex(state, v, profile) * 0.25 : scoreVertex(state, v, profile);
      out.push({ edge: e, vertex: v, score });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

function missing(have: ResourceBag, cost: Partial<ResourceBag>): Partial<ResourceBag> {
  const gap: Partial<ResourceBag> = {};
  for (const r of RESOURCES) {
    const need = (cost[r] ?? 0) - have[r];
    if (need > 0) gap[r] = need;
  }
  return gap;
}

/**
 * Finds a bank trade that moves the player closer to `cost`.
 * Only spends resources that are not themselves part of the goal.
 */
function tradeTowards(state: GameState, p: PlayerState, cost: Partial<ResourceBag>): Action | null {
  const gap = missing(p.resources, cost);
  const wanted = RESOURCES.filter((r) => (gap[r] ?? 0) > 0);
  if (wanted.length === 0) return null;
  // Only worth trading when a single swap closes the whole gap.
  const totalNeeded = wanted.reduce((n, r) => n + (gap[r] ?? 0), 0);
  if (totalNeeded > 1) return null;
  const want = wanted[0];
  if (state.bank[want] < 1) return null;
  let bestGive: Resource | null = null;
  let bestSurplus = 0;
  for (const give of RESOURCES) {
    if (give === want) continue;
    const ratio = bankTradeRatio(p, give);
    const keep = cost[give] ?? 0;
    const surplus = p.resources[give] - keep;
    if (surplus >= ratio && surplus - ratio > bestSurplus - ratio) {
      bestSurplus = surplus;
      bestGive = give;
    }
  }
  return bestGive ? { type: 'bank_trade', give: bestGive, want } : null;
}

/** Which tile hurts the leading opponent most, and who to rob there. */
function chooseRobberTarget(state: GameState, p: PlayerState): { hex: string; victim: string | null } {
  let bestHex = state.board.tiles.find((t) => t.id !== state.robber)!.id;
  let bestVictim: string | null = null;
  let bestScore = -Infinity;

  for (const tile of state.board.tiles) {
    if (tile.id === state.robber) continue;
    if (tile.terrain === 'sea') continue;
    let score = 0;
    let richestVictim: string | null = null;
    let richestCards = -1;
    let hitsSelf = false;
    for (const v of hexVertices(parseHexId(tile.id))) {
      const building = state.buildings[v];
      if (!building) continue;
      if (building.owner === p.id) {
        hitsSelf = true;
        continue;
      }
      const owner = playerById(state, building.owner);
      if (!owner) continue;
      const weight = building.kind === 'city' ? 2 : 1;
      // Target production and score, and prefer someone worth robbing.
      score += tile.pips * weight + owner.settlements.length + owner.cities.length * 2;
      const cards = bagTotal(owner.resources);
      if (cards > richestCards) {
        richestCards = cards;
        richestVictim = cards > 0 ? owner.id : null;
      }
    }
    if (hitsSelf) score -= 40;
    if (score > bestScore) {
      bestScore = score;
      bestHex = tile.id;
      bestVictim = richestVictim;
    }
  }
  return { hex: bestHex, victim: bestVictim };
}

/** Discards from the largest piles first, keeping what current plans need. */
function chooseDiscard(p: PlayerState, count: number): Partial<ResourceBag> {
  const out: Partial<ResourceBag> = {};
  const pool: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < p.resources[r]; i++) pool.push(r);
  for (let i = 0; i < count; i++) {
    // Recount each time so the discard spreads across the biggest stacks.
    const remaining: Record<Resource, number> = { ...p.resources };
    for (const r of RESOURCES) remaining[r] -= out[r] ?? 0;
    let pick: Resource = pool[0];
    let bestCount = -Infinity;
    for (const r of RESOURCES) {
      const adjusted = remaining[r] - BASE_VALUE[r];
      if (remaining[r] > 0 && adjusted > bestCount) {
        bestCount = adjusted;
        pick = r;
      }
    }
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

/**
 * The next action this bot wants to take, or null when it has nothing to do.
 * Callers apply it and call again until it returns null or ends the turn.
 */
export function botAction(state: GameState, _settings: GameSettings, botId: string): Action | null {
  const p = playerById(state, botId);
  if (!p || state.phase === 'ended') return null;
  const pending = state.pending;

  // Discards and trade replies happen out of turn.
  if (pending.kind === 'discard') {
    const owed = pending.owed[botId];
    if (owed === undefined) return null;
    return { type: 'discard', resources: chooseDiscard(p, owed) };
  }

  const openOffer = state.trades.find((t) => t.responses[botId] === 'pending');
  if (openOffer) {
    // Accept only when the incoming cards are worth at least as much as those
    // going out, with a small premium so bots do not trade away a near-win.
    const gain = RESOURCES.reduce((n, r) => n + (openOffer.give[r] ?? 0) * BASE_VALUE[r], 0);
    const loss = RESOURCES.reduce((n, r) => n + (openOffer.want[r] ?? 0) * BASE_VALUE[r], 0);
    const canPay = bagCovers(p.resources, openOffer.want);
    return { type: 'respond_trade', offerId: openOffer.id, accept: canPay && gain >= loss * 1.12 };
  }

  if (currentPlayer(state).id !== botId) return null;

  switch (pending.kind) {
    case 'setup': {
      if (pending.step === 'settlement') {
        const vertex = bestSetupVertex(state, p);
        return vertex ? { type: 'place_setup_settlement', vertex } : null;
      }
      if (!pending.lastVertex) return null;
      const edge = bestSetupRoad(state, p, pending.lastVertex);
      return edge ? { type: 'place_setup_road', edge } : null;
    }

    case 'roll': {
      // Playing a knight before rolling protects production from the robber.
      if (!p.playedDevCardThisTurn && p.devCards.knight > 0 && robberHurtsMe(state, p)) {
        return { type: 'play_knight' };
      }
      return { type: 'roll_dice' };
    }

    case 'move_robber': {
      const target = chooseRobberTarget(state, p);
      return { type: 'move_robber', hex: target.hex, victim: target.victim };
    }

    case 'steal': {
      let victim = pending.candidates[0];
      let most = -1;
      for (const id of pending.candidates) {
        const other = playerById(state, id);
        const cards = other ? bagTotal(other.resources) : 0;
        if (cards > most) {
          most = cards;
          victim = id;
        }
      }
      return { type: 'steal', victim };
    }

    case 'build_roads': {
      const targets = expansionTargets(state, p);
      if (targets.length === 0 || p.piecesLeft.road === 0) return { type: 'end_turn' };
      return { type: 'build_road', edge: targets[0].edge };
    }

    case 'main':
      return mainPhaseAction(state, p);

    default:
      return null;
  }
}

/** True when the robber currently sits on one of this player's tiles. */
function robberHurtsMe(state: GameState, p: PlayerState): boolean {
  for (const v of hexVertices(parseHexId(state.robber))) {
    if (state.buildings[v]?.owner === p.id) return true;
  }
  return false;
}

function mainPhaseAction(state: GameState, p: PlayerState): Action | null {
  // 1. Cities first: they double production and are worth two points.
  if (p.piecesLeft.city > 0 && p.settlements.length > 0) {
    if (bagCovers(p.resources, BUILD_COSTS.city)) {
      const best = [...p.settlements].sort((a, b) => pipsAt(state, b) - pipsAt(state, a))[0];
      return { type: 'build_city', vertex: best };
    }
  }

  // 2. Settlements: a point plus new production.
  const settlementSpots = legalSettlementVertices(state, p.id, false);
  if (p.piecesLeft.settlement > 0 && settlementSpots.length > 0) {
    if (bagCovers(p.resources, BUILD_COSTS.settlement)) {
      const profile = productionProfile(state, p);
      const best = settlementSpots.sort((a, b) => scoreVertex(state, b, profile) - scoreVertex(state, a, profile))[0];
      return { type: 'build_settlement', vertex: best };
    }
  }

  // 3. A knight is free value once the robber is sitting on us.
  if (!p.playedDevCardThisTurn && p.devCards.knight > 0 && robberHurtsMe(state, p)) {
    return { type: 'play_knight' };
  }

  // 4. Monopoly and Year of Plenty when they clearly help.
  if (!p.playedDevCardThisTurn && p.devCards.year_of_plenty > 0) {
    const goal = p.settlements.length > 0 && p.piecesLeft.city > 0 ? BUILD_COSTS.city : BUILD_COSTS.settlement;
    const gap = missing(p.resources, goal);
    const needed = RESOURCES.flatMap((r) => Array((gap[r] ?? 0) as number).fill(r) as Resource[]);
    if (needed.length > 0 && needed.length <= 2) {
      const pick = needed.length === 2 ? needed : [needed[0], needed[0]];
      if (bagCovers(state.bank, { [pick[0]]: pick[0] === pick[1] ? 2 : 1, [pick[1]]: 1 })) {
        return { type: 'play_year_of_plenty', resources: pick };
      }
    }
  }
  if (!p.playedDevCardThisTurn && p.devCards.monopoly > 0) {
    let bestResource: Resource = 'brick';
    let bestTotal = 0;
    for (const r of RESOURCES) {
      const total = state.players.reduce((n, other) => (other.id === p.id ? n : n + other.resources[r]), 0);
      if (total > bestTotal) {
        bestTotal = total;
        bestResource = r;
      }
    }
    if (bestTotal >= 4) return { type: 'play_monopoly', resource: bestResource };
  }
  if (!p.playedDevCardThisTurn && p.devCards.road_building > 0 && p.piecesLeft.road > 0) {
    const targets = expansionTargets(state, p);
    if (targets.length > 0) return { type: 'play_road_building' };
  }

  // 5. Roads, to open up somewhere worth settling.
  if (p.piecesLeft.road > 0 && p.piecesLeft.settlement > 0 && bagCovers(p.resources, BUILD_COSTS.road)) {
    const targets = expansionTargets(state, p);
    const reachable = new Set(settlementSpots);
    // Normally hold out for a corner that is actually worth reaching. But with
    // nowhere left to settle, any road that extends the network beats sitting
    // on the resources — otherwise a boxed-in player never expands again.
    const worthwhile =
      targets.find((t) => !reachable.has(t.vertex) && t.score > 6) ??
      (settlementSpots.length === 0 ? targets[0] : undefined);
    if (worthwhile) return { type: 'build_road', edge: worthwhile.edge };
  }

  // 6. Development cards soak up spare wool, grain and ore.
  if (state.devDeck.length > 0 && bagCovers(p.resources, BUILD_COSTS.development_card)) {
    const spare = bagTotal(p.resources) >= 5 || p.settlements.length + p.cities.length >= 3;
    if (spare) return { type: 'buy_dev_card' };
  }

  // 7. Trade with the bank when one swap unlocks the next build.
  const goals: Array<Partial<ResourceBag>> = [];
  if (p.piecesLeft.city > 0 && p.settlements.length > 0) goals.push(BUILD_COSTS.city);
  if (p.piecesLeft.settlement > 0 && settlementSpots.length > 0) goals.push(BUILD_COSTS.settlement);
  if (p.piecesLeft.road > 0 && p.piecesLeft.settlement > 0) goals.push(BUILD_COSTS.road);
  if (state.devDeck.length > 0) goals.push(BUILD_COSTS.development_card);
  for (const goal of goals) {
    const trade = tradeTowards(state, p, goal);
    if (trade) return trade;
  }

  return { type: 'end_turn' };
}

/** A varied, human-sounding bot name that is not already taken. */
export function botName(state: GameState, rng: { seed: number }): string {
  const names = [
    'Astrid', 'Bjorn', 'Calla', 'Dorian', 'Esme', 'Falk',
    'Greta', 'Halvar', 'Ingrid', 'Jorund', 'Kesta', 'Loka',
  ];
  const taken = new Set(state.players.map((p) => p.name));
  const free = names.filter((n) => !taken.has(n));
  const pool = free.length > 0 ? free : names;
  return pool[nextInt(rng as never, pool.length)];
}

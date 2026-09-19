import { edgeEndpoints, type EdgeId, type VertexId } from './hex.js';
import type { GameState } from './state.js';
import type { PlayerId } from './types.js';

/**
 * Longest continuous road for one player.
 *
 * This is the longest *trail* in the player's road graph: edges may not repeat,
 * but a corner may be passed through more than once (a figure-eight of roads is
 * legal and counts every segment). An opposing settlement or city standing on a
 * corner severs the route there, so the search stops when it arrives at one.
 *
 * Road networks cap at 15 segments, so exhaustive depth-first search from every
 * edge in both directions is cheap and — unlike the greedy approximations that
 * trip over branches and loops — always exact.
 */
export function longestRoadLength(state: GameState, playerId: PlayerId): number {
  const owned = new Set<EdgeId>();
  for (const [edge, road] of Object.entries(state.roads)) {
    if (road.owner === playerId) owned.add(edge);
  }
  if (owned.size === 0) return 0;

  // Cache endpoints once; edgeEndpoints re-derives neighbours on every call.
  const ends = new Map<EdgeId, [VertexId, VertexId]>();
  const incident = new Map<VertexId, EdgeId[]>();
  for (const e of owned) {
    const pair = edgeEndpoints(e);
    ends.set(e, pair);
    for (const v of pair) {
      const list = incident.get(v);
      if (list) list.push(e);
      else incident.set(v, [e]);
    }
  }

  /** A corner blocks the route when an opponent has built on it. */
  const blocked = (v: VertexId): boolean => {
    const b = state.buildings[v];
    return b !== undefined && b.owner !== playerId;
  };

  const visited = new Set<EdgeId>();
  let best = 0;

  const walk = (at: VertexId, length: number): void => {
    if (length > best) best = length;
    if (blocked(at)) return;
    for (const next of incident.get(at) ?? []) {
      if (visited.has(next)) continue;
      const [a, b] = ends.get(next)!;
      visited.add(next);
      walk(a === at ? b : a, length + 1);
      visited.delete(next);
    }
  };

  for (const e of owned) {
    const [a, b] = ends.get(e)!;
    // Start from each end so routes that begin mid-branch are still found.
    for (const start of [a, b]) {
      // Standing on a blocked corner is fine; you just cannot continue past it.
      visited.add(e);
      walk(start === a ? b : a, 1);
      visited.delete(e);
    }
  }

  return best;
}

/** Recomputes every player's road length. Call after any road or building change. */
export function recomputeRoadLengths(state: GameState): void {
  for (const p of state.players) {
    p.longestRoadLength = longestRoadLength(state, p.id);
  }
}

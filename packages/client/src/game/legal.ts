import {
  legalRoadEdges,
  legalSettlementVertices,
  satisfiesDistanceRule,
  vertexEdges,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerView,
  type VertexId,
} from '@hexhaven/shared';

/**
 * Legal-move highlighting.
 *
 * The server is the authority — it re-validates everything — but the board has
 * to show which corners and edges are available before the click. The engine's
 * placement helpers only read `board`, `buildings` and `roads`, all of which
 * are public and present in a player's view, so they can be reused directly
 * rather than reimplemented here and drifting out of step with the rules.
 */
function asState(view: PlayerView): GameState {
  return view as unknown as GameState;
}

export function settlementTargets(view: PlayerView, playerId: string, setup: boolean): VertexId[] {
  return legalSettlementVertices(asState(view), playerId, setup);
}

export function roadTargets(view: PlayerView, playerId: string, fromVertex?: VertexId): EdgeId[] {
  return legalRoadEdges(asState(view), playerId, fromVertex);
}

/** During setup the road must touch the settlement just placed. */
export function setupRoadTargets(view: PlayerView, vertex: VertexId): EdgeId[] {
  return vertexEdges(vertex).filter((e) => !view.roads[e] && view.board.edges.includes(e));
}

export function cityTargets(view: PlayerView): VertexId[] {
  return view.you ? [...view.you.settlements] : [];
}

/** Any land tile except the one the robber already occupies. */
export function robberTargets(view: PlayerView): HexId[] {
  return view.board.tiles.filter((t) => t.id !== view.robber).map((t) => t.id);
}

export function canPlaceSettlementAt(view: PlayerView, vertex: VertexId): boolean {
  return satisfiesDistanceRule(asState(view), vertex);
}

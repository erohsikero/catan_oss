import { type EdgeId, type HexId, type PlayerView, type VertexId } from '@hexhaven/shared';
export declare function settlementTargets(view: PlayerView, playerId: string, setup: boolean): VertexId[];
export declare function roadTargets(view: PlayerView, playerId: string, fromVertex?: VertexId): EdgeId[];
/** During setup the road must touch the settlement just placed. */
export declare function setupRoadTargets(view: PlayerView, vertex: VertexId): EdgeId[];
export declare function cityTargets(view: PlayerView): VertexId[];
/** Any land tile except the one the robber already occupies. */
export declare function robberTargets(view: PlayerView): HexId[];
export declare function canPlaceSettlementAt(view: PlayerView, vertex: VertexId): boolean;
//# sourceMappingURL=legal.d.ts.map
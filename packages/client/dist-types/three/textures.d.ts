import * as THREE from 'three';
import type { Terrain } from '@hexhaven/shared';
export interface TerrainMaps {
    map: THREE.Texture;
    normalMap: THREE.Texture;
    roughnessMap: THREE.Texture;
}
/** Bakes (and caches) the albedo, normal and roughness maps for one terrain. */
export declare function terrainMaps(terrain: Exclude<Terrain, 'sea'>): TerrainMaps;
/** The soil-and-rock band around the side of every tile. */
export declare function tileSideTexture(): THREE.CanvasTexture;
/**
 * A number token face: pale stone disc, the numeral, and the pip row whose
 * length tells you how likely the roll is at a glance.
 */
export declare function numberTokenTexture(value: number, pips: number): THREE.CanvasTexture;
/** The board on a harbour pier: the exchange rate, and what it trades. */
export declare function harborSignTexture(resource: string | null, ratio: number): THREE.CanvasTexture;
//# sourceMappingURL=textures.d.ts.map
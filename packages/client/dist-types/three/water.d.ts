import * as THREE from 'three';
/**
 * The sea.
 *
 * A shader rather than a texture: the swell has to move, and the shoreline
 * needs foam that follows the island outline. Gerstner-ish sums displace the
 * surface, and the fragment stage mixes depth colour, a fresnel rim and a
 * specular glint so the water reads as water from a low camera angle.
 */
export declare function createWaterMaterial(): THREE.ShaderMaterial;
//# sourceMappingURL=water.d.ts.map
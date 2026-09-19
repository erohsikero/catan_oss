import * as THREE from 'three';
/**
 * A procedural environment map.
 *
 * Physically based materials look plastic without something to reflect. Rather
 * than download an HDRI, this renders a sky gradient plus a warm sun disc into
 * a cube map and pre-filters it, which gives the pieces soft sky light from
 * above and warm bounce near the horizon at no download cost.
 */
export declare function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture;
//# sourceMappingURL=environment.d.ts.map
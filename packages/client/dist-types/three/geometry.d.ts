import * as THREE from 'three';
/**
 * A pointy-top hexagonal slab with a bevelled rim.
 *
 * The extrusion is built in XY and rotated flat, which puts corner k at angle
 * 30 + 60k in the XZ plane — matching the engine's coordinate convention, so
 * a corner's world position is just the centroid of its three tiles.
 *
 * Group 0 is the top and bottom faces (terrain material), group 1 the rim and
 * side walls (soil material).
 */
export declare function hexTileGeometry(size: number, thickness: number): THREE.BufferGeometry;
/** Flat hexagon used for hover and legal-move highlights. */
export declare function hexOutlineGeometry(size: number): THREE.BufferGeometry;
/** A settlement: a cottage with a pitched roof. */
export declare function settlementGeometry(scale: number): THREE.BufferGeometry;
/** A city: a walled keep with a tower, clearly bigger than a settlement. */
export declare function cityGeometry(scale: number): THREE.BufferGeometry;
/** A road segment: a chamfered bar lying along its edge. */
export declare function roadGeometry(length: number, width: number, height: number): THREE.BufferGeometry;
/** The robber: a hooded figure, deliberately taller than the buildings. */
export declare function robberGeometry(scale: number): THREE.BufferGeometry;
/** A conifer: stacked cones on a short trunk. Group 0 trunk, group 1 foliage. */
export declare function coniferGeometry(): THREE.BufferGeometry;
/** A broadleaf tree, for variety in the forests. */
export declare function broadleafGeometry(): THREE.BufferGeometry;
/** A boulder: an icosahedron pushed around so no two look alike. */
export declare function rockGeometry(seed: number): THREE.BufferGeometry;
/** A sheaf of wheat: a splayed bundle of tapered stalks. */
export declare function wheatGeometry(): THREE.BufferGeometry;
/** A sheep, for the pastures. Group 0 fleece, group 1 head and legs. */
export declare function sheepGeometry(): THREE.BufferGeometry;
/** A saguaro-style cactus for the desert. */
export declare function cactusGeometry(): THREE.BufferGeometry;
/** A stack of clay bricks drying beside the hill pits. */
export declare function brickStackGeometry(): THREE.BufferGeometry;
/** The pier deck and posts that mark a harbour. */
export declare function pierGeometry(): THREE.BufferGeometry;
export declare function disposeGeometryCache(): void;
//# sourceMappingURL=geometry.d.ts.map
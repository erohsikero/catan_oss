import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRandom } from './noise.js';

/**
 * Every model in the game is built from primitives here rather than loaded
 * from a file. Geometries are cached and shared: the board draws hundreds of
 * trees and rocks, and they must all point at the same buffers.
 */

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Merges parts into one geometry.
 *
 * three's primitives are inconsistent about indexing — boxes, cylinders and
 * spheres are indexed, polyhedra are not — and `mergeGeometries` refuses to
 * mix the two. Flattening everything to non-indexed first keeps the models
 * here free to combine any primitives. These meshes are tiny, so the extra
 * vertices cost nothing.
 */
function merge(parts: THREE.BufferGeometry[], useGroups = false): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, useGroups);
  if (!merged) throw new Error('failed to merge geometry parts');
  merged.computeVertexNormals();
  return merged;
}

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const geo = build();
  cache.set(key, geo);
  return geo;
}

// --- tiles -----------------------------------------------------------------

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
export function hexTileGeometry(size: number, thickness: number): THREE.BufferGeometry {
  return cached(`hex:${size}:${thickness}`, () => {
    const bevel = size * 0.045;
    const shape = new THREE.Shape();
    // Inset the outline by the bevel so the finished tile still spans `size`.
    const r = size - bevel;
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (30 + 60 * k);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 1,
    });

    // Planar UVs across the hex's bounding box, so the terrain texture lands
    // square on the top face instead of following the extrusion path.
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - bb.min.x) / w;
      uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / h;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    // Lay it flat: +Z becomes +Y, so the cap faces up.
    geo.rotateX(Math.PI / 2);
    geo.translate(0, thickness - bevel, 0);
    geo.computeVertexNormals();
    return geo;
  });
}

/** Flat hexagon used for hover and legal-move highlights. */
export function hexOutlineGeometry(size: number): THREE.BufferGeometry {
  return cached(`hexflat:${size}`, () => {
    const geo = new THREE.CircleGeometry(size, 6);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI / 6); // point-up, matching the tiles
    return geo;
  });
}

// --- playing pieces --------------------------------------------------------

/** A settlement: a cottage with a pitched roof. */
export function settlementGeometry(scale: number): THREE.BufferGeometry {
  return cached(`settlement:${scale}`, () => {
    const parts: THREE.BufferGeometry[] = [];

    const walls = new THREE.BoxGeometry(1.0, 0.62, 0.86);
    walls.translate(0, 0.31, 0);
    parts.push(walls);

    // Roof: a prism, made by collapsing one axis of a four-sided cylinder.
    const roof = new THREE.CylinderGeometry(0.72, 0.72, 0.95, 3, 1);
    roof.rotateZ(Math.PI / 2);
    roof.rotateY(Math.PI / 2);
    roof.scale(1, 0.62, 1.16);
    roof.translate(0, 0.78, 0);
    parts.push(roof);

    const chimney = new THREE.BoxGeometry(0.17, 0.42, 0.17);
    chimney.translate(0.28, 1.0, 0.2);
    parts.push(chimney);

    const merged = merge(parts, false);
    merged.scale(scale, scale, scale);
    return merged;
  });
}

/** A city: a walled keep with a tower, clearly bigger than a settlement. */
export function cityGeometry(scale: number): THREE.BufferGeometry {
  return cached(`city:${scale}`, () => {
    const parts: THREE.BufferGeometry[] = [];

    const hall = new THREE.BoxGeometry(1.45, 0.8, 1.05);
    hall.translate(0, 0.4, 0);
    parts.push(hall);

    const hallRoof = new THREE.CylinderGeometry(0.78, 0.78, 1.42, 3, 1);
    hallRoof.rotateZ(Math.PI / 2);
    hallRoof.rotateY(Math.PI / 2);
    hallRoof.scale(1, 0.5, 1.02);
    hallRoof.translate(0, 0.95, 0);
    parts.push(hallRoof);

    const tower = new THREE.CylinderGeometry(0.42, 0.46, 1.5, 8);
    tower.translate(-0.78, 0.75, 0.06);
    parts.push(tower);

    const spire = new THREE.ConeGeometry(0.54, 0.7, 8);
    spire.translate(-0.78, 1.82, 0.06);
    parts.push(spire);

    // Battlements along the hall wall.
    for (let i = 0; i < 4; i++) {
      const merlon = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      merlon.translate(-0.22 + i * 0.3, 0.9, 0.52);
      parts.push(merlon);
    }

    const merged = merge(parts, false);
    merged.scale(scale, scale, scale);
    return merged;
  });
}

/** A road segment: a chamfered bar lying along its edge. */
export function roadGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  return cached(`road:${length}:${width}:${height}`, () => {
    const shape = new THREE.Shape();
    const c = Math.min(width, height) * 0.3;
    shape.moveTo(-width / 2 + c, -height / 2);
    shape.lineTo(width / 2 - c, -height / 2);
    shape.lineTo(width / 2, -height / 2 + c);
    shape.lineTo(width / 2, height / 2 - c);
    shape.lineTo(width / 2 - c, height / 2);
    shape.lineTo(-width / 2 + c, height / 2);
    shape.lineTo(-width / 2, height / 2 - c);
    shape.lineTo(-width / 2, -height / 2 + c);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, -length / 2);
    geo.rotateY(Math.PI / 2); // lie along X, which is the edge direction
    geo.computeVertexNormals();
    return geo;
  });
}

/** The robber: a hooded figure, deliberately taller than the buildings. */
export function robberGeometry(scale: number): THREE.BufferGeometry {
  return cached(`robber:${scale}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const cloak = new THREE.CylinderGeometry(0.34, 0.62, 1.25, 12, 1);
    cloak.translate(0, 0.62, 0);
    parts.push(cloak);
    const shoulders = new THREE.SphereGeometry(0.36, 12, 8);
    shoulders.scale(1, 0.7, 1);
    shoulders.translate(0, 1.26, 0);
    parts.push(shoulders);
    const hood = new THREE.ConeGeometry(0.34, 0.55, 12);
    hood.translate(0, 1.62, 0);
    parts.push(hood);
    const merged = merge(parts, false);
    merged.scale(scale, scale, scale);
    return merged;
  });
}

// --- terrain props ---------------------------------------------------------

/** A conifer: stacked cones on a short trunk. Group 0 trunk, group 1 foliage. */
export function coniferGeometry(): THREE.BufferGeometry {
  return cached('conifer', () => {
    const trunk = new THREE.CylinderGeometry(0.055, 0.075, 0.28, 6);
    trunk.translate(0, 0.14, 0);
    const tiers: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const radius = 0.3 - i * 0.07;
      const cone = new THREE.ConeGeometry(radius, 0.42, 8);
      cone.translate(0, 0.36 + i * 0.26, 0);
      tiers.push(cone);
    }
    const foliage = merge(tiers, false);
    const merged = merge([trunk, foliage], true);
    return merged;
  });
}

/** A broadleaf tree, for variety in the forests. */
export function broadleafGeometry(): THREE.BufferGeometry {
  return cached('broadleaf', () => {
    const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.34, 6);
    trunk.translate(0, 0.17, 0);
    const crown = new THREE.IcosahedronGeometry(0.28, 1);
    crown.scale(1, 0.86, 1);
    crown.translate(0, 0.6, 0);
    const merged = merge([trunk, crown], true);
    return merged;
  });
}

/** A boulder: an icosahedron pushed around so no two look alike. */
export function rockGeometry(seed: number): THREE.BufferGeometry {
  return cached(`rock:${seed}`, () => {
    const geo = new THREE.IcosahedronGeometry(0.3, 1);
    const rand = makeRandom(seed);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.68 + rand() * 0.62;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.82, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return geo;
  });
}

/** A sheaf of wheat: a splayed bundle of tapered stalks. */
export function wheatGeometry(): THREE.BufferGeometry {
  return cached('wheat', () => {
    const parts: THREE.BufferGeometry[] = [];
    const rand = makeRandom(7);
    for (let i = 0; i < 7; i++) {
      const stalk = new THREE.CylinderGeometry(0.012, 0.03, 0.34, 4);
      stalk.translate(0, 0.17, 0);
      stalk.rotateZ((rand() - 0.5) * 0.5);
      stalk.rotateX((rand() - 0.5) * 0.5);
      stalk.translate((rand() - 0.5) * 0.1, 0, (rand() - 0.5) * 0.1);
      parts.push(stalk);
    }
    const head = new THREE.SphereGeometry(0.1, 8, 6);
    head.scale(1, 1.5, 1);
    head.translate(0, 0.4, 0);
    parts.push(head);
    const merged = merge(parts, false);
    return merged;
  });
}

/** A sheep, for the pastures. Group 0 fleece, group 1 head and legs. */
export function sheepGeometry(): THREE.BufferGeometry {
  return cached('sheep', () => {
    const fleece = new THREE.IcosahedronGeometry(0.17, 1);
    fleece.scale(1.35, 1, 1);
    fleece.translate(0, 0.2, 0);

    const dark: THREE.BufferGeometry[] = [];
    const head = new THREE.SphereGeometry(0.075, 8, 6);
    head.scale(1, 1.15, 1.1);
    head.translate(0.22, 0.24, 0);
    dark.push(head);
    for (const [dx, dz] of [[0.12, 0.07], [0.12, -0.07], [-0.12, 0.07], [-0.12, -0.07]] as const) {
      const leg = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 4);
      leg.translate(dx, 0.08, dz);
      dark.push(leg);
    }
    const merged = merge([fleece, merge(dark)], true);
    return merged;
  });
}

/** A saguaro-style cactus for the desert. */
export function cactusGeometry(): THREE.BufferGeometry {
  return cached('cactus', () => {
    const parts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CapsuleGeometry(0.075, 0.42, 4, 8);
    trunk.translate(0, 0.32, 0);
    parts.push(trunk);
    for (const side of [-1, 1]) {
      const arm = new THREE.CapsuleGeometry(0.05, 0.2, 4, 8);
      arm.translate(0, 0.1, 0);
      arm.rotateZ((-side * Math.PI) / 3);
      arm.translate(side * 0.11, 0.34, 0);
      parts.push(arm);
      const tip = new THREE.CapsuleGeometry(0.05, 0.16, 4, 8);
      tip.translate(side * 0.19, 0.5, 0);
      parts.push(tip);
    }
    const merged = merge(parts, false);
    return merged;
  });
}

/** A stack of clay bricks drying beside the hill pits. */
export function brickStackGeometry(): THREE.BufferGeometry {
  return cached('brickstack', () => {
    const parts: THREE.BufferGeometry[] = [];
    // Four courses of two, each course turned ninety degrees from the last,
    // so the silhouette is a compact cube rather than a bar.
    for (let row = 0; row < 4; row++) {
      const across = row % 2 === 0;
      for (let i = 0; i < 2; i++) {
        const brick = new THREE.BoxGeometry(across ? 0.2 : 0.09, 0.05, across ? 0.09 : 0.2);
        brick.translate(
          across ? 0 : (i - 0.5) * 0.11,
          0.03 + row * 0.055,
          across ? (i - 0.5) * 0.11 : 0,
        );
        parts.push(brick);
      }
    }
    const merged = merge(parts, false);
    return merged;
  });
}

/** The pier deck and posts that mark a harbour. */
export function pierGeometry(): THREE.BufferGeometry {
  return cached('pier', () => {
    const parts: THREE.BufferGeometry[] = [];
    const deck = new THREE.BoxGeometry(0.62, 0.055, 0.36);
    deck.translate(0, 0.18, 0);
    parts.push(deck);
    for (const [dx, dz] of [[-0.24, -0.12], [0.24, -0.12], [-0.24, 0.12], [0.24, 0.12]] as const) {
      const post = new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6);
      post.translate(dx, 0, dz);
      parts.push(post);
    }
    const merged = merge(parts, false);
    return merged;
  });
}

export function disposeGeometryCache(): void {
  for (const geo of cache.values()) geo.dispose();
  cache.clear();
}

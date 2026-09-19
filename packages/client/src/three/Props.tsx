import { useMemo } from 'react';
import * as THREE from 'three';
import { hexToWorld, type Terrain, type Tile } from '@hexhaven/shared';
import {
  brickStackGeometry,
  broadleafGeometry,
  cactusGeometry,
  coniferGeometry,
  rockGeometry,
  sheepGeometry,
  wheatGeometry,
} from './geometry.js';
import { makeRandom } from './noise.js';
import { HEX_SIZE, SURFACE_Y } from './theme.js';

/**
 * The scenery that makes a tile readable at a glance: forests of trees, rocky
 * peaks, wheat sheaves, grazing sheep. Terrain textures alone are flat from a
 * low camera; the silhouettes are what tell you what a tile produces.
 *
 * Everything is drawn with instanced meshes — one draw call per prop type for
 * the whole board, rather than one per object.
 */

const INRADIUS = HEX_SIZE * (Math.sqrt(3) / 2);
/** Props stay out of this radius so they never crowd the number token. */
const TOKEN_CLEARANCE = HEX_SIZE * 0.42;
/** And inside this one, so nothing pokes over the tile's bevelled rim. */
const EDGE_MARGIN = HEX_SIZE * 0.88;

const HEX_NORMALS: Array<[number, number]> = [0, 1, 2].map((k) => {
  const a = (Math.PI / 3) * k;
  return [Math.cos(a), Math.sin(a)];
});

function insideHex(x: number, z: number, limit: number): boolean {
  for (const [nx, nz] of HEX_NORMALS) {
    if (Math.abs(x * nx + z * nz) > limit * (Math.sqrt(3) / 2)) return false;
  }
  return true;
}

interface Placement {
  x: number;
  z: number;
  scale: number;
  rotation: number;
  tint: number;
}

/** Rejection-samples positions inside the hex, away from the token and rim. */
function scatter(seed: number, count: number, minScale: number, maxScale: number): Placement[] {
  const rand = makeRandom(seed);
  const out: Placement[] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 40) {
    attempts++;
    const x = (rand() * 2 - 1) * HEX_SIZE;
    const z = (rand() * 2 - 1) * HEX_SIZE;
    if (!insideHex(x, z, EDGE_MARGIN)) continue;
    if (Math.hypot(x, z) < TOKEN_CLEARANCE) continue;
    // Keep props from intersecting each other.
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.15)) continue;
    out.push({
      x,
      z,
      scale: minScale + rand() * (maxScale - minScale),
      rotation: rand() * Math.PI * 2,
      tint: 0.82 + rand() * 0.36,
    });
  }
  return out;
}

type PropKind = 'conifer' | 'broadleaf' | 'rock' | 'wheat' | 'sheep' | 'cactus' | 'bricks';

/** What grows on each terrain, and how densely. */
const TERRAIN_PROPS: Record<Exclude<Terrain, 'sea'>, Array<{ kind: PropKind; count: number; min: number; max: number }>> = {
  // Scales are relative to a hex of circumradius 1. A tree around 0.35 high
  // reads as a forest from the play camera; much larger and the canopy hides
  // the number token and the tile beneath it.
  forest: [
    { kind: 'conifer', count: 9, min: 0.26, max: 0.4 },
    { kind: 'broadleaf', count: 5, min: 0.24, max: 0.34 },
  ],
  mountains: [
    { kind: 'rock', count: 12, min: 0.35, max: 0.95 },
  ],
  fields: [
    { kind: 'wheat', count: 13, min: 0.34, max: 0.5 },
  ],
  pasture: [
    { kind: 'sheep', count: 5, min: 0.5, max: 0.66 },
    { kind: 'broadleaf', count: 2, min: 0.2, max: 0.3 },
  ],
  hills: [
    { kind: 'bricks', count: 6, min: 0.4, max: 0.62 },
    { kind: 'rock', count: 4, min: 0.28, max: 0.5 },
  ],
  desert: [
    { kind: 'cactus', count: 3, min: 0.35, max: 0.52 },
    { kind: 'rock', count: 5, min: 0.25, max: 0.45 },
  ],
};

const PROP_MATERIALS: Record<PropKind, THREE.Material | THREE.Material[]> = {
  conifer: [
    new THREE.MeshStandardMaterial({ color: '#6b4a2c', roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: '#2f6b38', roughness: 0.85 }),
  ],
  broadleaf: [
    new THREE.MeshStandardMaterial({ color: '#7a5533', roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: '#4e8c3f', roughness: 0.82 }),
  ],
  rock: new THREE.MeshStandardMaterial({ color: '#6c6862', roughness: 0.82, metalness: 0.06 }),
  wheat: new THREE.MeshStandardMaterial({ color: '#d9a93f', roughness: 0.88 }),
  sheep: [
    new THREE.MeshStandardMaterial({ color: '#f2efe4', roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: '#41382f', roughness: 0.9 }),
  ],
  cactus: new THREE.MeshStandardMaterial({ color: '#4a7544', roughness: 0.8 }),
  bricks: new THREE.MeshStandardMaterial({ color: '#8d4526', roughness: 0.92 }),
};

function geometryFor(kind: PropKind, seed: number): THREE.BufferGeometry {
  switch (kind) {
    case 'conifer':
      return coniferGeometry();
    case 'broadleaf':
      return broadleafGeometry();
    // Three carved boulders, picked per instance, so peaks are not clones.
    case 'rock':
      return rockGeometry(seed % 3);
    case 'wheat':
      return wheatGeometry();
    case 'sheep':
      return sheepGeometry();
    case 'cactus':
      return cactusGeometry();
    case 'bricks':
      return brickStackGeometry();
  }
}

interface Instance {
  matrix: THREE.Matrix4;
  tint: number;
}

export function TerrainProps({ tiles }: { tiles: readonly Tile[] }) {
  const groups = useMemo(() => {
    // key is `${kind}:${rockVariant}` so each rock shape gets its own batch.
    const byKey = new Map<string, { kind: PropKind; seed: number; items: Instance[] }>();
    const dummy = new THREE.Object3D();

    for (const tile of tiles) {
      if (tile.terrain === 'sea') continue;
      const centre = hexToWorld(tile, HEX_SIZE);
      const plan = TERRAIN_PROPS[tile.terrain];
      let salt = 0;
      for (const entry of plan) {
        const seed = tile.q * 7919 + tile.r * 104729 + salt++ * 31;
        for (const [i, p] of scatter(seed, entry.count, entry.min, entry.max).entries()) {
          const variant = entry.kind === 'rock' ? (seed + i) % 3 : 0;
          const key = `${entry.kind}:${variant}`;
          let bucket = byKey.get(key);
          if (!bucket) byKey.set(key, (bucket = { kind: entry.kind, seed: variant, items: [] }));
          dummy.position.set(centre.x + p.x, SURFACE_Y, centre.z + p.z);
          dummy.rotation.set(0, p.rotation, 0);
          dummy.scale.setScalar(p.scale);
          dummy.updateMatrix();
          bucket.items.push({ matrix: dummy.matrix.clone(), tint: p.tint });
        }
      }
    }
    return [...byKey.entries()].map(([key, bucket]) => ({ key, ...bucket }));
  }, [tiles]);

  return (
    <group>
      {groups.map(({ key, kind, seed, items }) => (
        <InstancedProps key={key} kind={kind} seed={seed} items={items} />
      ))}
    </group>
  );
}

function InstancedProps({ kind, seed, items }: { kind: PropKind; seed: number; items: Instance[] }) {
  const geometry = useMemo(() => geometryFor(kind, seed), [kind, seed]);
  const material = PROP_MATERIALS[kind];

  const ref = useMemo(() => {
    const mesh = new THREE.InstancedMesh(geometry, material as THREE.Material, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const color = new THREE.Color();
    for (const [i, item] of items.entries()) {
      mesh.setMatrixAt(i, item.matrix);
      // Per-instance tint keeps a forest from looking like one tree repeated.
      mesh.setColorAt(i, color.setScalar(item.tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [geometry, material, items]);

  return <primitive object={ref} />;
}

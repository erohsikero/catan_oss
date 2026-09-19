import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  edgeAngle,
  edgeToWorld,
  hexToWorld,
  parseHexId,
  vertexToWorld,
  type Building,
  type PlayerColor,
  type Road,
} from '@hexhaven/shared';
import { cityGeometry, roadGeometry, robberGeometry, settlementGeometry } from './geometry.js';
import { HEX_SIZE, PLAYER_PALETTE, SURFACE_Y } from './theme.js';

/**
 * Player pieces.
 *
 * Materials are cached per colour so every piece a player owns shares one
 * material, and buildings are turned to face away from the board centre —
 * a row of cottages all facing the same way reads as a tile decoration
 * rather than as settlements.
 */

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function pieceMaterial(color: PlayerColor, variant: 'base' | 'dark' | 'light' = 'base'): THREE.MeshStandardMaterial {
  const key = `${color}:${variant}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const material = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE[color][variant],
    roughness: 0.42,
    metalness: 0.12,
    // A hint of sheen so pieces catch the sun against matte terrain.
    envMapIntensity: 1.1,
  });
  materialCache.set(key, material);
  return material;
}

/** Angle that turns a piece to face outward from the middle of the island. */
function outwardFacing(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function Buildings({
  buildings,
  colorOf,
}: {
  buildings: Record<string, Building>;
  colorOf: (playerId: string) => PlayerColor;
}) {
  const settlement = useMemo(() => settlementGeometry(0.2), []);
  const city = useMemo(() => cityGeometry(0.2), []);

  const items = useMemo(
    () =>
      Object.values(buildings).map((b) => {
        const p = vertexToWorld(b.vertex, HEX_SIZE);
        return { ...b, x: p.x, z: p.z, facing: outwardFacing(p.x, p.z), color: colorOf(b.owner) };
      }),
    [buildings, colorOf],
  );

  return (
    <group>
      {items.map((item) => (
        <mesh
          key={item.vertex}
          geometry={item.kind === 'city' ? city : settlement}
          material={pieceMaterial(item.color)}
          position={[item.x, SURFACE_Y, item.z]}
          rotation={[0, item.facing, 0]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

export function Roads({
  roads,
  colorOf,
}: {
  roads: Record<string, Road>;
  colorOf: (playerId: string) => PlayerColor;
}) {
  // Slightly shorter than the edge so neighbouring roads read as separate.
  const geometry = useMemo(() => roadGeometry(HEX_SIZE * 0.82, 0.1, 0.075), []);

  const items = useMemo(
    () =>
      Object.values(roads).map((r) => {
        const p = edgeToWorld(r.edge, HEX_SIZE);
        return { ...r, x: p.x, z: p.z, angle: edgeAngle(r.edge, HEX_SIZE), color: colorOf(r.owner) };
      }),
    [roads, colorOf],
  );

  return (
    <group>
      {items.map((item) => (
        <mesh
          key={item.edge}
          geometry={geometry}
          material={pieceMaterial(item.color)}
          position={[item.x, SURFACE_Y + 0.035, item.z]}
          rotation={[0, -item.angle, 0]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

/** The robber, drifting gently so the eye is drawn to the blocked tile. */
export function Robber({ hex }: { hex: string }) {
  const geometry = useMemo(() => robberGeometry(0.26), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2b2b33', roughness: 0.55, metalness: 0.2 }),
    [],
  );
  const group = useRef<THREE.Group>(null);
  const target = useMemo(() => {
    const p = hexToWorld(parseHexId(hex), HEX_SIZE);
    // Offset off-centre so the robber never hides the number token.
    return new THREE.Vector3(p.x + 0.3, SURFACE_Y, p.z + 0.3);
  }, [hex]);

  useFrame((state, delta) => {
    if (!group.current) return;
    // Glide to the new tile instead of teleporting.
    group.current.position.lerp(target, Math.min(1, delta * 6));
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.7) * 0.25;
  });

  return (
    <group ref={group} position={[target.x, target.y, target.z]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
    </group>
  );
}

import { useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  edgeAngle,
  edgeToWorld,
  hexToWorld,
  parseHexId,
  vertexToWorld,
  type PlayerColor,
} from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_PALETTE, SURFACE_Y } from './theme.js';

/**
 * Placement targets.
 *
 * Only legal targets are ever drawn, which doubles as the rules explaining
 * themselves: if a corner does not light up, it cannot be built on. Markers
 * pulse so they stay findable against busy terrain, and a hovered marker
 * previews the piece in the player's own colour.
 */

export type PickKind = 'vertex' | 'edge' | 'hex';

interface Props {
  kind: PickKind | null;
  targets: readonly string[];
  color: PlayerColor;
  onPick: (id: string) => void;
}

export function PlacementTargets({ kind, targets, color, onPick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const palette = PLAYER_PALETTE[color];

  const positions = useMemo(() => {
    if (!kind) return [];
    return targets.map((id) => {
      if (kind === 'vertex') {
        const p = vertexToWorld(id, HEX_SIZE);
        return { id, x: p.x, z: p.z, angle: 0 };
      }
      if (kind === 'edge') {
        const p = edgeToWorld(id, HEX_SIZE);
        return { id, x: p.x, z: p.z, angle: edgeAngle(id, HEX_SIZE) };
      }
      const p = hexToWorld(parseHexId(id), HEX_SIZE);
      return { id, x: p.x, z: p.z, angle: 0 };
    });
  }, [kind, targets]);

  if (!kind || positions.length === 0) return null;

  return (
    <group>
      {positions.map(({ id, x, z, angle }) => (
        <Marker
          key={id}
          kind={kind}
          x={x}
          z={z}
          angle={angle}
          base={palette.base}
          light={palette.light}
          hovered={hovered === id}
          onOver={() => setHovered(id)}
          onOut={() => setHovered((h) => (h === id ? null : h))}
          onPick={() => onPick(id)}
        />
      ))}
    </group>
  );
}

/**
 * One placement target.
 *
 * The shape matters more than it looks like it should. A city upgrade is
 * offered on a corner that already holds a settlement, and the marker used
 * to be a small sphere at that corner — which put it *inside* the house.
 * It was invisible, and a click aimed at the roof passed through geometry
 * the sphere did not cover, so upgrading appeared not to work at all.
 *
 * So the visible marker is a ring wider than any piece's footprint, with a
 * pip floating clear above it, and the thing that actually receives the
 * click is a transparent cylinder enclosing both. Nothing a player can see
 * is ever the hit target, and no piece can hide it.
 */
function Marker({
  kind,
  x,
  z,
  angle,
  base,
  light,
  hovered,
  onOver,
  onOut,
  onPick,
}: {
  kind: PickKind;
  x: number;
  z: number;
  angle: number;
  base: string;
  light: string;
  hovered: boolean;
  onOver: () => void;
  onOut: () => void;
  onPick: () => void;
}) {
  const group = useMemo(() => new THREE.Group(), []);

  useFrame((state) => {
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.1;
    group.scale.setScalar(hovered ? 1.28 : pulse);
  });

  const handlers = {
    onPointerOver: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      onOver();
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      onOut();
      document.body.style.cursor = '';
    },
    onPointerDown: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      document.body.style.cursor = '';
      onPick();
    },
  };

  const colour = hovered ? light : base;

  return (
    <primitive object={group} position={[x, SURFACE_Y, z]} rotation={[0, -angle, 0]}>
      {kind === 'vertex' && (
        <>
          {/* Wider than any piece standing on this corner. */}
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.23, 0.032, 10, 28]} />
            <meshStandardMaterial
              color={colour}
              emissive={base}
              emissiveIntensity={hovered ? 1.1 : 0.6}
              roughness={0.3}
            />
          </mesh>
          {/* Floats clear of a settlement, so a city upgrade is always visible. */}
          <mesh position={[0, 0.52, 0]}>
            <sphereGeometry args={[0.07, 16, 12]} />
            <meshStandardMaterial
              color={colour}
              emissive={base}
              emissiveIntensity={hovered ? 1.2 : 0.7}
              roughness={0.25}
            />
          </mesh>
          <HitTarget radius={0.26} height={0.78} yOffset={0.34} handlers={handlers} />
        </>
      )}

      {kind === 'edge' && (
        <>
          <mesh position={[0, 0.12, 0]}>
            <boxGeometry args={[HEX_SIZE * 0.6, 0.055, 0.12]} />
            <meshStandardMaterial
              color={colour}
              emissive={base}
              emissiveIntensity={hovered ? 1.0 : 0.55}
              roughness={0.3}
            />
          </mesh>
          <HitTarget radius={0.2} height={0.5} yOffset={0.22} handlers={handlers} />
        </>
      )}

      {kind === 'hex' && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]} {...handlers}>
          <circleGeometry args={[HEX_SIZE * 0.82, 6]} />
          <meshBasicMaterial
            color={colour}
            transparent
            opacity={hovered ? 0.45 : 0.22}
            depthWrite={false}
          />
        </mesh>
      )}
    </primitive>
  );
}

/**
 * The clickable volume.
 *
 * Fully transparent rather than `visible={false}`, because an invisible
 * object is skipped by the raycaster and would take no clicks at all.
 */
function HitTarget({
  radius,
  height,
  yOffset,
  handlers,
}: {
  radius: number;
  height: number;
  yOffset: number;
  handlers: Record<string, unknown>;
}) {
  return (
    <mesh position={[0, yOffset, 0]} {...handlers}>
      <cylinderGeometry args={[radius, radius, height, 12]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

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
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.12;
    const scale = hovered ? 1.45 : pulse;
    group.scale.setScalar(scale);
    group.position.y = (kind === 'hex' ? SURFACE_Y + 0.02 : SURFACE_Y + 0.06) + (hovered ? 0.04 : 0);
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

  return (
    <primitive object={group} position={[x, SURFACE_Y + 0.06, z]} rotation={[0, -angle, 0]}>
      {kind === 'vertex' && (
        <mesh {...handlers}>
          <sphereGeometry args={[0.1, 20, 14]} />
          <meshStandardMaterial
            color={hovered ? light : base}
            emissive={base}
            emissiveIntensity={hovered ? 0.9 : 0.45}
            roughness={0.3}
            transparent
            opacity={0.92}
          />
        </mesh>
      )}
      {kind === 'edge' && (
        <mesh {...handlers}>
          <boxGeometry args={[HEX_SIZE * 0.66, 0.05, 0.1]} />
          <meshStandardMaterial
            color={hovered ? light : base}
            emissive={base}
            emissiveIntensity={hovered ? 0.9 : 0.4}
            roughness={0.35}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}
      {kind === 'hex' && (
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} {...handlers}>
          <circleGeometry args={[HEX_SIZE * 0.82, 6]} />
          <meshBasicMaterial
            color={hovered ? light : base}
            transparent
            opacity={hovered ? 0.45 : 0.22}
            depthWrite={false}
          />
        </mesh>
      )}
    </primitive>
  );
}

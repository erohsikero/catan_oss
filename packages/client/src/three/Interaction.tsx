import { useMemo, useRef, useState } from 'react';
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
import { edgeHighlightTexture, highlightTexture } from './textures.js';

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
 * A glowing circle lying on the board, the way a physical board would be
 * marked. Two earlier attempts were worse for the same underlying reason:
 * a small sphere at the corner ended up *inside* whatever piece already
 * stood there, and a tall invisible hit cylinder could be intersected by a
 * ray aimed at a different corner behind it, so clicks occasionally acted
 * on a neighbour.
 *
 * Everything here is flat and lies on the surface. A flat highlight cannot
 * be swallowed by a piece standing in the middle of it - a city upgrade
 * shows as a ring *around* the settlement - and a flat hit area is only
 * ever hit by a ray actually pointing at that corner.
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
  const glow = useRef<THREE.Mesh>(null);
  const vertexMap = useMemo(() => (kind === 'vertex' ? highlightTexture() : null), [kind]);
  const edgeMap = useMemo(() => (kind === 'edge' ? edgeHighlightTexture() : null), [kind]);

  useFrame((state) => {
    const mesh = glow.current;
    if (!mesh) return;
    // A slow breath keeps the targets findable without pulling the eye off
    // the board the way a hard blink would.
    const pulse = 0.78 + Math.sin(state.clock.elapsedTime * 2.6) * 0.16;
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = hovered ? 1 : pulse;
    mesh.scale.setScalar(hovered ? 1.12 : 1);
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
  const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

  if (kind === 'hex') {
    return (
      <mesh
        position={[x, SURFACE_Y + 0.02, z]}
        rotation={[-Math.PI / 2, 0, Math.PI / 6]}
        {...handlers}
      >
        <circleGeometry args={[HEX_SIZE * 0.82, 6]} />
        <meshBasicMaterial color={colour} transparent opacity={hovered ? 0.45 : 0.22} depthWrite={false} />
      </mesh>
    );
  }

  const size: [number, number] = kind === 'vertex' ? [0.8, 0.8] : [HEX_SIZE * 0.86, 0.34];

  return (
    <group position={[x, SURFACE_Y + 0.016, z]} rotation={[0, -angle, 0]}>
      <mesh ref={glow} rotation={FLAT}>
        <planeGeometry args={size} />
        <meshBasicMaterial
          map={kind === 'vertex' ? vertexMap : edgeMap}
          color={colour}
          transparent
          // Lies on top of the tile without fighting it for depth. Normal
          // blending rather than additive: additive can only brighten, so
          // the highlight washed out over sand and wheat exactly where it
          // was needed most.
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* The click area: flat, and a shade larger than the glow. */}
      <mesh rotation={FLAT} position={[0, 0.001, 0]} {...handlers}>
        <planeGeometry args={[size[0] * 0.92, Math.max(size[1] * 0.92, 0.26)]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

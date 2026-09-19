import { useMemo } from 'react';
import * as THREE from 'three';
import {
  edgeToWorld,
  hexToWorld,
  parseHexId,
  vertexToWorld,
  type Board,
  type Harbor,
  type Tile,
} from '@hexhaven/shared';
import { pierGeometry } from './geometry.js';
import { harborSignTexture, numberTokenTexture } from './textures.js';
import { HEX_SIZE, SURFACE_Y } from './theme.js';

/**
 * Number tokens.
 *
 * Each sits proud of the tile as a carved disc, and the robber's tile is
 * dimmed so a blocked number is obvious without reading the board.
 */
export function NumberTokens({ tiles, robber }: { tiles: readonly Tile[]; robber: string }) {
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.285, 0.3, 0.062, 40), []);
  const rimMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cbb894', roughness: 0.78 }),
    [],
  );
  const bottomMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#a8977a', roughness: 0.9 }),
    [],
  );

  const tokens = useMemo(
    () =>
      tiles
        .filter((t) => t.number !== null)
        .map((tile) => ({
          tile,
          position: hexToWorld(tile, HEX_SIZE),
          faceMaterial: new THREE.MeshStandardMaterial({
            map: numberTokenTexture(tile.number!, tile.pips),
            roughness: 0.62,
          }),
        })),
    [tiles],
  );

  return (
    <group>
      {tokens.map(({ tile, position, faceMaterial }) => {
        const blocked = tile.id === robber;
        return (
          <mesh
            key={tile.id}
            geometry={geometry}
            material={[rimMaterial, faceMaterial, bottomMaterial]}
            position={[position.x, SURFACE_Y + 0.031, position.z]}
            castShadow
            receiveShadow
          >
            {blocked && (
              // A dark wash over a blocked number, drawn just above the face.
              <mesh position={[0, 0.034, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.29, 32]} />
                <meshBasicMaterial color="#10161d" transparent opacity={0.55} depthWrite={false} />
              </mesh>
            )}
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Harbours: a pier reaching into the water with its rate on a board, angled
 * back towards the island so it is readable from the usual camera position.
 */
export function Harbors({ board }: { board: Board }) {
  const geometry = useMemo(() => pierGeometry(), []);
  const woodMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8b6440', roughness: 0.9 }),
    [],
  );

  const piers = useMemo(
    () =>
      board.harbors.map((harbor: Harbor) => {
        const land = hexToWorld(parseHexId(harbor.hex), HEX_SIZE);
        const edge = edgeToWorld(harbor.edge, HEX_SIZE);
        // Push out past the edge into open water.
        const dx = edge.x - land.x;
        const dz = edge.z - land.z;
        const len = Math.hypot(dx, dz) || 1;
        const outward = { x: dx / len, z: dz / len };
        // Just clear of the shoreline: far enough to sit on water, close
        // enough to read as this tile's harbour rather than a loose raft.
        const position = {
          x: land.x + outward.x * (len + 0.3),
          z: land.z + outward.z * (len + 0.3),
        };
        // Face the sign back towards the middle of the board.
        const facing = Math.atan2(-outward.x, -outward.z);
        const anchors = harbor.vertices.map((v) => vertexToWorld(v, HEX_SIZE));
        return {
          key: harbor.edge,
          harbor,
          position,
          facing,
          anchors,
          signMaterial: new THREE.MeshStandardMaterial({
            map: harborSignTexture(harbor.resource, harbor.ratio),
            roughness: 0.85,
            side: THREE.DoubleSide,
          }),
        };
      }),
    [board],
  );

  return (
    <group>
      {piers.map(({ key, position, facing, anchors, signMaterial }) => (
        <group key={key} position={[position.x, 0.12, position.z]} rotation={[0, facing, 0]}>
          <mesh geometry={geometry} material={woodMaterial} castShadow receiveShadow />
          {/* Post and board, tilted back so the rate faces the play camera. */}
          <mesh position={[0, 0.38, 0]} material={woodMaterial} castShadow>
            <cylinderGeometry args={[0.028, 0.032, 0.42, 6]} />
          </mesh>
          <group position={[0, 0.62, 0.02]} rotation={[-0.42, 0, 0]}>
            <mesh material={signMaterial} castShadow>
              <planeGeometry args={[0.56, 0.35]} />
            </mesh>
          </group>
          {/* Mooring ropes running to the two corners this harbour serves. */}
          {anchors.map((a, i) => (
            <Rope
              key={i}
              from={[0, 0.2, 0]}
              to={[a.x - position.x, SURFACE_Y, a.z - position.z]}
              rotationY={-facing}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

/** A slack line between the pier and a coastal corner. */
function Rope({
  from,
  to,
  rotationY,
}: {
  from: [number, number, number];
  to: [number, number, number];
  rotationY: number;
}) {
  const { geometry } = useMemo(() => {
    const start = new THREE.Vector3(...from);
    // The `to` offset was computed in world space; undo the parent rotation.
    const end = new THREE.Vector3(...to).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const mid = start.clone().lerp(end, 0.5);
    mid.y -= 0.12; // sag
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    return { geometry: new THREE.TubeGeometry(curve, 10, 0.012, 5, false) };
  }, [from, to, rotationY]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#6b5942" roughness={1} />
    </mesh>
  );
}

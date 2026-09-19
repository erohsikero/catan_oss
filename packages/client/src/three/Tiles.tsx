import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { hexToWorld, type Tile } from '@hexhaven/shared';
import { hexTileGeometry } from './geometry.js';
import { terrainMaps, tileSideTexture } from './textures.js';
import { HEX_SIZE, TILE_THICKNESS } from './theme.js';
import { makeRandom } from './noise.js';

/**
 * The island's land tiles.
 *
 * Each tile gets its own material instance so it can carry a small random
 * rotation and tint of the shared terrain texture. Without that, nineteen
 * tiles cut from six textures read as obvious copies.
 */
export function Tiles({ tiles, onPick }: { tiles: readonly Tile[]; onPick?: (hexId: string) => void }) {
  const geometry = useMemo(() => hexTileGeometry(HEX_SIZE, TILE_THICKNESS), []);
  const sideTexture = useMemo(() => tileSideTexture(), []);

  const entries = useMemo(
    () =>
      tiles.map((tile) => {
        const rand = makeRandom(tile.q * 7349 + tile.r * 9187 + 17);
        const maps = terrainMaps(tile.terrain === 'sea' ? 'desert' : tile.terrain);
        // Clone so per-tile rotation and offset do not disturb the shared maps.
        const map = maps.map.clone();
        const normalMap = maps.normalMap.clone();
        const roughnessMap = maps.roughnessMap.clone();
        const rotation = Math.floor(rand() * 6) * (Math.PI / 3);
        const offset = new THREE.Vector2(rand(), rand());
        for (const t of [map, normalMap, roughnessMap]) {
          t.center.set(0.5, 0.5);
          t.rotation = rotation;
          t.offset.copy(offset);
          t.needsUpdate = true;
        }
        const tint = 0.94 + rand() * 0.12;
        return {
          tile,
          position: hexToWorld(tile, HEX_SIZE),
          material: new THREE.MeshStandardMaterial({
            map,
            normalMap,
            roughnessMap,
            normalScale: new THREE.Vector2(1.7, 1.7),
            color: new THREE.Color(tint, tint, tint),
            metalness: 0.02,
          }),
          sideMaterial: new THREE.MeshStandardMaterial({
            map: sideTexture,
            roughness: 0.95,
            metalness: 0,
          }),
        };
      }),
    [tiles, sideTexture],
  );

  // Each tile owns cloned textures and its own materials, so a new board
  // (a rematch, or a layout change in the lobby) must hand them back to the
  // GPU rather than leaving them resident for the rest of the session.
  useEffect(
    () => () => {
      for (const entry of entries) {
        for (const map of [entry.material.map, entry.material.normalMap, entry.material.roughnessMap]) {
          map?.dispose();
        }
        entry.material.dispose();
        entry.sideMaterial.dispose();
      }
    },
    [entries],
  );

  return (
    <group>
      {entries.map(({ tile, position, material, sideMaterial }) => (
        <mesh
          key={tile.id}
          geometry={geometry}
          material={[material, sideMaterial]}
          position={[position.x, 0, position.z]}
          castShadow
          receiveShadow
          onPointerDown={
            onPick
              ? (e) => {
                  e.stopPropagation();
                  onPick(tile.id);
                }
              : undefined
          }
        />
      ))}
    </group>
  );
}

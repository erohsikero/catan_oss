import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { PlayerColor, PlayerView } from '@hexhaven/shared';
import { Tiles } from './Tiles.js';
import { TerrainProps } from './Props.js';
import { Harbors, NumberTokens } from './Decor.js';
import { Buildings, Roads, Robber } from './Pieces.js';
import { Seabed, Water } from './Water.js';
import { PlacementTargets, type PickKind } from './Interaction.js';

import { BoardContactShadows } from './Shadows.js';
import { createEnvironment } from './environment.js';
import { HEX_SIZE } from './theme.js';
import type { Quality } from './quality.js';
// Shared with the browser tests, which project board coordinates to screen
// pixels rather than hunting for targets by clicking around. Keeping one
// definition means a camera change cannot silently break them.
import cameraConfig from './camera.json';

/**
 * The post-processing chain is the heaviest dependency in the client, and a
 * player on the plain tier never needs it. Loading it on demand keeps the
 * initial bundle small and the first frame early.
 */
const Effects = lazy(() => import('./Effects.js'));

export interface SceneProps {
  view: PlayerView;
  colorOf: (playerId: string) => PlayerColor;
  myColor: PlayerColor;
  pickKind: PickKind | null;
  pickTargets: readonly string[];
  onPick: (id: string) => void;
  quality: Quality;
}

/**
 * Sunlight and sky.
 *
 * One warm key light casts the shadows that give the pieces weight; a cool
 * hemisphere fills the shadow side so nothing goes black, and a pre-filtered
 * procedural sky provides the reflections the physically based materials need
 * to avoid looking like plastic.
 */
function Lighting() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const env = createEnvironment(gl);
    scene.environment = env;
    scene.background = new THREE.Color('#87b6d8');
    scene.fog = new THREE.Fog('#9ec4dd', 16, 46);
    return () => {
      scene.environment = null;
      scene.fog = null;
      env.dispose();
    };
  }, [gl, scene]);

  return (
    <>
      <hemisphereLight args={['#bcd9ef', '#3c5a46', 0.55]} />
      <directionalLight
        position={[7, 11, 5]}
        intensity={2.3}
        color="#fff3dd"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      />
      {/* A dim cool rim from behind, to separate pieces from the sea. */}
      <directionalLight position={[-6, 4, -8]} intensity={0.5} color="#a8c8e8" />
    </>
  );
}

function BoardContents({ view, colorOf, myColor, pickKind, pickTargets, onPick, quality }: SceneProps) {
  // The coastline sits a little beyond the outermost tile centres.
  const shoreRadius = useMemo(() => (view.board.radius + 0.62) * HEX_SIZE * Math.sqrt(3), [view.board.radius]);

  return (
    <>
      <Lighting />
      <Seabed />
      <Water shoreRadius={shoreRadius} directOutput={quality === 'off'} />
      <Tiles tiles={view.board.tiles} />
      <TerrainProps tiles={view.board.tiles} />
      <NumberTokens tiles={view.board.tiles} robber={view.robber} />
      <Harbors board={view.board} />
      <Roads roads={view.roads} colorOf={colorOf} />
      <Buildings buildings={view.buildings} colorOf={colorOf} />
      <Robber hex={view.robber} />
      <BoardContactShadows view={view} enabled={quality !== 'off'} />
      <PlacementTargets kind={pickKind} targets={pickTargets} color={myColor} onPick={onPick} />
      {quality !== 'off' && (
        // The board is already on screen while this loads; there is nothing
        // meaningful to show in its place.
        <Suspense fallback={null}>
          <Effects quality={quality} />
        </Suspense>
      )}
    </>
  );
}

export function Scene(props: SceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{
        position: cameraConfig.position as [number, number, number],
        fov: cameraConfig.fov,
        near: cameraConfig.near,
        far: cameraConfig.far,
      }}
      gl={{
        // Anti-aliasing is handled by SMAA on the top tier; keeping the
        // built-in pass as well would cost a second resolve for nothing.
        antialias: props.quality !== 'high',
        // Filmic tone mapping keeps the bright sea and dark forests from
        // clipping at either end. `Effects` moves this into the composer
        // when post-processing is on, so bloom sees the full range.
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.08,
      }}
      onCreated={({ gl }) => {
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <Suspense fallback={null}>
        <BoardContents {...props} />
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        panSpeed={0.6}
        minDistance={cameraConfig.minDistance}
        maxDistance={cameraConfig.maxDistance}
        // Stop the camera dropping under the sea or looking straight down.
        minPolarAngle={cameraConfig.minPolarAngle}
        maxPolarAngle={cameraConfig.maxPolarAngle}
        target={cameraConfig.target as [number, number, number]}
      />
    </Canvas>
  );
}

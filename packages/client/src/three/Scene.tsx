import { Suspense, useEffect, useMemo } from 'react';
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
import { createEnvironment } from './environment.js';
import { HEX_SIZE } from './theme.js';

export interface SceneProps {
  view: PlayerView;
  colorOf: (playerId: string) => PlayerColor;
  myColor: PlayerColor;
  pickKind: PickKind | null;
  pickTargets: readonly string[];
  onPick: (id: string) => void;
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

function BoardContents({ view, colorOf, myColor, pickKind, pickTargets, onPick }: SceneProps) {
  // The coastline sits a little beyond the outermost tile centres.
  const shoreRadius = useMemo(() => (view.board.radius + 0.62) * HEX_SIZE * Math.sqrt(3), [view.board.radius]);

  return (
    <>
      <Lighting />
      <Seabed />
      <Water shoreRadius={shoreRadius} />
      <Tiles tiles={view.board.tiles} />
      <TerrainProps tiles={view.board.tiles} />
      <NumberTokens tiles={view.board.tiles} robber={view.robber} />
      <Harbors board={view.board} />
      <Roads roads={view.roads} colorOf={colorOf} />
      <Buildings buildings={view.buildings} colorOf={colorOf} />
      <Robber hex={view.robber} />
      <PlacementTargets kind={pickKind} targets={pickTargets} color={myColor} onPick={onPick} />
    </>
  );
}

export function Scene(props: SceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 8.6, 9.2], fov: 42, near: 0.5, far: 120 }}
      gl={{
        antialias: true,
        // Filmic tone mapping keeps the bright sea and dark forests from
        // clipping at either end.
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
        minDistance={5}
        maxDistance={20}
        // Stop the camera dropping under the sea or looking straight down.
        minPolarAngle={0.18}
        maxPolarAngle={1.32}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}

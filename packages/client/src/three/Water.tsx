import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { createWaterMaterial } from './waterMaterial.js';

/**
 * The sea plane. Segmented enough for the vertex swell to show, and sized to
 * run past the horizon so the island never appears to float on a disc.
 */
export function Water({ shoreRadius }: { shoreRadius: number }) {
  const material = useMemo(() => createWaterMaterial(), []);
  const ref = useRef<THREE.Mesh>(null);

  useMemo(() => {
    material.uniforms.uShoreRadius.value = shoreRadius;
  }, [material, shoreRadius]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]} material={material} receiveShadow>
      <planeGeometry args={[90, 90, 220, 220]} />
    </mesh>
  );
}

/**
 * The seabed: a dark plane under the water so deep areas read as depth rather
 * than as a hole in the scene.
 */
export function Seabed() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]}>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial color="#0a2537" roughness={1} />
    </mesh>
  );
}

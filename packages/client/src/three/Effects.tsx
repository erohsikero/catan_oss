import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  SMAA,
  SSAO,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import type { Quality } from './quality.js';

/**
 * The post-processing stack.
 *
 * The board was previously rendered but never *photographed*: correct
 * geometry and materials with nothing between them and the screen. Three
 * things change that, in order of how much they matter here:
 *
 *   - **Ambient occlusion** darkens where surfaces meet, which is what makes
 *     tiles look seated against each other and props look like they are
 *     standing on ground rather than printed onto it. It is the single
 *     largest perceptual gap against a hand-baked art pipeline, and also the
 *     most expensive, so it only runs on the top tier.
 *   - **Bloom** gives the sun's glint off the sea and the pale number tokens
 *     a little falloff instead of a hard clip.
 *   - **Grading and vignette** warm the midtones and pull the eye to the
 *     middle of the island.
 *
 * Tone mapping moves into the composer when effects are on. Leaving it on
 * the renderer would tone-map to a low dynamic range *before* bloom ran, so
 * bloom would have nothing bright left to find.
 */
function Effects({ quality }: { quality: Quality }) {
  const { gl } = useThree();

  useEffect(() => {
    // Exactly one stage may tone-map. When the composer is active it owns it.
    gl.toneMapping = quality === 'off' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = 1.08;
    return () => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
    };
  }, [gl, quality]);

  if (quality === 'off') return null;
  const full = quality === 'high';

  return (
    // Keyed so switching tiers rebuilds the chain cleanly rather than trying
    // to reconcile a different set of passes.
    <EffectComposer key={quality} multisampling={0} enableNormalPass={full}>
      {full ? (
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={24}
          rings={5}
          // Tuned against this board's scale: a hex is one world unit, so the
          // occlusion radius wants to be a fraction of that to catch the
          // contact between a prop and the ground rather than smearing across
          // a whole tile.
          radius={0.09}
          intensity={26}
          luminanceInfluence={0.45}
          distanceScaling
          worldDistanceThreshold={6}
          worldDistanceFalloff={2}
          worldProximityThreshold={0.4}
          worldProximityFalloff={0.2}
          color={new THREE.Color('#0b1a12')}
        />
      ) : (
        <></>
      )}
      <Bloom
        // Only genuinely bright pixels bloom: sun glint and the token faces,
        // not every pale tile.
        luminanceThreshold={0.72}
        luminanceSmoothing={0.28}
        intensity={0.42}
        mipmapBlur
        radius={0.62}
      />
      <HueSaturation saturation={0.08} />
      <BrightnessContrast brightness={0.012} contrast={0.07} />
      <Vignette offset={0.28} darkness={0.42} eskil={false} />
      {full ? <SMAA /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

/**
 * Default export so this module — and the post-processing library it pulls
 * in, which is larger than the rest of the client put together — can be
 * split into its own chunk and fetched only when a player actually turns
 * effects on.
 */
export default Effects;

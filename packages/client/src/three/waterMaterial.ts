import * as THREE from 'three';

/**
 * The sea's shader material.
 *
 * Kept in its own module, deliberately named so it cannot collide with
 * `Water.tsx` when only letter case separates them: a case-insensitive
 * filesystem (macOS, Windows) would resolve `./Water.js` to whichever of the
 * two it happened to find, and the build would fail on a missing export.
 *
 *
 * A shader rather than a texture: the swell has to move, and the shoreline
 * needs foam that follows the island outline. Gerstner-ish sums displace the
 * surface, and the fragment stage mixes depth colour, a fresnel rim and a
 * specular glint so the water reads as water from a low camera angle.
 */
export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    // Toggled by `setWaterOutputColorSpace` to match how the frame is drawn.
    defines: { SRGB_OUTPUT: '' },
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#3f9fc4') },
      uDeep: { value: new THREE.Color('#0e3f63') },
      uFoam: { value: new THREE.Color('#dff1f7') },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      /** Distance from the board centre at which the shelf drops away. */
      uShoreRadius: { value: 4.6 },
      uFoamWidth: { value: 0.55 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vWave;

      // Three travelling swells at different angles and speeds; summing them
      // avoids the obvious repeat a single sine would give.
      float swell(vec2 p, vec2 dir, float freq, float speed, float t) {
        return sin(dot(p, dir) * freq + t * speed);
      }

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec2 p = world.xz;
        float t = uTime;
        float h =
            swell(p, normalize(vec2(1.0, 0.35)), 1.5, 0.9, t) * 0.055
          + swell(p, normalize(vec2(-0.4, 1.0)), 2.3, 1.35, t) * 0.032
          + swell(p, normalize(vec2(0.8, -0.7)), 4.1, 1.9, t) * 0.014;
        world.y += h;
        vWave = h;

        // Analytic-ish normal from finite differences of the same sum.
        float e = 0.12;
        float hx =
            swell(p + vec2(e, 0.0), normalize(vec2(1.0, 0.35)), 1.5, 0.9, t) * 0.055
          + swell(p + vec2(e, 0.0), normalize(vec2(-0.4, 1.0)), 2.3, 1.35, t) * 0.032;
        float hz =
            swell(p + vec2(0.0, e), normalize(vec2(1.0, 0.35)), 1.5, 0.9, t) * 0.055
          + swell(p + vec2(0.0, e), normalize(vec2(-0.4, 1.0)), 2.3, 1.35, t) * 0.032;
        vNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));

        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform vec3 uSunDirection;
      uniform float uShoreRadius;
      uniform float uFoamWidth;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vWave;

      void main() {
        float dist = length(vWorld.xz);

        // Shelf: shallow and bright near the island, deep further out.
        float depth = smoothstep(uShoreRadius, uShoreRadius + 3.2, dist);
        vec3 base = mix(uShallow, uDeep, depth);

        vec3 viewDir = normalize(cameraPosition - vWorld);
        vec3 n = normalize(vNormal);

        // Fresnel: the sea turns pale and reflective at grazing angles.
        float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
        base = mix(base, vec3(0.62, 0.80, 0.90), fresnel * 0.55);

        // Sun glint off the wave faces.
        vec3 halfway = normalize(uSunDirection + viewDir);
        float spec = pow(max(dot(n, halfway), 0.0), 90.0);
        base += vec3(1.0, 0.97, 0.88) * spec * 0.7;

        // Foam collar hugging the island, broken up by the swell so the line
        // breathes instead of sitting as a hard ring.
        float shore = 1.0 - smoothstep(uShoreRadius - uFoamWidth, uShoreRadius + 0.12, dist + vWave * 1.6);
        float lace = sin(dist * 22.0 - uTime * 2.4) * 0.5 + 0.5;
        float foam = clamp(shore * (0.55 + lace * 0.45), 0.0, 1.0);
        base = mix(base, uFoam, foam * 0.85);

        gl_FragColor = vec4(base, 0.94);

        // Built-in materials get this conversion injected by three, but a raw
        // ShaderMaterial has to do it itself — and only when it is drawing
        // straight to the canvas. With post-processing on, the scene renders
        // into a linear buffer and the composer's final pass converts, so
        // doing it here as well would apply it twice and wash the sea out.
        #ifdef SRGB_OUTPUT
          #include <colorspace_fragment>
        #endif
      }
    `,
  });
}


/**
 * Tells the water whether it is drawing straight to the canvas.
 *
 * Exactly one stage may convert linear colour to sRGB. Direct rendering makes
 * that the material's job; post-processing makes it the composer's.
 */
export function setWaterOutputColorSpace(material: THREE.ShaderMaterial, direct: boolean): void {
  const had = 'SRGB_OUTPUT' in material.defines;
  if (had === direct) return;
  if (direct) material.defines.SRGB_OUTPUT = '';
  else delete material.defines.SRGB_OUTPUT;
  material.needsUpdate = true;
}

import * as THREE from 'three';

/**
 * A procedural environment map.
 *
 * Physically based materials look plastic without something to reflect. Rather
 * than download an HDRI, this renders a sky gradient plus a warm sun disc into
 * a cube map and pre-filters it, which gives the pieces soft sky light from
 * above and warm bounce near the horizon at no download cost.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color('#5c9fd6') },
        uHorizon: { value: new THREE.Color('#dfe9ef') },
        uBottom: { value: new THREE.Color('#3b5a70') },
        uSun: { value: new THREE.Vector3(0.45, 0.72, 0.28).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        uniform vec3 uSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0
            ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.6))
            : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.5));
          // A soft sun, wide enough to give pieces a directional highlight.
          float sun = pow(max(dot(d, normalize(uSun)), 0.0), 220.0);
          float glow = pow(max(dot(d, normalize(uSun)), 0.0), 8.0);
          col += vec3(1.0, 0.92, 0.75) * (sun * 22.0 + glow * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  sky.geometry.dispose();
  (sky.material as THREE.Material).dispose();
  return target.texture;
}

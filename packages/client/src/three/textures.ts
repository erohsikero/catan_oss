import * as THREE from 'three';
import type { Terrain } from '@hexhaven/shared';
import { fbm, ridged, worley } from './noise.js';

/**
 * Every surface in the game is painted into a canvas at load time instead of
 * loading image files. That keeps the build asset-free and every texture
 * original work, and it lets each terrain carry a matching height field from
 * which a normal map is derived — which is what sells the relief under a
 * moving light far more than the albedo does.
 */

const SIZE = 512;

export interface TerrainMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

interface Painter {
  /** Surface height in [0, 1]; drives the normal map. */
  height(x: number, y: number): number;
  /** Albedo at a point, given its height. */
  color(x: number, y: number, h: number): RGB;
  /** Roughness in [0, 1]; low values read as damp or polished. */
  roughness(x: number, y: number, h: number): number;
  /** How pronounced the derived normals are. */
  bumpScale: number;
}

// --- per-terrain painters --------------------------------------------------

const PAINTERS: Record<Exclude<Terrain, 'sea'>, Painter> = {
  forest: {
    bumpScale: 1.9,
    height: (x, y) => fbm(x * 7, y * 7, { octaves: 5, seed: 11 }) * 0.7 + worley(x * 9, y * 9, 3) * 0.3,
    color: (x, y, h) => {
      const shade = fbm(x * 18, y * 18, { octaves: 3, seed: 21 });
      const base = mix([0.06, 0.16, 0.08], [0.21, 0.38, 0.16], h);
      // Patches of leaf litter break up the canopy.
      const litter = fbm(x * 4, y * 4, { octaves: 2, seed: 33 });
      return mix(base, [0.28, 0.22, 0.12], Math.max(0, litter - 0.62) * 1.6 * (1 - h) + shade * 0.08);
    },
    roughness: (_x, _y, h) => 0.82 + h * 0.12,
  },

  fields: {
    bumpScale: 1.3,
    height: (x, y) => {
      // Ploughed rows running across the tile, softened by noise.
      const rows = 0.5 + 0.5 * Math.sin((x * 46 + fbm(x * 3, y * 3, { seed: 5 }) * 2.2) * Math.PI);
      return rows * 0.45 + fbm(x * 8, y * 8, { octaves: 4, seed: 41 }) * 0.55;
    },
    color: (x, y, h) => {
      const golden = mix([0.42, 0.28, 0.07], [0.86, 0.70, 0.27], h);
      const ripe = fbm(x * 5, y * 5, { octaves: 3, seed: 52 });
      return mix(golden, [0.72, 0.52, 0.16], (ripe - 0.5) * 0.8);
    },
    roughness: () => 0.86,
  },

  pasture: {
    bumpScale: 1.4,
    height: (x, y) => fbm(x * 10, y * 10, { octaves: 5, seed: 61 }) * 0.75 + worley(x * 14, y * 14, 9) * 0.25,
    color: (x, y, h) => {
      const grass = mix([0.17, 0.33, 0.11], [0.45, 0.63, 0.24], h);
      // Cropped, sun-bleached patches where the flock grazes.
      const bleach = Math.max(0, fbm(x * 3.5, y * 3.5, { octaves: 2, seed: 72 }) - 0.58) * 1.8;
      return mix(grass, [0.57, 0.62, 0.31], bleach);
    },
    roughness: () => 0.88,
  },

  hills: {
    bumpScale: 2.1,
    height: (x, y) => {
      // Terraced clay pits: quantised height with cracks between the steps.
      const base = fbm(x * 5, y * 5, { octaves: 4, seed: 81 });
      const terraces = Math.floor(base * 5) / 5 + (base * 5 - Math.floor(base * 5)) * 0.25;
      const cracks = 1 - Math.pow(1 - worley(x * 11, y * 11, 17), 6);
      return terraces * 0.8 + cracks * 0.2;
    },
    color: (x, y, h) => {
      const clay = mix([0.28, 0.11, 0.06], [0.67, 0.34, 0.18], h);
      const wet = fbm(x * 9, y * 9, { octaves: 3, seed: 92 });
      return mix(clay, [0.44, 0.19, 0.10], (wet - 0.5) * 0.6);
    },
    roughness: (_x, _y, h) => 0.68 + h * 0.2,
  },

  mountains: {
    bumpScale: 2.6,
    height: (x, y) =>
      ridged(x * 6, y * 6, { octaves: 5, seed: 101 }) * 0.7 + fbm(x * 16, y * 16, { octaves: 3, seed: 111 }) * 0.3,
    color: (x, y, h) => {
      const rock = mix([0.11, 0.11, 0.12], [0.44, 0.43, 0.42], h);
      // Ore seams: thin warm veins following the ridges.
      const seam = Math.max(0, ridged(x * 13, y * 13, { octaves: 2, seed: 121 }) - 0.86) * 7;
      return mix(rock, [0.55, 0.42, 0.24], Math.min(1, seam));
    },
    roughness: (_x, _y, h) => 0.55 + h * 0.3,
  },

  desert: {
    bumpScale: 1.1,
    height: (x, y) => {
      // Wind ripples: a stretched sine warped by low-frequency noise.
      const dunes = fbm(x * 3, y * 3, { octaves: 3, seed: 131 });
      const ripples = 0.5 + 0.5 * Math.sin((y * 34 + dunes * 9) * Math.PI);
      return dunes * 0.7 + ripples * 0.3;
    },
    color: (x, y, h) => {
      const sand = mix([0.56, 0.44, 0.25], [0.88, 0.78, 0.56], h);
      const grit = fbm(x * 40, y * 40, { octaves: 2, seed: 141 });
      return mix(sand, [0.70, 0.59, 0.39], (grit - 0.5) * 0.4);
    },
    roughness: () => 0.92,
  },
};

// --- baking ----------------------------------------------------------------

function makeCanvas(size = SIZE): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas is unavailable; textures cannot be generated.');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a height field to a tangent-space normal map with a Sobel filter.
 * Sampling wraps, so the result tiles seamlessly alongside the albedo.
 */
function heightToNormal(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);
      // Longer z makes a flatter surface; strength shortens it.
      const nz = 1 / Math.max(0.05, strength);
      const len = Math.hypot(dx, dy, nz) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(canvas, false);
}

const cache = new Map<string, TerrainMaps>();

/** Bakes (and caches) the albedo, normal and roughness maps for one terrain. */
export function terrainMaps(terrain: Exclude<Terrain, 'sea'>): TerrainMaps {
  const hit = cache.get(terrain);
  if (hit) return hit;

  const painter = PAINTERS[terrain];
  const size = SIZE;
  const height = new Float32Array(size * size);
  const { canvas: albedo, ctx: albedoCtx } = makeCanvas(size);
  const { canvas: rough, ctx: roughCtx } = makeCanvas(size);
  const albedoImg = albedoCtx.createImageData(size, size);
  const roughImg = roughCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const h = Math.max(0, Math.min(1, painter.height(u, v)));
      height[y * size + x] = h;
      const [r, g, b] = painter.color(u, v, h);
      const i = (y * size + x) * 4;
      albedoImg.data[i] = Math.max(0, Math.min(255, r * 255));
      albedoImg.data[i + 1] = Math.max(0, Math.min(255, g * 255));
      albedoImg.data[i + 2] = Math.max(0, Math.min(255, b * 255));
      albedoImg.data[i + 3] = 255;
      const rg = Math.max(0, Math.min(255, painter.roughness(u, v, h) * 255));
      roughImg.data[i] = rg;
      roughImg.data[i + 1] = rg;
      roughImg.data[i + 2] = rg;
      roughImg.data[i + 3] = 255;
    }
  }
  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const maps: TerrainMaps = {
    map: finish(albedo, true),
    normalMap: heightToNormal(height, size, painter.bumpScale),
    roughnessMap: finish(rough, false),
  };
  cache.set(terrain, maps);
  return maps;
}

/** The soil-and-rock band around the side of every tile. */
export function tileSideTexture(): THREE.CanvasTexture {
  const key = '__side';
  const hit = cache.get(key);
  if (hit) return hit.map as THREE.CanvasTexture;

  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Horizontal strata, as though the island were cut out of bedrock.
      const strata = fbm(u * 4, v * 22, { octaves: 4, seed: 201 });
      const grit = fbm(u * 60, v * 60, { octaves: 2, seed: 211 });
      const shade = strata * 0.75 + grit * 0.25;
      const c = mix([0.22, 0.16, 0.11], [0.55, 0.44, 0.32], shade);
      // Darken towards the bottom so tiles feel seated in the sea.
      const depth = 1 - Math.pow(v, 1.5) * 0.55;
      const i = (y * size + x) * 4;
      img.data[i] = c[0] * depth * 255;
      img.data[i + 1] = c[1] * depth * 255;
      img.data[i + 2] = c[2] * depth * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(canvas, true);
  tex.repeat.set(3, 1);
  cache.set(key, { map: tex, normalMap: tex, roughnessMap: tex });
  return tex;
}

/**
 * A number token face: pale stone disc, the numeral, and the pip row whose
 * length tells you how likely the roll is at a glance.
 */
export function numberTokenTexture(value: number, pips: number): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  const hot = value === 6 || value === 8;

  // Stone disc with a soft inner shadow.
  const grad = ctx.createRadialGradient(size * 0.42, size * 0.38, size * 0.05, size * 0.5, size * 0.5, size * 0.52);
  grad.addColorStop(0, '#fbf3df');
  grad.addColorStop(0.7, '#efe2c4');
  grad.addColorStop(1, '#cdbb97');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(90, 70, 40, 0.55)';
  ctx.lineWidth = size * 0.028;
  ctx.stroke();

  // Speckle, so the disc reads as cast stone rather than plastic.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * size * 0.46;
    ctx.fillStyle = `rgba(120, 100, 70, ${Math.random() * 0.1})`;
    ctx.fillRect(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 2, 2);
  }

  ctx.fillStyle = hot ? '#a8201a' : '#2e2519';
  ctx.font = `700 ${size * 0.46}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), size / 2, size * 0.44);

  const pipRadius = size * 0.018;
  const gap = pipRadius * 3.1;
  const startX = size / 2 - (gap * (pips - 1)) / 2;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, size * 0.74, pipRadius, 0, Math.PI * 2);
    ctx.fillStyle = hot ? '#a8201a' : '#2e2519';
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The board on a harbour pier: the exchange rate, and what it trades. */
export function harborSignTexture(resource: string | null, ratio: number): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Weathered plank.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#c49a62');
  grad.addColorStop(1, '#8c6539');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(60, 38, 18, 0.65)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(80, 52, 24, ${Math.random() * 0.14})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.7, y - 6, w, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#2b1a0c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 62px Georgia, serif';
  ctx.fillText(`${ratio}:1`, w / 2, resource ? h * 0.36 : h * 0.5);
  if (resource) {
    ctx.font = '600 34px Georgia, serif';
    ctx.fillText(resource.toUpperCase(), w / 2, h * 0.72);
  } else {
    ctx.font = '600 26px Georgia, serif';
    ctx.fillText('ANY', w / 2, h * 0.78);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

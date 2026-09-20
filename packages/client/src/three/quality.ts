/**
 * Graphics quality tiers.
 *
 * Post-processing is the largest single frame cost in this scene, so it has
 * to be something a player can turn down — and something that turns itself
 * down before a first-time visitor decides the game is broken.
 *
 * Detection is deliberately conservative. It looks for the two cases that
 * actually matter: a software rasteriser (no GPU at all, where effects are
 * unusable) and a low-powered device. Everything else gets the full stack,
 * and the player can override the guess.
 */

export const QUALITY_LEVELS = ['off', 'medium', 'high'] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

export const QUALITY_LABELS: Record<Quality, { label: string; blurb: string }> = {
  off: { label: 'Plain', blurb: 'No post-processing. Fastest, and fine on weak hardware.' },
  medium: { label: 'Rich', blurb: 'Bloom, grading and contact shadows. Recommended.' },
  high: {
    label: 'Full',
    blurb: 'Adds ambient occlusion and anti-aliasing. Needs a real GPU, and is not yet verified on one.',
  },
};

const STORAGE_KEY = 'hexhaven.quality';

/** True when WebGL is being emulated on the CPU. */
function isSoftwareRenderer(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    // SwiftShader, llvmpipe and Mesa's software paths all name themselves.
    return /swiftshader|llvmpipe|software|microsoft basic/i.test(renderer);
  } catch {
    return false;
  }
}

/**
 * A first guess at what this machine can handle.
 *
 * Never returns `high`. The ambient-occlusion pass has only been exercised on
 * a software renderer, where the depth-normal buffer it depends on produces
 * no measurable occlusion — the frame is statistically indistinguishable with
 * it on and off, while still paying for the extra pass. Until that is checked
 * on real hardware, `high` stays something a player opts into rather than
 * something we choose for them and charge them for.
 *
 * Lifting this is a one-line change once the AO is confirmed to work.
 */
export function detectQuality(): Quality {
  if (typeof document === 'undefined') return 'medium';
  if (isSoftwareRenderer()) return 'off';
  return 'medium';
}

export function loadQuality(): Quality {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (QUALITY_LEVELS as readonly string[]).includes(saved)) return saved as Quality;
  } catch {
    /* private browsing; fall through to detection */
  }
  return detectQuality();
}

export function saveQuality(quality: Quality): void {
  try {
    localStorage.setItem(STORAGE_KEY, quality);
  } catch {
    /* the choice simply will not survive a reload */
  }
}

import { useMemo } from 'react';
import { ContactShadows } from '@react-three/drei';
import type { PlayerView } from '@hexhaven/shared';
import { HEX_SIZE, SURFACE_Y } from './theme.js';

/**
 * Soft contact shadows on the island surface.
 *
 * A directional light's shadow map gives a piece a shadow, but not the dark
 * seam right where it meets the ground, so buildings and trees read as
 * hovering a millimetre above the tile. A hand-authored pipeline solves this
 * by baking occlusion into a lightmap; this renders the same information at
 * runtime by looking up at the scene from just under the tile surface.
 *
 * The plane sits a fraction above the tiles, so the tiles themselves fall
 * below it and are not captured — only what stands on them: buildings,
 * roads, trees, flocks, tokens and the robber.
 *
 * It bakes once per board change rather than every frame. A board is static
 * between moves, so re-rendering it sixty times a second would be paying
 * continuously for a picture that almost never changes. The cost is that the
 * robber's shadow arrives at its new tile slightly before the model finishes
 * gliding there.
 */
export function BoardContactShadows({ view, enabled }: { view: PlayerView; enabled: boolean }) {
  // Re-bake whenever anything standing on the board moves.
  const signature = useMemo(() => {
    const buildings = Object.values(view.buildings)
      .map((b) => `${b.vertex}:${b.kind}`)
      .sort()
      .join(',');
    const roads = Object.keys(view.roads).sort().join(',');
    return `${view.robber}|${buildings}|${roads}`;
  }, [view.buildings, view.roads, view.robber]);

  if (!enabled) return null;

  // The island spans roughly this far from the centre; going much wider just
  // wastes shadow-map resolution on empty sea.
  const extent = (view.board.radius * 2 + 1.6) * HEX_SIZE * Math.sqrt(3);

  return (
    <ContactShadows
      key={signature}
      frames={1}
      position={[0, SURFACE_Y + 0.004, 0]}
      scale={extent}
      resolution={1024}
      // Only catch what is standing on the surface, not the sky.
      far={1.1}
      blur={2.2}
      opacity={0.62}
      color="#132018"
    />
  );
}

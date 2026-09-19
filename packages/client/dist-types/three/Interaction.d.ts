import { type PlayerColor } from '@hexhaven/shared';
/**
 * Placement targets.
 *
 * Only legal targets are ever drawn, which doubles as the rules explaining
 * themselves: if a corner does not light up, it cannot be built on. Markers
 * pulse so they stay findable against busy terrain, and a hovered marker
 * previews the piece in the player's own colour.
 */
export type PickKind = 'vertex' | 'edge' | 'hex';
interface Props {
    kind: PickKind | null;
    targets: readonly string[];
    color: PlayerColor;
    onPick: (id: string) => void;
}
export declare function PlacementTargets({ kind, targets, color, onPick }: Props): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=Interaction.d.ts.map
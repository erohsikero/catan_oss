import type { PlayerColor, PlayerView } from '@hexhaven/shared';
import { type PickKind } from './Interaction.js';
export interface SceneProps {
    view: PlayerView;
    colorOf: (playerId: string) => PlayerColor;
    myColor: PlayerColor;
    pickKind: PickKind | null;
    pickTargets: readonly string[];
    onPick: (id: string) => void;
}
export declare function Scene(props: SceneProps): import("react").JSX.Element;
//# sourceMappingURL=Scene.d.ts.map
import { Component, type ErrorInfo, type ReactNode } from 'react';
interface Props {
    children: ReactNode;
    /** Shown in place of the children when they throw. */
    fallback: ReactNode;
    label: string;
}
interface State {
    error: Error | null;
}
/**
 * Keeps a rendering fault contained.
 *
 * The 3D scene is the most fragile part of the client — a driver quirk or an
 * unsupported WebGL feature can throw during a render. Without a boundary,
 * React unmounts the whole tree and the player is left staring at a blank
 * page mid-game. Here the game keeps running: the HUD still works, the
 * websocket stays open, and the board area explains what happened.
 */
export declare class ErrorBoundary extends Component<Props, State> {
    state: State;
    static getDerivedStateFromError(error: Error): State;
    componentDidCatch(error: Error, info: ErrorInfo): void;
    render(): ReactNode;
}
/** Shown when the board itself cannot be drawn. */
export declare function SceneFallback(): import("react").JSX.Element;
export {};
//# sourceMappingURL=ErrorBoundary.d.ts.map
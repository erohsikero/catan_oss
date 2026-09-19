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
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

/** Shown when the board itself cannot be drawn. */
export function SceneFallback() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
        background: 'linear-gradient(180deg, #14283a, #081521)',
      }}
    >
      <div>
        <h2 className="title" style={{ color: 'var(--brass)' }}>
          The board could not be drawn
        </h2>
        <p className="muted" style={{ maxWidth: 420 }}>
          Your browser could not start WebGL, or the graphics driver refused a feature the board needs. The game
          itself is still running — the panels around the edge remain live, and reloading the page will rejoin your
          seat.
        </p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

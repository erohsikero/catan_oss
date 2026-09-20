import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, DevCard, PlayerColor, Resource, ResourceBag } from '@hexhaven/shared';
import { Scene } from '../three/Scene.js';
import type { PickKind } from '../three/Interaction.js';
import { loadQuality, saveQuality, type Quality } from '../three/quality.js';
import { cityTargets, roadTargets, robberTargets, settlementTargets, setupRoadTargets } from '../game/legal.js';
import type { Connection } from '../net/useConnection.js';
import { ActionBar, Hand } from './Dock.js';
import { ErrorBoundary, SceneFallback } from './ErrorBoundary.js';
import { Dice, LogPanel, PlayerPanels, QualityPicker, TurnBanner, TurnTimer } from './Hud.js';
import {
  DiscardDialog,
  MonopolyDialog,
  StealDialog,
  TradeDialog,
  TradeOffers,
  VictoryDialog,
  YearOfPlentyDialog,
} from './Dialogs.js';

/** What the player is currently being asked to click on the board. */
type BuildMode = 'road' | 'settlement' | 'city' | null;

export function GameScreen({ conn }: { conn: Connection }) {
  const { view, playerId, act } = conn;
  const [mode, setMode] = useState<BuildMode>(null);
  const [dialog, setDialog] = useState<'trade' | 'year_of_plenty' | 'monopoly' | null>(null);
  // Detected once on mount, then remembered; the player can override it.
  const [quality, setQuality] = useState<Quality>(loadQuality);

  const changeQuality = useCallback((next: Quality) => {
    setQuality(next);
    saveQuality(next);
  }, []);

  const pendingKind = view?.pending.kind;
  // Any change in what the game is waiting for invalidates a half-made choice.
  useEffect(() => {
    setMode(null);
  }, [pendingKind, view?.turn]);

  const colorOf = useCallback(
    (id: string): PlayerColor => view?.players.find((p) => p.id === id)?.color ?? 'white',
    [view],
  );

  const me = view?.players.find((p) => p.id === playerId);
  const current = view?.players.find((p) => p.seat === view.currentPlayer);
  const isMyTurn = Boolean(view && current && current.id === playerId);

  /**
   * Board targets come from two places: steps the rules force on you (opening
   * placement, moving the robber) which arm themselves, and builds you chose
   * from the action bar.
   */
  const { pickKind, pickTargets } = useMemo((): { pickKind: PickKind | null; pickTargets: string[] } => {
    if (!view || !playerId) return { pickKind: null, pickTargets: [] };
    const pending = view.pending;

    if (isMyTurn) {
      if (pending.kind === 'setup') {
        return pending.step === 'settlement'
          ? { pickKind: 'vertex', pickTargets: settlementTargets(view, playerId, true) }
          : {
              pickKind: 'edge',
              pickTargets: pending.lastVertex ? setupRoadTargets(view, pending.lastVertex) : [],
            };
      }
      if (pending.kind === 'move_robber') return { pickKind: 'hex', pickTargets: robberTargets(view) };
      if (pending.kind === 'build_roads') return { pickKind: 'edge', pickTargets: roadTargets(view, playerId) };
    }

    if (!isMyTurn || pending.kind !== 'main') return { pickKind: null, pickTargets: [] };
    switch (mode) {
      case 'road':
        return { pickKind: 'edge', pickTargets: roadTargets(view, playerId) };
      case 'settlement':
        return { pickKind: 'vertex', pickTargets: settlementTargets(view, playerId, false) };
      case 'city':
        return { pickKind: 'vertex', pickTargets: cityTargets(view) };
      default:
        return { pickKind: null, pickTargets: [] };
    }
  }, [view, playerId, isMyTurn, mode]);

  /**
   * Guards against a second click landing before the server's reply.
   *
   * Placement markers are large and a click is easy to repeat; without this
   * the same board state produces two actions, and the second is rejected
   * against a step that has already moved on.
   *
   * Two earlier attempts were both wrong. Allowing one action per state
   * *version* wedged the board, because a rejected action does not advance
   * the version — the server refuses it and changes nothing — so a single
   * rejection blocked every later click. A fixed time window cannot wedge,
   * but it throttles: a player clicking two different corners quickly loses
   * the second, legitimate click.
   *
   * What actually matters is whether an action is still unanswered. This
   * blocks only while one is in flight, and the server answering — with a
   * new state or with a rejection — releases it immediately. The timer is a
   * backstop for an answer that never arrives at all.
   */
  const inFlight = useRef(false);
  const releaseTimer = useRef<number | undefined>(undefined);

  const release = useCallback(() => {
    inFlight.current = false;
    if (releaseTimer.current !== undefined) {
      window.clearTimeout(releaseTimer.current);
      releaseTimer.current = undefined;
    }
  }, []);

  // Any answer from the server releases the guard.
  useEffect(release, [release, view?.version, conn.error]);
  useEffect(() => release, [release]);

  const onPick = useCallback(
    (id: string) => {
      if (!view) return;
      if (inFlight.current) return;
      inFlight.current = true;
      // If the server never answers, do not leave the board unclickable.
      releaseTimer.current = window.setTimeout(release, 4000);
      const pending = view.pending;
      if (pending.kind === 'setup') {
        act(
          pending.step === 'settlement'
            ? { type: 'place_setup_settlement', vertex: id }
            : { type: 'place_setup_road', edge: id },
        );
        return;
      }
      if (pending.kind === 'move_robber') {
        // Let the server work out who can be robbed; it replies with a steal
        // step when the tile touches more than one opponent.
        act({ type: 'move_robber', hex: id });
        return;
      }
      if (pending.kind === 'build_roads') {
        act({ type: 'build_road', edge: id });
        return;
      }
      switch (mode) {
        case 'road':
          act({ type: 'build_road', edge: id });
          break;
        case 'settlement':
          act({ type: 'build_settlement', vertex: id });
          break;
        case 'city':
          act({ type: 'build_city', vertex: id });
          break;
      }
      setMode(null);
    },
    [view, act, mode, release],
  );

  const onPlayDev = useCallback(
    (card: DevCard) => {
      switch (card) {
        case 'knight':
          act({ type: 'play_knight' });
          break;
        case 'road_building':
          act({ type: 'play_road_building' });
          break;
        case 'year_of_plenty':
          setDialog('year_of_plenty');
          break;
        case 'monopoly':
          setDialog('monopoly');
          break;
        case 'victory_point':
          break;
      }
    },
    [act],
  );

  if (!view || !playerId) {
    return (
      <div className="shell">
        <div className="panel card" style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
          <div className="spinner" />
          <span className="muted">Loading the island&hellip;</span>
        </div>
      </div>
    );
  }

  const myColor = me?.color ?? 'white';
  const discardOwed = view.pending.kind === 'discard' ? view.pending.owed[playerId] : undefined;
  const stealing = view.pending.kind === 'steal' && isMyTurn ? view.pending.candidates : null;
  const canPlayDev =
    isMyTurn &&
    !view.you?.playedDevCardThisTurn &&
    (view.pending.kind === 'main' || view.pending.kind === 'roll');
  const showOffers = view.trades.some((t) => t.from === playerId || t.responses[playerId] !== undefined);

  return (
    <div className="game">
      <div className="canvas-wrap">
        <ErrorBoundary label="board" fallback={<SceneFallback />}>
          <Scene
            view={view}
            colorOf={colorOf}
            myColor={myColor}
            pickKind={pickKind}
            pickTargets={pickTargets}
            onPick={onPick}
            quality={quality}
          />
        </ErrorBoundary>
      </div>

      <div className="hud">
        <div className="hud-top">
          <PlayerPanels view={view} playerId={playerId} />
          <div className="turn-box">
            <TurnBanner view={view} playerId={playerId} />
            <TurnTimer view={view} playerId={playerId} />
            <Dice dice={view.dice} />
            <QualityPicker quality={quality} onChange={changeQuality} />
          </div>
        </div>

        <div className="hud-mid">
          <LogPanel view={view} chat={conn.chat} onSend={(text) => conn.send({ t: 'chat', text })} />
        </div>

        <div className="hud-bottom">
          <div className="dock">
            <Hand view={view} onPlayDev={onPlayDev} canPlayDev={canPlayDev} />
            <ActionBar
              view={view}
              isMyTurn={isMyTurn}
              mode={mode}
              onRoll={() => act({ type: 'roll_dice' })}
              onBuild={(what) => setMode(what)}
              onBuyDev={() => act({ type: 'buy_dev_card' })}
              onTrade={() => setDialog('trade')}
              onEndTurn={() => act({ type: 'end_turn' })}
              onCancel={() => setMode(null)}
            />
          </div>
        </div>
      </div>

      {discardOwed !== undefined && (
        <DiscardDialog
          view={view}
          owed={discardOwed}
          onSubmit={(resources: Partial<ResourceBag>) => act({ type: 'discard', resources })}
        />
      )}

      {stealing && (
        <StealDialog view={view} candidates={stealing} onPick={(victim) => act({ type: 'steal', victim })} />
      )}

      {dialog === 'trade' && <TradeDialog view={view} onAct={act} onClose={() => setDialog(null)} />}

      {dialog === 'year_of_plenty' && (
        <YearOfPlentyDialog
          view={view}
          onCancel={() => setDialog(null)}
          onSubmit={(resources: Resource[]) => {
            act({ type: 'play_year_of_plenty', resources });
            setDialog(null);
          }}
        />
      )}

      {dialog === 'monopoly' && (
        <MonopolyDialog
          onCancel={() => setDialog(null)}
          onSubmit={(resource: Resource) => {
            act({ type: 'play_monopoly', resource });
            setDialog(null);
          }}
        />
      )}

      {showOffers && dialog !== 'trade' && (
        <TradeOffers view={view} playerId={playerId} onAct={act as (a: Action) => void} />
      )}

      {view.phase === 'ended' && <VictoryDialog view={view} onLeave={() => conn.send({ t: 'leave_room' })} />}
    </div>
  );
}

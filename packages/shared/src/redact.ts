import { publicVictoryPoints, totalVictoryPoints } from './engine.js';
import type { OpponentView, PlayerView } from './protocol.js';
import type { GameState, LogEntry, PlayerState } from './state.js';
import { bagTotal, devTotal, type PlayerId } from './types.js';

function toOpponentView(p: PlayerState, revealAll: boolean): OpponentView {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isBot: p.isBot,
    connected: p.connected,
    seat: p.seat,
    resourceCount: bagTotal(p.resources),
    devCardCount: devTotal(p.devCards) + devTotal(p.pendingDevCards),
    playedDevCards: { ...p.playedDevCards },
    playedKnights: p.playedKnights,
    roads: [...p.roads],
    settlements: [...p.settlements],
    cities: [...p.cities],
    piecesLeft: { ...p.piecesLeft },
    harborRatios: { ...p.harborRatios },
    hasGenericHarbor: p.hasGenericHarbor,
    longestRoadLength: p.longestRoadLength,
    hasLongestRoad: p.hasLongestRoad,
    hasLargestArmy: p.hasLargestArmy,
    publicVictoryPoints: revealAll ? totalVictoryPoints(p) : publicVictoryPoints(p),
  };
}

/**
 * Strips a log entry of anything the viewer should not see.
 *
 * Entries flagged `private` carry hidden information — which card was bought,
 * which resource a robber took. The two players involved get the detail; for
 * everyone else the `data` payload is dropped and only the public sentence
 * survives.
 */
function redactLog(entries: readonly LogEntry[], viewerId: PlayerId | null): LogEntry[] {
  return entries.map((e) => {
    if (!e.data?.private) return e;
    const involved = viewerId !== null && (e.player === viewerId || e.data.victim === viewerId);
    if (involved) return e;
    const { data, ...rest } = e;
    return rest;
  });
}

/**
 * Builds the view sent to one player.
 *
 * Only the viewer's own hand and development cards are included; everyone else
 * is reduced to counts. The deck order and the RNG state never leave the
 * server, so a client cannot see what it is about to draw.
 */
export function viewFor(state: GameState, viewerId: PlayerId | null): PlayerView {
  const { players, devDeck, rng, log, ...rest } = state;
  const revealAll = state.phase === 'ended';
  const you = viewerId ? (players.find((p) => p.id === viewerId) ?? null) : null;
  return {
    ...rest,
    log: redactLog(log, viewerId),
    you: you
      ? {
          ...you,
          resources: { ...you.resources },
          devCards: { ...you.devCards },
          pendingDevCards: { ...you.pendingDevCards },
          playedDevCards: { ...you.playedDevCards },
          roads: [...you.roads],
          settlements: [...you.settlements],
          cities: [...you.cities],
          piecesLeft: { ...you.piecesLeft },
          harborRatios: { ...you.harborRatios },
        }
      : null,
    players: players.map((p) => toOpponentView(p, revealAll)),
    devDeckSize: devDeck.length,
    yourVictoryPoints: you ? totalVictoryPoints(you) : 0,
  };
}

/** A spectator view: no private information at all. */
export function spectatorView(state: GameState): PlayerView {
  return viewFor(state, null);
}

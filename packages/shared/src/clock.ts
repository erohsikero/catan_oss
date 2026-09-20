import type { Action, GameSettings } from './protocol.js';
import type { GameState, Pending, PlayerState } from './state.js';
import { bagTotal, RESOURCES, type PlayerId, type Resource, type ResourceBag } from './types.js';

/**
 * The turn clock.
 *
 * Every step a player can be waiting on has its own budget, because they are
 * not comparable: rolling is a reflex, deciding what to build is not, and
 * being asked to discard is an interruption you did not plan for.
 *
 * Two rules keep the clock from feeling punitive, both taken from how the
 * commercial implementations behave:
 *
 *   - Accepting a trade grants extra time on the current turn. A trade
 *     changes what you can afford, so the plan you had is no longer the plan
 *     you have, and the clock should not punish you for that.
 *   - Each player holds a personal reserve. When a step runs out, the reserve
 *     is spent to extend it rather than forcing the move immediately, so one
 *     genuinely hard decision does not cost you your turn.
 *
 * When the reserve is gone the server plays a deliberately minimal move for
 * you — roll, or end the turn — never a speculative build.
 */

export type ClockReason = 'setup' | 'roll' | 'main' | 'discard' | 'robber' | 'steal' | 'build_roads';

export interface TurnClock {
  /** Epoch milliseconds at which the current step expires. */
  deadline: number;
  /** Who the clock is running against. A discard can block several players. */
  players: PlayerId[];
  reason: ClockReason;
  /** The full budget for this step, so the client can draw a progress arc. */
  durationMs: number;
}

export interface ClockSettings {
  /** Master switch. Off means no deadlines at all, for a relaxed table. */
  enabled: boolean;
  /** Placing an opening settlement or road. */
  setupSeconds: number;
  /** Rolling the dice at the start of your turn. */
  rollSeconds: number;
  /** Building, trading and everything else on your own turn. */
  mainSeconds: number;
  /** Discarding after a seven. Runs for every player who owes cards. */
  discardSeconds: number;
  /** Moving the robber, and choosing who to rob. */
  robberSeconds: number;
  /** Added to the current step when a trade completes. */
  tradeGraceSeconds: number;
  /** Personal reserve, spent automatically when a step expires. */
  reserveSeconds: number;
  /** How much reserve one extension spends. */
  reserveChunkSeconds: number;
}

/**
 * Defaults are generous on purpose. A clock exists to stop a table stalling
 * on someone who walked away, not to rush people who are still thinking.
 */
export const DEFAULT_CLOCK: ClockSettings = {
  enabled: true,
  setupSeconds: 60,
  rollSeconds: 30,
  mainSeconds: 120,
  discardSeconds: 45,
  robberSeconds: 45,
  tradeGraceSeconds: 30,
  reserveSeconds: 180,
  reserveChunkSeconds: 20,
};

/** No clock at all; every deadline check becomes a no-op. */
export const NO_CLOCK: ClockSettings = { ...DEFAULT_CLOCK, enabled: false };

function budgetFor(pending: Pending, clock: ClockSettings): { reason: ClockReason; seconds: number } | null {
  switch (pending.kind) {
    case 'setup':
      return { reason: 'setup', seconds: clock.setupSeconds };
    case 'roll':
      return { reason: 'roll', seconds: clock.rollSeconds };
    case 'main':
      return { reason: 'main', seconds: clock.mainSeconds };
    case 'build_roads':
      return { reason: 'build_roads', seconds: clock.mainSeconds };
    case 'discard':
      return { reason: 'discard', seconds: clock.discardSeconds };
    case 'move_robber':
      return { reason: 'robber', seconds: clock.robberSeconds };
    case 'steal':
      return { reason: 'steal', seconds: clock.robberSeconds };
    case 'lobby':
    case 'ended':
      return null;
  }
}

/** Which players the game is currently waiting on. */
export function waitingOn(state: GameState): PlayerId[] {
  const pending = state.pending;
  if (pending.kind === 'discard') return Object.keys(pending.owed);
  if (pending.kind === 'lobby' || pending.kind === 'ended') return [];
  const current = state.players[state.currentPlayer];
  return current ? [current.id] : [];
}

/**
 * The clock for the state as it now stands, or null when nothing is timed.
 *
 * `now` is passed in rather than read from the system clock so that games
 * stay reproducible in tests and replays.
 */
export function clockFor(state: GameState, clock: ClockSettings, now: number): TurnClock | null {
  if (!clock.enabled) return null;
  const budget = budgetFor(state.pending, clock);
  if (!budget) return null;
  const players = waitingOn(state);
  if (players.length === 0) return null;
  const durationMs = Math.max(1, budget.seconds) * 1000;
  return { deadline: now + durationMs, players, reason: budget.reason, durationMs };
}

/** True when the same step is still running and only the deadline would move. */
export function sameStep(a: TurnClock | null, b: TurnClock | null): boolean {
  if (!a || !b) return false;
  return a.reason === b.reason && a.players.length === b.players.length && a.players.every((p, i) => p === b.players[i]);
}

// ---------------------------------------------------------------------------
// Forced moves
// ---------------------------------------------------------------------------

/** Discards the largest stacks first — the same rule the bots use. */
function forcedDiscard(player: PlayerState, count: number): Partial<ResourceBag> {
  const out: Partial<ResourceBag> = {};
  const remaining: Record<Resource, number> = { ...player.resources };
  for (let i = 0; i < count; i++) {
    let pick: Resource | null = null;
    for (const r of RESOURCES) {
      if (remaining[r] <= 0) continue;
      if (pick === null || remaining[r] > remaining[pick]) pick = r;
    }
    if (!pick) break;
    remaining[pick] -= 1;
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

/**
 * What the server plays when a player's time runs out.
 *
 * Deliberately conservative: it resolves the step and nothing more. Where the
 * rules force a choice (a discard, moving the robber, opening placement) it
 * makes one, because the game cannot continue otherwise. Where they do not —
 * the main phase — it simply ends the turn rather than spending the player's
 * resources on a build they did not ask for.
 *
 * `pickPlacement` supplies a legal choice for the steps that need one; the
 * server passes the bot policy, which already knows how to find one.
 */
export function forcedAction(
  state: GameState,
  playerId: PlayerId,
  pickPlacement: (state: GameState, playerId: PlayerId) => Action | null,
): Action | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;
  const pending = state.pending;

  switch (pending.kind) {
    case 'discard': {
      const owed = pending.owed[playerId];
      if (owed === undefined) return null;
      return { type: 'discard', resources: forcedDiscard(player, owed) };
    }
    case 'roll':
      return { type: 'roll_dice' };
    case 'main':
    case 'build_roads':
      // Never build on someone's behalf; just pass the turn on.
      return { type: 'end_turn' };
    case 'setup':
    case 'move_robber':
    case 'steal':
      // These cannot be skipped, so fall back to a legal choice.
      return pickPlacement(state, playerId);
    case 'lobby':
    case 'ended':
      return null;
  }
}

/** Total cards held, used by the UI to explain a pending discard. */
export function heldCards(player: PlayerState): number {
  return bagTotal(player.resources);
}

/** Merges a partial clock configuration onto the defaults. */
export function resolveClock(settings: Pick<GameSettings, 'clock'>): ClockSettings {
  return { ...DEFAULT_CLOCK, ...(settings.clock ?? {}) };
}

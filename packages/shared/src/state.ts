import type { EdgeId, HexId, VertexId } from './hex.js';
import type { RngState } from './rng.js';
import type {
  Board,
  Building,
  DevCard,
  DevCardCounts,
  PlayerColor,
  PlayerId,
  Resource,
  ResourceBag,
  Road,
} from './types.js';

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  isBot: boolean;
  connected: boolean;
  /** Seat order, 0-based. */
  seat: number;

  resources: ResourceBag;
  /** Development cards that may be played this turn. */
  devCards: DevCardCounts;
  /** Bought this turn; they move into `devCards` when the turn ends. */
  pendingDevCards: DevCardCounts;
  /**
   * Development cards this player has played. Played cards are face up in the
   * real game, so this is public information and is sent to every client.
   */
  playedDevCards: DevCardCounts;
  /** Mirrors `playedDevCards.knight`; kept separate because Largest Army reads it constantly. */
  playedKnights: number;
  /** Set once per turn: a player may only play one development card per turn. */
  playedDevCardThisTurn: boolean;

  roads: EdgeId[];
  settlements: VertexId[];
  cities: VertexId[];
  piecesLeft: { road: number; settlement: number; city: number };

  /** Harbour ratios unlocked by this player's buildings. */
  harborRatios: Partial<Record<Resource, number>>;
  hasGenericHarbor: boolean;

  longestRoadLength: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
}

export type TradeResponse = 'pending' | 'accept' | 'reject';

export interface TradeOffer {
  id: string;
  from: PlayerId;
  give: Partial<ResourceBag>;
  want: Partial<ResourceBag>;
  /** Null means the offer is open to everyone. */
  to: PlayerId[] | null;
  responses: Record<PlayerId, TradeResponse>;
}

/**
 * What the game is waiting for. Every action is validated against this, so an
 * out-of-order or duplicated client message can never mutate the game.
 */
export type Pending =
  | { kind: 'lobby' }
  /** Setup placement; `step` alternates settlement then road. */
  | { kind: 'setup'; round: 1 | 2; step: 'settlement' | 'road'; lastVertex: VertexId | null }
  | { kind: 'roll' }
  /** A 7 was rolled; these players still owe a discard. */
  | { kind: 'discard'; owed: Record<PlayerId, number> }
  /**
   * A knight may be played before rolling, so the robber steps remember which
   * phase to hand control back to once the robber has moved.
   */
  | { kind: 'move_robber'; reason: 'dice' | 'knight'; resume: 'roll' | 'main' }
  | { kind: 'steal'; candidates: PlayerId[]; resume: 'roll' | 'main' }
  | { kind: 'main' }
  /** Road Building card: place up to `roadsLeft` free roads. */
  | { kind: 'build_roads'; roadsLeft: number }
  | { kind: 'ended'; winner: PlayerId };

export interface LogEntry {
  id: number;
  turn: number;
  /** Machine-readable so the client can render it with icons rather than text. */
  type: string;
  player?: PlayerId;
  text: string;
  data?: Record<string, unknown>;
}

export interface GameState {
  id: string;
  board: Board;
  players: PlayerState[];
  /** Seat index of the player whose turn it is. */
  currentPlayer: number;
  turn: number;
  phase: 'lobby' | 'setup' | 'play' | 'ended';
  pending: Pending;

  dice: [number, number] | null;
  robber: HexId;

  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Road>;

  /** Remaining development cards, in draw order. */
  devDeck: DevCard[];
  bank: ResourceBag;

  trades: TradeOffer[];
  log: LogEntry[];
  nextLogId: number;

  largestArmyHolder: PlayerId | null;
  longestRoadHolder: PlayerId | null;

  /** Setup walks seats forward then backward; this indexes into that order. */
  setupOrder: number[];
  setupIndex: number;

  rng: RngState;
  seed: number;
  winner: PlayerId | null;
  createdAt: number;
  /** Bumped on every applied action so clients can detect dropped updates. */
  version: number;
}

export function playerById(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayer];
}

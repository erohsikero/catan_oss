import type { EdgeId, HexId, VertexId } from './hex.js';
import type { BoardOptions } from './board.js';
import type { GameState } from './state.js';
import type { DevCardCounts, PlayerColor, PlayerId, Resource, ResourceBag } from './types.js';

/** Everything a player may ask the game to do. Validated server-side. */
export type Action =
  | { type: 'place_setup_settlement'; vertex: VertexId }
  | { type: 'place_setup_road'; edge: EdgeId }
  | { type: 'roll_dice' }
  | { type: 'discard'; resources: Partial<ResourceBag> }
  | { type: 'move_robber'; hex: HexId; victim?: PlayerId | null }
  | { type: 'steal'; victim: PlayerId }
  | { type: 'build_road'; edge: EdgeId }
  | { type: 'build_settlement'; vertex: VertexId }
  | { type: 'build_city'; vertex: VertexId }
  | { type: 'buy_dev_card' }
  | { type: 'play_knight' }
  | { type: 'play_road_building' }
  | { type: 'play_year_of_plenty'; resources: Resource[] }
  | { type: 'play_monopoly'; resource: Resource }
  | { type: 'bank_trade'; give: Resource; want: Resource }
  | { type: 'offer_trade'; give: Partial<ResourceBag>; want: Partial<ResourceBag>; to?: PlayerId[] | null }
  | { type: 'respond_trade'; offerId: string; accept: boolean }
  | { type: 'confirm_trade'; offerId: string; partner: PlayerId }
  | { type: 'cancel_trade'; offerId: string }
  | { type: 'end_turn' };

export type ActionType = Action['type'];

export interface GameSettings {
  victoryPoints: number;
  board: BoardOptions;
  /** Seconds a player may take per turn; 0 disables the clock. */
  turnSeconds: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  hostId: PlayerId;
  players: Array<{ id: PlayerId; name: string; color: PlayerColor; isBot: boolean; connected: boolean }>;
  maxPlayers: number;
  phase: GameState['phase'];
  createdAt: number;
  hasPassword: boolean;
}

// --- client -> server -------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'list_rooms' }
  | { t: 'create_room'; name: string; settings?: Partial<GameSettings>; password?: string }
  | { t: 'join_room'; roomId: string; password?: string }
  | { t: 'leave_room' }
  | { t: 'add_bot'; difficulty?: 'easy' | 'normal' }
  | { t: 'remove_player'; playerId: PlayerId }
  | { t: 'set_color'; color: PlayerColor }
  | { t: 'set_settings'; settings: Partial<GameSettings> }
  | { t: 'start_game' }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  /** Ask for a complete state, board included. Used to recover if a client
   *  somehow finds itself without one. */
  | { t: 'resync' }
  | { t: 'ping' };

// --- server -> client -------------------------------------------------------

/** A player's own view: their hand is exact, everyone else's is a count. */
export interface OpponentView {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  isBot: boolean;
  connected: boolean;
  seat: number;
  resourceCount: number;
  devCardCount: number;
  /** Played cards are face up, so opponents see the full breakdown. */
  playedDevCards: DevCardCounts;
  playedKnights: number;
  roads: EdgeId[];
  settlements: VertexId[];
  cities: VertexId[];
  piecesLeft: { road: number; settlement: number; city: number };
  harborRatios: Partial<Record<Resource, number>>;
  hasGenericHarbor: boolean;
  longestRoadLength: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  /** Excludes hidden victory-point cards until the game ends. */
  publicVictoryPoints: number;
}

export type PlayerView = Omit<GameState, 'players' | 'devDeck' | 'rng'> & {
  you: GameState['players'][number] | null;
  players: OpponentView[];
  devDeckSize: number;
  /** Your total including hidden victory-point cards. */
  yourVictoryPoints: number;
};

/**
 * A view as it goes over the wire.
 *
 * The board is fixed for the life of a game and is a third of a view's bytes,
 * so it is sent once and omitted from later updates. Clients cache the last
 * board they were given and splice it back in; `useConnection` does this, so
 * the rest of the client only ever sees a complete `PlayerView`.
 */
export type PlayerViewWire = Omit<PlayerView, 'board'> & { board?: PlayerView['board'] };

export type ServerMessage =
  | { t: 'welcome'; playerId: PlayerId; token: string; name: string }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'joined'; roomId: string; settings: GameSettings }
  | { t: 'left' }
  | { t: 'state'; view: PlayerViewWire; settings: GameSettings }
  | { t: 'error'; message: string; code?: string }
  | { t: 'chat'; from: PlayerId; name: string; text: string; at: number }
  | { t: 'pong' };

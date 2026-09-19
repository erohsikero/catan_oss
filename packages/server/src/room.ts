import {
  addPlayer,
  applyAction,
  botAction,
  botName,
  createGame,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  randomSeed,
  RuleError,
  startGame,
  viewFor,
  type Action,
  type GameSettings,
  type GameState,
  type PlayerColor,
  type PlayerId,
  type RoomSummary,
  type ServerMessage,
} from '@hexhaven/shared';

export interface Member {
  playerId: PlayerId;
  name: string;
  send(msg: ServerMessage): void;
  /** False while the socket is gone but the seat is still held open. */
  online: boolean;
}

/** How long a bot pauses between actions, so humans can follow what it did. */
const BOT_THINK_MS = 650;
/** A disconnected player keeps their seat this long before bots take over. */
export const RECONNECT_GRACE_MS = 120_000;

export class Room {
  readonly id: string;
  name: string;
  hostId: PlayerId;
  settings: GameSettings;
  password: string | null;
  state: GameState;

  private readonly members = new Map<PlayerId, Member>();
  private botTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(id: string, name: string, hostId: PlayerId, settings: Partial<GameSettings> = {}, password?: string) {
    this.id = id;
    this.name = name;
    this.hostId = hostId;
    this.password = password && password.length > 0 ? password : null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      board: { ...DEFAULT_SETTINGS.board, ...(settings.board ?? {}) },
    };
    this.state = createGame(id, randomSeed(), this.settings);
  }

  get playerCount(): number {
    return this.state.players.length;
  }

  get isEmptyOfHumans(): boolean {
    return [...this.members.values()].every((m) => !m.online);
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      name: this.name,
      hostId: this.hostId,
      players: this.state.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        connected: p.connected,
      })),
      maxPlayers: MAX_PLAYERS,
      phase: this.state.phase,
      createdAt: this.state.createdAt,
      hasPassword: this.password !== null,
    };
  }

  // --- membership ---------------------------------------------------------

  join(member: Member): void {
    const existing = this.state.players.find((p) => p.id === member.playerId);
    if (existing) {
      // Reconnecting into a seat that was held open.
      existing.connected = true;
      existing.name = member.name || existing.name;
      this.members.set(member.playerId, member);
      this.broadcast();
      this.kickBotLoop();
      return;
    }
    if (this.state.phase !== 'lobby') throw new RuleError('in_progress', 'That game has already started.');
    if (this.playerCount >= MAX_PLAYERS) throw new RuleError('room_full', 'That room is full.');
    addPlayer(this.state, member.playerId, member.name);
    this.members.set(member.playerId, member);
    this.broadcast();
  }

  /**
   * Drops a player's socket. In the lobby the seat is freed; mid-game it is
   * held so they can reconnect, and the bot loop covers their turns.
   */
  leave(playerId: PlayerId, permanent: boolean): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
    if (this.state.phase === 'lobby' || permanent) {
      this.state.players = this.state.players.filter((p) => p.id !== playerId);
      this.state.players.forEach((p, i) => (p.seat = i));
      this.members.delete(playerId);
      if (this.hostId === playerId) {
        const next = this.state.players.find((p) => !p.isBot);
        if (next) this.hostId = next.id;
      }
    } else {
      player.connected = false;
      const member = this.members.get(playerId);
      if (member) member.online = false;
    }
    this.broadcast();
    this.kickBotLoop();
  }

  addBot(): void {
    if (this.state.phase !== 'lobby') throw new RuleError('in_progress', 'The game has already started.');
    if (this.playerCount >= MAX_PLAYERS) throw new RuleError('room_full', 'That room is full.');
    const id = `bot_${Math.random().toString(36).slice(2, 9)}`;
    addPlayer(this.state, id, botName(this.state, this.state.rng), true);
    this.broadcast();
  }

  removePlayer(requesterId: PlayerId, targetId: PlayerId): void {
    if (requesterId !== this.hostId) throw new RuleError('not_host', 'Only the host can remove players.');
    if (this.state.phase !== 'lobby') throw new RuleError('in_progress', 'The game has already started.');
    this.leave(targetId, true);
  }

  setColor(playerId: PlayerId, color: PlayerColor): void {
    if (this.state.phase !== 'lobby') throw new RuleError('in_progress', 'The game has already started.');
    if (!PLAYER_COLORS.includes(color)) throw new RuleError('bad_color', 'Unknown colour.');
    if (this.state.players.some((p) => p.id !== playerId && p.color === color)) {
      throw new RuleError('color_taken', 'Another player has that colour.');
    }
    const player = this.state.players.find((p) => p.id === playerId);
    if (player) player.color = color;
    this.broadcast();
  }

  setSettings(playerId: PlayerId, patch: Partial<GameSettings>): void {
    if (playerId !== this.hostId) throw new RuleError('not_host', 'Only the host can change settings.');
    if (this.state.phase !== 'lobby') throw new RuleError('in_progress', 'The game has already started.');
    this.settings = {
      ...this.settings,
      ...patch,
      board: { ...this.settings.board, ...(patch.board ?? {}) },
      victoryPoints: Math.max(3, Math.min(20, patch.victoryPoints ?? this.settings.victoryPoints)),
      turnSeconds: Math.max(0, Math.min(600, patch.turnSeconds ?? this.settings.turnSeconds)),
    };
    // Re-roll the island so the lobby previews the layout it will actually play.
    const players = this.state.players;
    this.state = createGame(this.id, randomSeed(), this.settings);
    this.state.players = players;
    this.broadcast();
  }

  start(playerId: PlayerId): void {
    if (playerId !== this.hostId) throw new RuleError('not_host', 'Only the host can start the game.');
    if (this.playerCount < MIN_PLAYERS) {
      throw new RuleError('not_enough_players', `You need at least ${MIN_PLAYERS} players.`);
    }
    startGame(this.state);
    this.broadcast();
    this.kickBotLoop();
  }

  // --- gameplay -----------------------------------------------------------

  handleAction(playerId: PlayerId, action: Action): void {
    applyAction(this.state, this.settings, playerId, action);
    this.broadcast();
    this.kickBotLoop();
    this.armTurnTimer();
  }

  /**
   * Runs the next bot (or disconnected player's) action, one at a time, on a
   * timer. Stepping rather than looping keeps the server responsive and lets
   * clients animate each move.
   */
  private kickBotLoop(): void {
    if (this.botTimer || this.disposed) return;
    if (this.state.phase !== 'setup' && this.state.phase !== 'play') return;

    const actor = this.findAutomatedActor();
    if (!actor) return;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.disposed) return;
      const next = this.findAutomatedActor();
      if (!next) return;
      try {
        applyAction(this.state, this.settings, next.playerId, next.action);
      } catch (err) {
        // A bot should never produce an illegal action; if it does, end its
        // turn rather than wedging the room.
        if (err instanceof RuleError) {
          try {
            applyAction(this.state, this.settings, next.playerId, { type: 'end_turn' });
          } catch {
            /* nothing safe left to do; the turn timer will move things along */
          }
        } else throw err;
      }
      this.broadcast();
      this.kickBotLoop();
    }, BOT_THINK_MS);
  }

  /** A bot, or a disconnected human whose turn is holding up the game. */
  private findAutomatedActor(): { playerId: PlayerId; action: Action } | null {
    for (const p of this.state.players) {
      if (!p.isBot && p.connected) continue;
      const action = botAction(this.state, this.settings, p.id);
      if (action) return { playerId: p.id, action };
    }
    return null;
  }

  private armTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    if (this.settings.turnSeconds <= 0) return;
    if (this.state.phase !== 'play') return;
    const seat = this.state.currentPlayer;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      // Only fire if the same player is still sitting on the same turn.
      if (this.state.currentPlayer !== seat || this.state.phase !== 'play') return;
      const player = this.state.players[seat];
      if (!player) return;
      const action = botAction(this.state, this.settings, player.id);
      if (!action) return;
      try {
        applyAction(this.state, this.settings, player.id, action);
        this.broadcast();
        this.kickBotLoop();
      } catch {
        /* ignore: the clock is a nudge, not an authority */
      }
    }, this.settings.turnSeconds * 1000);
  }

  // --- messaging ----------------------------------------------------------

  broadcast(): void {
    for (const member of this.members.values()) {
      if (!member.online) continue;
      member.send({ t: 'state', view: viewFor(this.state, member.playerId), settings: this.settings });
    }
  }

  sendChat(from: PlayerId, text: string): void {
    const player = this.state.players.find((p) => p.id === from);
    const trimmed = text.slice(0, 400).trim();
    if (!trimmed) return;
    const msg: ServerMessage = {
      t: 'chat',
      from,
      name: player?.name ?? 'Unknown',
      text: trimmed,
      at: Date.now(),
    };
    for (const member of this.members.values()) if (member.online) member.send(msg);
  }

  dispose(): void {
    this.disposed = true;
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.botTimer = null;
    this.turnTimer = null;
    this.members.clear();
  }
}

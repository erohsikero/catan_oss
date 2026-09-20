import {
  addPlayer,
  applyAction,
  botAction,
  botName,
  createGame,
  DEFAULT_SETTINGS,
  extendFromReserve,
  forcedAction,
  resolveClock,
  startClock,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  randomSeed,
  RuleError,
  startGame,
  viewFor,
  type Action,
  type ClockSettings,
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
  /**
   * Whether this socket has already received the board. It is fixed for the
   * life of a game, so it is sent once and omitted afterwards; a reconnecting
   * socket arrives with this false and is sent it again.
   */
  hasBoard?: boolean;
}

/**
 * How long a bot pauses between actions, so humans can follow what it did.
 * Tests and CI set this near zero to play a full game in seconds.
 */
const BOT_THINK_MS = Math.max(0, Number(process.env.HEXHAVEN_BOT_THINK_MS ?? 650));
/** A disconnected player keeps their seat this long before bots take over. */
export const RECONNECT_GRACE_MS = 120_000;

/** Keeps hand-entered clock values inside something playable. */
function clampClock(clock: Partial<ClockSettings>): Partial<ClockSettings> {
  const bound = (v: number | undefined, lo: number, hi: number, fallback: number) =>
    Math.max(lo, Math.min(hi, v ?? fallback));
  const base = resolveClock({ clock });
  return {
    enabled: clock.enabled ?? base.enabled,
    setupSeconds: bound(clock.setupSeconds, 10, 600, base.setupSeconds),
    rollSeconds: bound(clock.rollSeconds, 5, 300, base.rollSeconds),
    mainSeconds: bound(clock.mainSeconds, 15, 900, base.mainSeconds),
    discardSeconds: bound(clock.discardSeconds, 10, 300, base.discardSeconds),
    robberSeconds: bound(clock.robberSeconds, 10, 300, base.robberSeconds),
    tradeGraceSeconds: bound(clock.tradeGraceSeconds, 0, 300, base.tradeGraceSeconds),
    reserveSeconds: bound(clock.reserveSeconds, 0, 1800, base.reserveSeconds),
    reserveChunkSeconds: bound(clock.reserveChunkSeconds, 5, 300, base.reserveChunkSeconds),
  };
}

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
      // They are back, so the clock applies to them again.
      this.armClock();
      return;
    }
    if (this.state.phase !== 'lobby') throw new RuleError('in_progress', 'That game has already started.');
    if (this.playerCount >= MAX_PLAYERS) throw new RuleError('room_full', 'That room is full.');
    addPlayer(this.state, member.playerId, member.name);
    this.members.set(member.playerId, member);
    this.broadcast();
  }

  /**
   * Drops a player's socket.
   *
   * In the lobby the seat is freed. Once the game has started the seat is
   * kept for good, even for a player who never comes back: seat indices are
   * baked into `currentPlayer` and the setup draft order, so removing someone
   * mid-game would scramble whose turn it is. A permanently gone player stays
   * in the game as a disconnected seat and the bot loop plays their turns.
   */
  leave(playerId: PlayerId, permanent: boolean): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
    if (this.state.phase === 'lobby') {
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
      // A permanent departure also releases the socket, so the room can be
      // reclaimed once no human is left watching.
      if (permanent) this.members.delete(playerId);
    }
    this.broadcast();
    this.kickBotLoop();
    this.armClock();
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
      clock: clampClock({ ...this.settings.clock, ...(patch.clock ?? {}) }),
    };
    // Re-roll the island so the lobby previews the layout it will actually play.
    const players = this.state.players;
    this.state = createGame(this.id, randomSeed(), this.settings);
    this.state.players = players;
    this.resendBoard();
    this.broadcast();
  }

  start(playerId: PlayerId): void {
    if (playerId !== this.hostId) throw new RuleError('not_host', 'Only the host can start the game.');
    if (this.playerCount < MIN_PLAYERS) {
      throw new RuleError('not_enough_players', `You need at least ${MIN_PLAYERS} players.`);
    }
    startGame(this.state);
    startClock(this.state, this.settings);
    this.broadcast();
    this.kickBotLoop();
    this.armClock();
  }

  // --- gameplay -----------------------------------------------------------

  handleAction(playerId: PlayerId, action: Action): void {
    applyAction(this.state, this.settings, playerId, action);
    this.broadcast();
    this.kickBotLoop();
    this.armClock();
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
      // A bot's move usually hands the step to someone else, so the clock
      // has to be re-armed for whoever is now being waited on. Without this
      // a human's deadline is scheduled once and then orphaned the moment a
      // bot takes a turn.
      this.armClock();
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

  /**
   * Schedules a wake-up at the current step's deadline.
   *
   * One timer covers the whole room: the state carries a single deadline, so
   * re-arming after each action is enough, and a step that has not changed
   * keeps the deadline it already had rather than being refilled.
   */
  private armClock(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    if (this.disposed) return;

    const clock = this.state.clock;
    if (!clock) return;
    if (this.state.phase !== 'play' && this.state.phase !== 'setup') return;
    // Bots take their own turns promptly; no need to also race a clock.
    if (clock.players.every((id) => this.isAutomated(id))) return;

    const delay = Math.max(0, clock.deadline - Date.now());
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.onClockExpired();
    }, delay + 50);
  }

  private isAutomated(playerId: PlayerId): boolean {
    const player = this.state.players.find((p) => p.id === playerId);
    return !player || player.isBot || !player.connected;
  }

  /**
   * A step ran out of time.
   *
   * The player's own reserve is spent first, so a single hard decision costs
   * time rather than the turn. Only once that is gone does the server play
   * for them, and then as little as the rules allow.
   */
  private onClockExpired(): void {
    if (this.disposed) return;
    const clock = this.state.clock;
    if (!clock) return;
    // A late timer for a step that has already moved on is simply stale.
    if (Date.now() < clock.deadline) {
      this.armClock();
      return;
    }

    if (extendFromReserve(this.state, this.settings, Date.now())) {
      this.broadcast();
      this.armClock();
      return;
    }

    for (const playerId of clock.players) {
      const action = forcedAction(this.state, playerId, (state, id) => botAction(state, this.settings, id));
      if (!action) continue;
      try {
        applyAction(this.state, this.settings, playerId, action);
      } catch {
        // The step moved under us, or the fallback was not legal after all.
        // Either way the next broadcast reflects reality.
      }
    }
    this.broadcast();
    this.kickBotLoop();
    this.armClock();
  }

  // --- messaging ----------------------------------------------------------

  broadcast(): void {
    for (const member of this.members.values()) {
      if (!member.online) continue;
      const includeBoard = member.hasBoard !== true;
      member.send({
        t: 'state',
        view: viewFor(this.state, member.playerId, { includeBoard }),
        settings: this.settings,
      });
      member.hasBoard = true;
    }
  }

  /** Forces the board back into the next update, after a reconnect or a re-roll. */
  private resendBoard(): void {
    for (const member of this.members.values()) member.hasBoard = false;
  }

  /** Sends one member a complete state, board included. */
  resync(playerId: PlayerId): void {
    const member = this.members.get(playerId);
    if (!member || !member.online) return;
    member.hasBoard = false;
    member.send({
      t: 'state',
      view: viewFor(this.state, playerId, { includeBoard: true }),
      settings: this.settings,
    });
    member.hasBoard = true;
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

import { useEffect, useRef, useState } from 'react';
import type { OpponentView, PlayerView } from '@hexhaven/shared';
import { PLAYER_PALETTE } from '../three/theme.js';
import type { ChatMessage } from '../net/useConnection.js';
import { CardsIcon, KnightIcon, RoadIcon, ScrollIcon } from './Icons.js';
import { QUALITY_LABELS, QUALITY_LEVELS, type Quality } from '../three/quality.js';

/** Opponent summary cards: points, hand size, army and awards at a glance. */
export function PlayerPanels({
  view,
  playerId,
}: {
  view: PlayerView;
  playerId: string | null;
}) {
  const current = view.players.find((p) => p.seat === view.currentPlayer);
  return (
    <div className="players">
      {[...view.players]
        .sort((a, b) => a.seat - b.seat)
        .map((p) => (
          <PlayerCard key={p.id} p={p} active={p.id === current?.id} you={p.id === playerId} />
        ))}
    </div>
  );
}

function PlayerCard({ p, active, you }: { p: OpponentView; active: boolean; you: boolean }) {
  const palette = PLAYER_PALETTE[p.color];
  return (
    <div
      className={`player-card${active ? ' active' : ''}${p.connected ? '' : ' offline'}`}
      style={{ borderLeftColor: palette.base }}
    >
      <div className="player-head">
        <span className="swatch" style={{ background: palette.base }} />
        <span className="player-name" title={p.name}>
          {p.name}
          {you && <span className="faint tiny"> (you)</span>}
        </span>
        <span className="vp-badge" title="Victory points visible to everyone">
          {p.publicVictoryPoints}
        </span>
      </div>
      <div className="player-stats">
        <span className="stat" title="Resource cards in hand">
          <CardsIcon /> {p.resourceCount}
        </span>
        <span className="stat" title="Development cards in hand">
          <ScrollIcon /> {p.devCardCount}
        </span>
        <span className="stat" title="Knights played">
          <KnightIcon /> {p.playedKnights}
        </span>
        <span className="stat" title="Longest continuous road">
          <RoadIcon /> {p.longestRoadLength}
        </span>
      </div>
      {(p.hasLongestRoad || p.hasLargestArmy || !p.connected) && (
        <div className="awards">
          {p.hasLongestRoad && <span className="award">Longest Road</span>}
          {p.hasLargestArmy && <span className="award">Largest Army</span>}
          {!p.connected && <span className="award" style={{ color: '#e0a0a0' }}>Away</span>}
        </div>
      )}
    </div>
  );
}

/** Pip layout for each die face. */
const DIE_FACES: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Dice({ dice }: { dice: [number, number] | null }) {
  const [rolling, setRolling] = useState(false);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const key = dice ? dice.join('-') : null;
    if (key && key !== previous.current) {
      setRolling(true);
      const timer = window.setTimeout(() => setRolling(false), 430);
      previous.current = key;
      return () => window.clearTimeout(timer);
    }
    previous.current = key;
  }, [dice]);

  if (!dice) return null;
  return (
    <div className="dice-pair" title={`Rolled ${dice[0] + dice[1]}`}>
      {dice.map((value, i) => (
        <div className={`die${rolling ? ' rolling' : ''}`} key={i}>
          {Array.from({ length: 9 }, (_, cell) => (
            <span key={cell}>{DIE_FACES[value]?.includes(cell) ? <span className="pip" /> : null}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One line telling the player exactly what the game is waiting for. */
export function TurnBanner({ view, playerId }: { view: PlayerView; playerId: string | null }) {
  const current = view.players.find((p) => p.seat === view.currentPlayer);
  const mine = current?.id === playerId;
  const who = mine ? 'You' : (current?.name ?? 'Someone');

  let message: string;
  switch (view.pending.kind) {
    case 'setup':
      message = `${who}: place a ${view.pending.step === 'settlement' ? 'settlement' : 'road'} (round ${view.pending.round} of 2)`;
      break;
    case 'roll':
      message = mine ? 'Your turn — roll the dice' : `Waiting for ${who} to roll`;
      break;
    case 'discard': {
      const owed = playerId ? view.pending.owed[playerId] : undefined;
      const waiting = Object.keys(view.pending.owed).length;
      message = owed ? `Seven rolled — discard ${owed} cards` : `Waiting on ${waiting} player(s) to discard`;
      break;
    }
    case 'move_robber':
      message = mine ? 'Move the robber' : `${who} is moving the robber`;
      break;
    case 'steal':
      message = mine ? 'Choose who to rob' : `${who} is choosing who to rob`;
      break;
    case 'build_roads':
      message = mine
        ? `Road Building — place ${view.pending.roadsLeft} more free road${view.pending.roadsLeft === 1 ? '' : 's'}`
        : `${who} is placing free roads`;
      break;
    case 'main':
      message = mine ? 'Your turn — build, trade, or end turn' : `${who} is taking their turn`;
      break;
    case 'ended':
      message = 'Game over';
      break;
    default:
      message = 'Waiting for players';
  }

  return (
    <div className="turn-banner">
      {current && <span className="swatch" style={{ background: PLAYER_PALETTE[current.color].base }} />}
      <span>
        <strong>Turn {view.turn}</strong> &middot; {message}
      </span>
    </div>
  );
}

/** Game log and table chat, sharing one scrolling panel. */
export function LogPanel({
  view,
  chat,
  onSend,
}: {
  view: PlayerView;
  chat: ChatMessage[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const nameOf = (id?: string) => view.players.find((p) => p.id === id)?.name;
  const colorOf = (id?: string) => {
    const p = view.players.find((x) => x.id === id);
    return p ? PLAYER_PALETTE[p.color].light : undefined;
  };

  // Merge the two streams so chat lands in sequence with the game events.
  const merged = [
    ...view.log.map((e) => ({ kind: 'log' as const, key: `l${e.id}`, order: e.id, entry: e })),
    ...chat.map((c, i) => ({ kind: 'chat' as const, key: `c${c.at}-${i}`, order: 1e9 + i, entry: c })),
  ].sort((a, b) => a.order - b.order);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [merged.length, open]);

  return (
    <div className="log panel">
      <div className="log-head">
        <span>Table log</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          <div className="log-body" ref={bodyRef}>
            {merged.slice(-120).map((item) =>
              item.kind === 'log' ? (
                <div className="log-line" key={item.key}>
                  <span className="who" style={{ color: colorOf(item.entry.player) }}>
                    {nameOf(item.entry.player) ? '' : ''}
                  </span>
                  {item.entry.text}
                </div>
              ) : (
                <div className="log-line" key={item.key}>
                  <span className="who" style={{ color: colorOf(item.entry.from) }}>
                    {item.entry.name}:{' '}
                  </span>
                  {item.entry.text}
                </div>
              ),
            )}
          </div>
          <form
            className="chat-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              onSend(draft);
              setDraft('');
            }}
          >
            <input
              type="text"
              value={draft}
              placeholder="Say something&hellip;"
              maxLength={300}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn btn-sm" type="submit">
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/**
 * The turn clock.
 *
 * A ring rather than a number alone: the proportion left is readable at a
 * glance from across the table, which is the whole point of a clock that is
 * meant to keep a game moving rather than to be studied. It warms to amber
 * and then red as the step runs out, and says plainly when a player has
 * started eating into their reserve.
 */
export function TurnTimer({ view, playerId }: { view: PlayerView; playerId: string | null }) {
  const clock = view.clock;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!clock) return;
    // A quarter second is smooth enough for a ring and cheap enough to run
    // for an entire game.
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clock]);

  if (!clock) return null;

  const remainingMs = Math.max(0, clock.deadline - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = clock.durationMs > 0 ? Math.min(1, remainingMs / clock.durationMs) : 0;

  const mine = playerId !== null && clock.players.includes(playerId);
  const waitingFor = clock.players
    .map((id) => view.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const owner = waitingFor[0];

  // Everyone in the step shares the deadline; show the lowest reserve.
  const reserveMs = Math.min(...waitingFor.map((p) => p.reserveMs), Infinity);
  const reserveSeconds = Number.isFinite(reserveMs) ? Math.floor(reserveMs / 1000) : 0;

  const urgent = remainingMs <= 10_000;
  const warning = !urgent && remainingMs <= 25_000;
  const stroke = urgent ? '#e05c57' : warning ? '#e0b060' : '#6fa8d0';

  const R = 17;
  const circumference = 2 * Math.PI * R;

  const label =
    clock.players.length > 1
      ? `${clock.players.length} players discarding`
      : mine
        ? 'Your move'
        : (owner?.name ?? 'Waiting');

  return (
    <div className={`turn-timer${urgent ? ' urgent' : ''}`} title={`${label}: ${seconds}s left`}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
        <circle cx="22" cy="22" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={R}
          fill="none"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 22 22)"
          style={{ transition: 'stroke-dashoffset 250ms linear, stroke 300ms ease' }}
        />
      </svg>
      <span className="timer-seconds" style={{ color: stroke }}>
        {seconds}
      </span>
      <span className="timer-label">
        <span className="tiny">{label}</span>
        {reserveSeconds > 0 ? (
          <span className="faint tiny">+{reserveSeconds}s reserve</span>
        ) : (
          <span className="faint tiny" style={{ color: '#e0908a' }}>
            no reserve left
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Graphics quality control.
 *
 * Post-processing is the largest frame cost in the scene, and the right
 * setting depends on hardware the game cannot reliably detect. The tier is
 * guessed on first load and remembered after that, but it stays one click
 * away — a player whose machine struggles should not have to find a menu.
 */
export function QualityPicker({ quality, onChange }: { quality: Quality; onChange: (q: Quality) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="quality-picker">
      <button
        className="btn btn-sm btn-ghost"
        aria-expanded={open}
        title="Graphics quality"
        onClick={() => setOpen((v) => !v)}
      >
        Graphics: {QUALITY_LABELS[quality].label}
      </button>
      {open && (
        <div className="quality-menu panel">
          {QUALITY_LEVELS.map((level) => (
            <button
              key={level}
              className="quality-option"
              aria-pressed={level === quality}
              onClick={() => {
                onChange(level);
                setOpen(false);
              }}
            >
              <span className="quality-name">{QUALITY_LABELS[level].label}</span>
              <span className="faint tiny">{QUALITY_LABELS[level].blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

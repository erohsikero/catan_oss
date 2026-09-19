import { useEffect, useRef, useState } from 'react';
import type { OpponentView, PlayerView } from '@hexhaven/shared';
import { PLAYER_PALETTE } from '../three/theme.js';
import type { ChatMessage } from '../net/useConnection.js';
import { CardsIcon, KnightIcon, RoadIcon, ScrollIcon } from './Icons.js';

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

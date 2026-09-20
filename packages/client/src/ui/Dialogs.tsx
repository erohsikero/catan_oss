import { useMemo, useState } from 'react';
import {
  RESOURCES,
  bagCovers,
  bagTotal,
  bankTradeRatio,
  type Action,
  type PlayerView,
  type Resource,
  type ResourceBag,
} from '@hexhaven/shared';
import { PLAYER_PALETTE, RESOURCE_META } from '../three/theme.js';
import { ResourceIcon } from './Icons.js';

function Modal({ title, blurb, children }: { title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <div className="backdrop">
      <div className="modal">
        <h3>{title}</h3>
        {blurb && <p>{blurb}</p>}
        {children}
      </div>
    </div>
  );
}

function Counter({
  resource,
  value,
  max,
  onChange,
}: {
  resource: Resource;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pick">
      <span className="glyph">
        <ResourceIcon resource={resource} size={26} />
      </span>
      <span className="tiny muted">{RESOURCE_META[resource].label}</span>
      <div className="counter">
        <button disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label={`One fewer ${resource}`}>
          &minus;
        </button>
        <span className="value">{value}</span>
        <button disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`One more ${resource}`}>
          +
        </button>
      </div>
    </div>
  );
}

function useBag(): [Partial<ResourceBag>, (r: Resource, n: number) => void, () => void] {
  const [bag, setBag] = useState<Partial<ResourceBag>>({});
  const set = (r: Resource, n: number) => setBag((prev) => ({ ...prev, [r]: Math.max(0, n) }));
  return [bag, set, () => setBag({})];
}

/** Forced discard after a seven: exactly half, rounded down. */
export function DiscardDialog({ view, owed, onSubmit }: { view: PlayerView; owed: number; onSubmit: (bag: Partial<ResourceBag>) => void }) {
  const [bag, set] = useBag();
  const you = view.you!;
  const chosen = bagTotal(bag);

  return (
    <Modal
      title="Discard half your hand"
      blurb={`A seven was rolled and you are holding ${bagTotal(you.resources)} cards. Choose ${owed} to return to the bank.`}
    >
      <div className="pick-grid">
        {RESOURCES.map((r) => (
          <Counter key={r} resource={r} value={bag[r] ?? 0} max={you.resources[r]} onChange={(n) => set(r, n)} />
        ))}
      </div>
      <div className="modal-actions">
        <span className="muted tiny" style={{ alignSelf: 'center', marginRight: 'auto' }}>
          {chosen} of {owed} selected
        </span>
        <button className="btn btn-primary" disabled={chosen !== owed} onClick={() => onSubmit(bag)}>
          Discard
        </button>
      </div>
    </Modal>
  );
}

/** Year of Plenty: take any two cards from the bank. */
export function YearOfPlentyDialog({ view, onSubmit, onCancel }: { view: PlayerView; onSubmit: (picks: Resource[]) => void; onCancel: () => void }) {
  const [bag, set] = useBag();
  const total = bagTotal(bag);
  const picks = RESOURCES.flatMap((r) => Array.from({ length: bag[r] ?? 0 }, () => r));

  return (
    <Modal title="Year of Plenty" blurb="Take any two resources from the bank.">
      <div className="pick-grid">
        {RESOURCES.map((r) => (
          <Counter
            key={r}
            resource={r}
            value={bag[r] ?? 0}
            max={Math.min(2, view.bank[r])}
            onChange={(n) => set(r, n)}
          />
        ))}
      </div>
      <div className="modal-actions">
        <span className="muted tiny" style={{ alignSelf: 'center', marginRight: 'auto' }}>
          {total} of 2 chosen
        </span>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={total !== 2} onClick={() => onSubmit(picks)}>
          Take them
        </button>
      </div>
    </Modal>
  );
}

/** Monopoly: name a resource and collect every one in play. */
export function MonopolyDialog({ onSubmit, onCancel }: { onSubmit: (r: Resource) => void; onCancel: () => void }) {
  const [choice, setChoice] = useState<Resource | null>(null);
  return (
    <Modal title="Monopoly" blurb="Name a resource. Every opponent must hand you all of theirs.">
      <div className="pick-grid">
        {RESOURCES.map((r) => (
          <button key={r} className="pick" aria-pressed={choice === r} onClick={() => setChoice(r)}>
            <span className="glyph">
              <ResourceIcon resource={r} size={26} />
            </span>
            <span className="tiny">{RESOURCE_META[r].label}</span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!choice} onClick={() => choice && onSubmit(choice)}>
          Claim it all
        </button>
      </div>
    </Modal>
  );
}

/** Pick which neighbour to rob, when the robber's tile touches several. */
export function StealDialog({ view, candidates, onPick }: { view: PlayerView; candidates: string[]; onPick: (id: string) => void }) {
  return (
    <Modal title="Choose someone to rob" blurb="You will take one random card from them.">
      <div className="scoreboard">
        {candidates.map((id) => {
          const p = view.players.find((x) => x.id === id);
          if (!p) return null;
          return (
            <button className="score-row" key={id} onClick={() => onPick(id)} style={{ textAlign: 'left' }}>
              <span className="swatch" style={{ background: PLAYER_PALETTE[p.color].base }} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="muted tiny">{p.resourceCount} cards</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/** Bank and harbour trades, plus offers to the other players. */
export function TradeDialog({
  view,
  onAct,
  onClose,
}: {
  view: PlayerView;
  onAct: (action: Action) => void;
  onClose: () => void;
}) {
  const you = view.you!;
  const [tab, setTab] = useState<'bank' | 'players'>('bank');
  const [give, setGive, resetGive] = useBag();
  const [want, setWant, resetWant] = useBag();
  const [bankGive, setBankGive] = useState<Resource | null>(null);
  const [bankWant, setBankWant] = useState<Resource | null>(null);

  const ratios = useMemo(() => {
    const out = {} as Record<Resource, number>;
    for (const r of RESOURCES) out[r] = bankTradeRatio(you, r);
    return out;
  }, [you]);

  const canBank =
    bankGive !== null &&
    bankWant !== null &&
    bankGive !== bankWant &&
    you.resources[bankGive] >= ratios[bankGive] &&
    view.bank[bankWant] > 0;

  const canOffer = bagTotal(give) > 0 && bagTotal(want) > 0 && bagCovers(you.resources, give);

  return (
    <Modal title="Trade">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-sm" aria-pressed={tab === 'bank'} onClick={() => setTab('bank')}>
          With the bank
        </button>
        <button className="btn btn-sm" aria-pressed={tab === 'players'} onClick={() => setTab('players')}>
          With players
        </button>
      </div>

      {tab === 'bank' ? (
        <>
          <p style={{ marginBottom: 10 }}>
            Your rate is shown on each card. Harbours improve it: 3:1 at a generic harbour, 2:1 at a matching one.
          </p>
          <div className="field">
            <label>Give</label>
            <div className="pick-grid">
              {RESOURCES.map((r) => (
                <button
                  key={r}
                  className="pick"
                  aria-pressed={bankGive === r}
                  aria-label={`Give ${RESOURCE_META[r].label} at ${ratios[r]} to 1`}
                  disabled={you.resources[r] < ratios[r]}
                  onClick={() => setBankGive(r)}
                >
                  <span className="glyph">
                    <ResourceIcon resource={r} size={26} />
                  </span>
                  {/* Naming the resource: an icon and a ratio alone leave a
                      player to recognise five drawings under time pressure,
                      and give a screen reader nothing at all. */}
                  <span className="tiny">{RESOURCE_META[r].label}</span>
                  <span className="tiny faint">
                    {ratios[r]}:1 &middot; have {you.resources[r]}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Receive</label>
            <div className="pick-grid">
              {RESOURCES.map((r) => (
                <button
                  key={r}
                  className="pick"
                  aria-pressed={bankWant === r}
                  aria-label={`Receive ${RESOURCE_META[r].label}`}
                  disabled={r === bankGive || view.bank[r] === 0}
                  onClick={() => setBankWant(r)}
                >
                  <span className="glyph">
                    <ResourceIcon resource={r} size={26} />
                  </span>
                  <span className="tiny">{RESOURCE_META[r].label}</span>
                  <span className="tiny faint">bank has {view.bank[r]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-primary"
              disabled={!canBank}
              onClick={() => {
                if (bankGive && bankWant) onAct({ type: 'bank_trade', give: bankGive, want: bankWant });
                setBankGive(null);
                setBankWant(null);
              }}
            >
              {canBank ? `Trade ${ratios[bankGive!]} for 1` : 'Trade'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginBottom: 10 }}>
            Offer a swap to everyone at the table. Whoever accepts, you choose who to deal with.
          </p>
          <div className="field">
            <label>You give</label>
            <div className="pick-grid">
              {RESOURCES.map((r) => (
                <Counter key={r} resource={r} value={give[r] ?? 0} max={you.resources[r]} onChange={(n) => setGive(r, n)} />
              ))}
            </div>
          </div>
          <div className="field">
            <label>You want</label>
            <div className="pick-grid">
              {RESOURCES.map((r) => (
                <Counter key={r} resource={r} value={want[r] ?? 0} max={19} onChange={(n) => setWant(r, n)} />
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-primary"
              disabled={!canOffer}
              onClick={() => {
                onAct({ type: 'offer_trade', give, want });
                resetGive();
                resetWant();
                onClose();
              }}
            >
              Send offer
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Live trade offers: respond to others', and close out your own. */
export function TradeOffers({
  view,
  playerId,
  onAct,
}: {
  view: PlayerView;
  playerId: string;
  onAct: (action: Action) => void;
}) {
  if (view.trades.length === 0) return null;
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? 'Someone';
  const describe = (bag: Partial<ResourceBag>) =>
    RESOURCES.filter((r) => (bag[r] ?? 0) > 0)
      .map((r) => `${bag[r]} ${RESOURCE_META[r].label.toLowerCase()}`)
      .join(', ') || 'nothing';

  return (
    <div className="backdrop">
      <div className="modal">
        <h3>Trade offers</h3>
        {view.trades.map((offer) => {
          const mine = offer.from === playerId;
          const myResponse = offer.responses[playerId];
          const accepters = Object.entries(offer.responses).filter(([, v]) => v === 'accept');
          return (
            <div key={offer.id} style={{ marginBottom: 16 }}>
              <p style={{ marginBottom: 8 }}>
                <strong>{mine ? 'You offer' : `${nameOf(offer.from)} offers`}</strong> {describe(offer.give)}{' '}
                <span className="faint">for</span> {describe(offer.want)}
              </p>
              {mine ? (
                <div className="scoreboard">
                  {accepters.length === 0 && <span className="muted tiny">Waiting for someone to accept&hellip;</span>}
                  {accepters.map(([id]) => (
                    <button
                      className="score-row"
                      key={id}
                      onClick={() => onAct({ type: 'confirm_trade', offerId: offer.id, partner: id })}
                    >
                      <span style={{ flex: 1, textAlign: 'left' }}>{nameOf(id)} accepted</span>
                      <span className="btn btn-sm btn-primary">Trade</span>
                    </button>
                  ))}
                  <button className="btn btn-sm" onClick={() => onAct({ type: 'cancel_trade', offerId: offer.id })}>
                    Withdraw
                  </button>
                </div>
              ) : myResponse === 'pending' ? (
                <div className="row">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!bagCovers(view.you?.resources ?? {}, offer.want)}
                    onClick={() => onAct({ type: 'respond_trade', offerId: offer.id, accept: true })}
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => onAct({ type: 'respond_trade', offerId: offer.id, accept: false })}
                  >
                    Decline
                  </button>
                  {!bagCovers(view.you?.resources ?? {}, offer.want) && (
                    <span className="faint tiny">You do not hold what they are asking for.</span>
                  )}
                </div>
              ) : (
                <span className="muted tiny">You {myResponse === 'accept' ? 'accepted' : 'declined'}.</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Final scoreboard, with hidden victory-point cards revealed. */
export function VictoryDialog({ view, onLeave }: { view: PlayerView; onLeave: () => void }) {
  const winner = view.players.find((p) => p.id === view.winner);
  const ranked = [...view.players].sort((a, b) => b.publicVictoryPoints - a.publicVictoryPoints);

  return (
    <div className="backdrop">
      <div className="modal victory">
        <h3>{winner ? `${winner.name} wins` : 'Game over'}</h3>
        <p>Hidden victory point cards are now revealed.</p>
        <div className="scoreboard">
          {ranked.map((p) => (
            <div className={`score-row${p.id === view.winner ? ' winner' : ''}`} key={p.id}>
              <span className="swatch" style={{ background: PLAYER_PALETTE[p.color].base }} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="muted tiny">
                {p.settlements.length}S &middot; {p.cities.length}C &middot; {p.playedKnights} knights
              </span>
              <span className="vp-badge">{p.publicVictoryPoints}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onLeave}>
            Back to the lobby
          </button>
        </div>
      </div>
    </div>
  );
}

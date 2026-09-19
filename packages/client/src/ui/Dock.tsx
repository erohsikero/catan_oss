import {
  BUILD_COSTS,
  DEV_CARDS,
  RESOURCES,
  bagCovers,
  type DevCard,
  type PlayerView,
  type Resource,
  type ResourceBag,
} from '@hexhaven/shared';
import { DEV_CARD_META, RESOURCE_META } from '../three/theme.js';
import { ResourceIcon } from './Icons.js';

/** Small colour chips spelling out what something costs. */
function Cost({ cost }: { cost: Partial<ResourceBag> }) {
  return (
    <span className="cost">
      {RESOURCES.flatMap((r) =>
        Array.from({ length: cost[r] ?? 0 }, (_, i) => (
          <i key={`${r}${i}`} style={{ background: RESOURCE_META[r].color }} title={RESOURCE_META[r].label} />
        )),
      )}
    </span>
  );
}

/** The player's own hand: one card per resource, plus playable development cards. */
export function Hand({
  view,
  onPlayDev,
  canPlayDev,
}: {
  view: PlayerView;
  onPlayDev: (card: DevCard) => void;
  canPlayDev: boolean;
}) {
  const you = view.you;
  if (!you) return null;

  const playable = DEV_CARDS.filter((c) => c !== 'victory_point' && you.devCards[c] > 0);
  const locked = DEV_CARDS.filter((c) => c !== 'victory_point' && you.pendingDevCards[c] > 0);
  const points = you.devCards.victory_point + you.pendingDevCards.victory_point;

  return (
    <div className="dock">
      {(playable.length > 0 || locked.length > 0 || points > 0) && (
        <div className="dev-strip">
          {playable.map((card) => (
            <button
              key={card}
              className="dev-card"
              disabled={!canPlayDev}
              title={DEV_CARD_META[card].blurb}
              onClick={() => onPlayDev(card)}
            >
              {DEV_CARD_META[card].label}
              {you.devCards[card] > 1 && <span> &times;{you.devCards[card]}</span>}
            </button>
          ))}
          {locked.map((card) => (
            <button
              key={`pending-${card}`}
              className="dev-card"
              disabled
              title="Bought this turn — playable from your next turn."
            >
              {DEV_CARD_META[card].label}
              <span className="lock">&#128274; next turn</span>
            </button>
          ))}
          {points > 0 && (
            <span className="dev-card" title="Kept hidden from your opponents until you win.">
              Victory Point &times;{points}
            </span>
          )}
        </div>
      )}

      <div className="hand">
        {RESOURCES.map((r) => (
          <div
            key={r}
            className={`res-card${you.resources[r] === 0 ? ' empty' : ''}`}
            title={`${RESOURCE_META[r].label}: ${you.resources[r]}`}
          >
            <span
              className="glyph"
              style={{
                background: `linear-gradient(168deg, ${RESOURCE_META[r].color}, rgba(0, 0, 0, 0.5))`,
              }}
            >
              <ResourceIcon resource={r} size={34} />
            </span>
            <span className="count">{you.resources[r]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ActionBarProps {
  view: PlayerView;
  isMyTurn: boolean;
  mode: string | null;
  onRoll: () => void;
  onBuild: (what: 'road' | 'settlement' | 'city') => void;
  onBuyDev: () => void;
  onTrade: () => void;
  onEndTurn: () => void;
  onCancel: () => void;
}

/** Everything the player can do on their turn, with affordability shown. */
export function ActionBar({
  view,
  isMyTurn,
  mode,
  onRoll,
  onBuild,
  onBuyDev,
  onTrade,
  onEndTurn,
  onCancel,
}: ActionBarProps) {
  const you = view.you;
  if (!you) return null;
  const pending = view.pending.kind;
  const inMain = isMyTurn && pending === 'main';
  const afford = (cost: Partial<ResourceBag>) => bagCovers(you.resources, cost);

  if (mode) {
    return (
      <div className="actions">
        <span className="muted tiny" style={{ alignSelf: 'center', padding: '0 6px' }}>
          Pick a spot on the board
        </span>
        <button className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (pending === 'setup') {
    return (
      <div className="actions">
        <span className="muted tiny" style={{ alignSelf: 'center', padding: '0 6px' }}>
          {isMyTurn ? 'Place your opening pieces on the board' : 'Waiting for the other players'}
        </span>
      </div>
    );
  }

  return (
    <div className="actions">
      {isMyTurn && pending === 'roll' && (
        <button className="btn btn-primary" onClick={onRoll}>
          Roll the dice
        </button>
      )}

      <button
        className="btn"
        disabled={!inMain || !afford(BUILD_COSTS.road) || you.piecesLeft.road === 0}
        onClick={() => onBuild('road')}
        title={you.piecesLeft.road === 0 ? 'No road pieces left' : 'Build a road'}
      >
        Road <Cost cost={BUILD_COSTS.road} />
      </button>

      <button
        className="btn"
        disabled={!inMain || !afford(BUILD_COSTS.settlement) || you.piecesLeft.settlement === 0}
        onClick={() => onBuild('settlement')}
        title={you.piecesLeft.settlement === 0 ? 'No settlement pieces left' : 'Build a settlement'}
      >
        Settlement <Cost cost={BUILD_COSTS.settlement} />
      </button>

      <button
        className="btn"
        disabled={!inMain || !afford(BUILD_COSTS.city) || you.piecesLeft.city === 0 || you.settlements.length === 0}
        onClick={() => onBuild('city')}
        title={you.settlements.length === 0 ? 'You have no settlement to upgrade' : 'Upgrade a settlement'}
      >
        City <Cost cost={BUILD_COSTS.city} />
      </button>

      <button
        className="btn"
        disabled={!inMain || !afford(BUILD_COSTS.development_card) || view.devDeckSize === 0}
        onClick={onBuyDev}
        title={view.devDeckSize === 0 ? 'The development deck is empty' : `${view.devDeckSize} cards left`}
      >
        Dev card <Cost cost={BUILD_COSTS.development_card} />
      </button>

      <button className="btn" disabled={!inMain} onClick={onTrade}>
        Trade
      </button>

      <button className="btn btn-primary" disabled={!isMyTurn || (pending !== 'main' && pending !== 'build_roads')} onClick={onEndTurn}>
        End turn
      </button>
    </div>
  );
}

export type { Resource };

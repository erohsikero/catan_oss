/**
 * Browser check for upgrading a settlement to a city.
 *
 * This exists because the bug it covers was invisible to every other kind of
 * test: the engine accepted `build_city` over the wire perfectly well, and
 * only a real click revealed that the marker offering the upgrade sat inside
 * the settlement model, where a click aimed at the house missed it entirely.
 *
 * It drives the game from the state the client actually received rather than
 * by reading the DOM, and clicks computed pixels rather than hunting for
 * targets. It also trades at the bank when it has to: a randomly chosen
 * opening may never produce ore, and a test that passes or fails on dice
 * rolls is worse than no test.
 *
 *   PORT=8077 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   BASE=http://127.0.0.1:8077 CHROME_PATH=/path/to/chrome \
 *     node packages/client/test/city-upgrade.mjs
 */
import {
  bagCovers,
  BUILD_COSTS,
  legalRoadEdges,
  legalSettlementVertices,
} from '@hexhaven/shared';
import {
  clearSent,
  clickableTarget,
  clickUntilAction,
  launch,
  sentActions,
  view,
  waitForView,
} from './harness.mjs';
import { openTable } from './table.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8077';
const started = Date.now();
const { browser, page } = await launch({ base: BASE });
const me = await openTable(page, { name: 'city upgrade', bots: 3, clock: false });
const mine = JSON.stringify(me);

// Parenthesised so it can be composed into larger predicates: without the
// wrapping parens `${ourTurn}(v)` splices an arrow function into the middle
// of an expression and the whole predicate fails to parse.
const ourTurn = `((v) => v.players[v.currentPlayer].id === ${mine})`;
const button = (label) => page.locator(`.actions button:has-text("${label}")`);

// --- opening placement -----------------------------------------------------
for (let round = 0; round < 2; round++) {
  await waitForView(page, `(v) => v.pending.kind === 'setup' && v.pending.step === 'settlement' && ${ourTurn}(v)`);
  let v = await view(page);
  const corners = legalSettlementVertices(v, me, true);
  // Prefer a corner touching ore or grain, so the game reaches a city
  // without depending on luck or on a long run of bank trades.
  const score = (c) =>
    (v.board.vertexHexes[c] ?? []).reduce((n, h) => {
      const t = v.board.tileById[h];
      return n + (t.terrain === 'mountains' ? 3 : t.terrain === 'fields' ? 2 : 0) * Math.max(1, t.pips);
    }, 0);
  // Highest scoring corner that is also clear of the HUD, since the camera
  // never moves and an unreachable settlement could not be upgraded later.
  const ranked = [...corners].sort((a, b) => score(b) - score(a));
  const chosen = await clickableTarget(page, 'vertex', ranked);
  if (!chosen) throw new Error('no legal corner is clear of the HUD');
  if (!(await clickUntilAction(page, chosen.at))) throw new Error('settlement click never registered');

  await waitForView(page, `(v) => v.pending.kind === 'setup' && v.pending.step === 'road' && ${ourTurn}(v)`);
  v = await view(page);
  const road = await clickableTarget(page, 'edge', legalRoadEdges(v, me, v.pending.lastVertex));
  if (!road) throw new Error('no legal road is clear of the HUD');
  if (!(await clickUntilAction(page, road.at))) throw new Error('road click never registered');
}
await waitForView(page, `(v) => v.phase === 'play'`);
console.log(`✓ opening placed by clicking, ${((Date.now() - started) / 1000).toFixed(1)}s in`);

// --- helpers ---------------------------------------------------------------
async function clearDialogs(v) {
  if (v.pending.kind === 'discard' && v.pending.owed[me] !== undefined) {
    const submit = page.locator('.modal button:has-text("Discard")');
    for (let i = 0; i < 16 && (await submit.isDisabled()); i++) {
      const plus = page.locator('.modal .counter button:has-text("+"):not([disabled])').first();
      if (!(await plus.count())) break;
      await plus.click();
    }
    if (!(await submit.isDisabled())) await submit.click();
    return true;
  }
  if (v.pending.kind === 'move_robber' && v.players[v.currentPlayer].id === me) {
    const tiles = v.board.tiles.filter((t) => t.id !== v.robber).map((t) => t.id);
    const hex = await clickableTarget(page, 'hex', tiles);
    if (hex) await clickUntilAction(page, hex.at);
    return true;
  }
  if (v.pending.kind === 'steal' && v.players[v.currentPlayer].id === me) {
    await page.locator('.modal .score-row').first().click();
    return true;
  }
  return false;
}

/** Swaps spare resources for the grain and ore a city needs. */
async function tradeTowardsCity() {
  const trade = button('Trade');
  if (!(await trade.count()) || (await trade.isDisabled())) return false;
  await trade.click();
  const modal = page.locator('.modal:has-text("Trade")');
  await modal.waitFor({ timeout: 3000 }).catch(() => {});
  let traded = false;
  for (const want of ['Ore', 'Grain']) {
    const give = modal.locator('.pick[aria-label^="Give"]:not([disabled])').first();
    const receive = modal.locator(`.pick[aria-label="Receive ${want}"]:not([disabled])`);
    if (!(await give.count()) || !(await receive.count())) continue;
    const label = await give.getAttribute('aria-label');
    if (label?.includes(want)) continue; // never trade away what we are collecting
    await give.click();
    if (await receive.isDisabled()) continue;
    await receive.click();
    const confirm = modal.locator('button:has-text("Trade")').last();
    if (!(await confirm.isDisabled())) {
      await confirm.click();
      traded = true;
      break;
    }
  }
  const close = modal.locator('button:has-text("Close")');
  if (await close.count()) await close.click();
  return traded;
}

// --- play until a city is affordable, then upgrade by clicking -------------
let upgraded = false;
let turns = 0;
for (; turns < 160 && !upgraded; turns++) {
  await waitForView(page, `(v) => ${ourTurn}(v) || v.pending.kind === 'discard'`);
  let v = await view(page);
  if (await clearDialogs(v)) continue;
  if (v.players[v.currentPlayer].id !== me) continue;

  if (v.pending.kind === 'roll') {
    await button('Roll the dice').click();
    await waitForView(page, `(v) => v.pending.kind !== 'roll' || v.players[v.currentPlayer].id !== ${mine}`);
    v = await view(page);
    if (await clearDialogs(v)) continue;
  }
  if (v.players[v.currentPlayer].id !== me || v.pending.kind !== 'main') continue;

  const canAfford = bagCovers(v.you.resources, BUILD_COSTS.city);
  if (canAfford && v.you.settlements.length > 0 && v.you.piecesLeft.city > 0) {
    await clearSent(page);
    await button('City').click();
    const reachable = await clickableTarget(page, 'vertex', v.you.settlements);
    const target = reachable?.id ?? v.you.settlements[0];
    if (reachable) await clickUntilAction(page, reachable.at);
    await page
      .waitForFunction(() => window.__view?.you?.cities?.length > 0, null, { timeout: 5000, polling: 80 })
      .catch(() => {});
    const after = await view(page);
    const sent = await sentActions(page);
    upgraded = after.you.cities.includes(target);
    console.log(`city attempt sent ${JSON.stringify(sent.map((a) => a.type))}; cities now ${after.you.cities.length}`);
    if (upgraded) break;
  } else {
    await tradeTowardsCity();
  }

  const end = button('End turn');
  if ((await end.count()) && !(await end.isDisabled())) await end.click();
  await waitForView(page, `(v) => !(${ourTurn}(v) && v.pending.kind === 'main')`).catch(() => {});
}

console.log(upgraded ? '✓ CITY UPGRADED by clicking the board' : '✗ never upgraded');
console.log(`${turns} turns, ${((Date.now() - started) / 1000).toFixed(1)}s total`);
await browser.close();
process.exit(upgraded ? 0 : 1);

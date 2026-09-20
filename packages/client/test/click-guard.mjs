/**
 * Browser check for the placement click guard.
 *
 * Two properties, both of which a previous version of this guard broke: a
 * burst of clicks on one target must send exactly one action, and the board
 * must still accept clicks straight afterwards. An earlier attempt keyed on
 * the game's state version, which a rejected action does not advance, so a
 * single rejection wedged the board permanently.
 *
 *   PORT=8081 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   BASE=http://127.0.0.1:8081 CHROME_PATH=/path/to/chrome \
 *     node packages/client/test/click-guard.mjs
 */
import { legalSettlementVertices } from '@hexhaven/shared';
import { clearSent, clickableTarget, launch, sentActions, view, waitForView } from './harness.mjs';
import { openTable } from './table.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8081';
const started = Date.now();
const { browser, page } = await launch({ base: BASE });
const me = await openTable(page, { name: 'guard', bots: 3, clock: false });

await waitForView(page, `(v) => v.pending.kind === 'setup' && v.pending.step === 'settlement' && v.players[v.currentPlayer].id === ${JSON.stringify(me)}`);
let state = await view(page);
const corners = legalSettlementVertices(state, me, true);
if (corners.length < 2) throw new Error('need at least two legal corners to test with');

// A burst on one target that is clear of the HUD.
const chosen = await clickableTarget(page, 'vertex', corners);
if (!chosen) throw new Error('no legal corner is clear of the HUD');
const first = chosen.at;
await clearSent(page);
await page.mouse.click(first.x, first.y);
await page.mouse.click(first.x, first.y);
await page.mouse.click(first.x, first.y);
await page.waitForFunction(() => window.__sent.length > 0, null, { timeout: 4000, polling: 40 });
await page.waitForTimeout(400);
const burst = await sentActions(page);
const single = burst.length === 1 && burst[0].type === 'place_setup_settlement';
console.log(`burst of three clicks sent ${burst.length} action(s): ${JSON.stringify(burst.map((a) => a.type))}`);
console.log(single ? '✓ exactly one action sent' : '✗ duplicates sent');

// The guard must have released: the very next step has to take a click.
await waitForView(page, `(v) => v.pending.kind === 'setup' && v.pending.step === 'road'`);
state = await view(page);
const placed = state.pending.lastVertex;
const edges = state.board.edges.filter(
  (e) => !state.roads[e] && e.split('|').every((h) => placed.split('|').includes(h)),
);
const edge = edges[0];
await clearSent(page);
const roadChoice = await clickableTarget(page, 'edge', [edge]);
if (!roadChoice) throw new Error('the road target is behind the HUD');
await page.mouse.click(roadChoice.at.x, roadChoice.at.y);
await page.waitForFunction(() => window.__sent.length > 0, null, { timeout: 4000, polling: 40 });
const after = await sentActions(page);
const responsive = after.some((a) => a.type === 'place_setup_road');
console.log(responsive ? '✓ board still responsive right after the burst' : '✗ board wedged');

console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await browser.close();
process.exit(single && responsive ? 0 : 1);

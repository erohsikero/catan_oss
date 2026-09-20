/**
 * Checks that the harness can hit what it aims at.
 *
 * The other browser tests click computed pixels rather than searching for
 * targets, which is fast but silently wrong if the scene's camera ever
 * changes. This takes a few seconds and fails immediately and legibly when
 * that happens, instead of leaving the slower tests to time out with no
 * explanation.
 *
 *   PORT=8084 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   BASE=http://127.0.0.1:8084 CHROME_PATH=/path/to/chrome \
 *     node packages/client/test/projection.mjs
 */
import { clearSent, clickableTarget, clickUntilAction, launch, sentActions, view, waitForView } from './harness.mjs';
import { legalSettlementVertices } from '@hexhaven/shared';

const BASE = process.env.BASE;
const t0 = Date.now();
const { browser, page } = await launch({ base: BASE });
await page.fill('#room-name', 'proj');
await page.click('text=Create table');
await page.waitForSelector('text=At the table');
await page.click('#clock-enabled');
await page.waitForFunction(() => !document.querySelector('#clock-enabled').checked, null, { polling: 100 });
for (let i = 0; i < 3; i++) { await page.click('text=Add a bot'); await page.waitForTimeout(120); }
await page.click('text=Start the game');

const me = await page.evaluate(() => window.__view.you.id);
await waitForView(page, `(v) => v.phase === 'setup' && v.pending.kind === 'setup' && v.pending.step === 'settlement' && v.players[v.currentPlayer].id === ${JSON.stringify(me)}`);
const v = await view(page);
const targets = legalSettlementVertices(v, me, true);
console.log(`our turn after ${((Date.now()-t0)/1000).toFixed(1)}s; ${targets.length} legal corners`);

const choice = await clickableTarget(page, 'vertex', targets);
if (!choice) throw new Error('no legal corner is clear of the HUD');
const { id: target, at } = choice;
console.log(`target ${target} projects to (${at.x}, ${at.y}), clear of the HUD`);
await clearSent(page);
const t1 = Date.now();
const attempts = await clickUntilAction(page, at);
const sent = await sentActions(page);
console.log('action sent:', JSON.stringify(sent));
const ok = sent.length === 1 && sent[0].type === 'place_setup_settlement' && sent[0].vertex === target;
console.log(
  ok
    ? `✓ the computed pixel hit the intended corner (${attempts} click${attempts === 1 ? '' : 's'}, ${Date.now() - t1}ms)`
    : '✗ the computed pixel did not reach the intended corner',
);
await browser.close();
process.exit(ok ? 0 : 1);

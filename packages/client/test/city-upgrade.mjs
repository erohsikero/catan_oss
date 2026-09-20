/**
 * Browser check for upgrading a settlement to a city.
 *
 * This is here because the bug it covers was invisible to every other kind
 * of test: the engine accepted `build_city` over the wire perfectly well,
 * and only a real click revealed that the marker offering the upgrade sat
 * *inside* the settlement model, where a click aimed at the house missed it.
 *
 * It plays the opening by clicking the board, takes turns until a city is
 * affordable, then upgrades by clicking - the exact flow a player follows.
 *
 *   PORT=8077 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   BASE=http://127.0.0.1:8077 CHROME_PATH=/path/to/chrome \
 *     node packages/client/test/city-upgrade.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:8077';

// Plays through the real UI until a city is affordable, then upgrades by
// clicking the marker on the board - the exact flow that was failing.
import pw from 'playwright-core';
const { chromium } = pw;
import fs from 'node:fs';
const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

await page.fill('#room-name', 'city ui');
await page.click('text=Create table');
await page.waitForSelector('text=At the table');
// No clock: this test is slow on a software renderer and must not be
// raced by the server playing for us.
// The checkbox is controlled by server state, so the click and the
// re-render are a round trip apart; wait for the state rather than assert it.
await page.click('#clock-enabled');
for (let i = 0; i < 40; i++) {
  if (!(await page.locator('#clock-enabled').isChecked())) break;
  await page.waitForTimeout(150);
}
if (await page.locator('#clock-enabled').isChecked()) throw new Error('could not disable the clock');
console.log('✓ clock disabled for this test');
for (let i = 0; i < 3; i++) { await page.click('text=Add a bot'); await page.waitForTimeout(150); }
await page.click('text=Start the game');
await page.waitForTimeout(1500);

const banner = () => page.evaluate(() => document.querySelector('.turn-banner')?.textContent ?? '');
const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const btn = (label) => page.locator(`.actions button:has-text("${label}")`);

// Clicks around the board until `done` reports success.
async function sweep(done, label) {
  for (let ring = 0; ring < 13; ring++) {
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2;
      const rad = 30 + ring * 27;
      const x = Math.round(720 + Math.cos(ang) * rad * 1.35);
      const y = Math.round(430 + Math.sin(ang) * rad * 0.8);
      if (x < 60 || x > 1380 || y < 90 || y > 760) continue;
      await page.mouse.click(x, y);
      await page.waitForTimeout(70);
      if (await done()) { console.log(`  ${label}: hit at (${x}, ${y})`); return true; }
    }
  }
  return false;
}

// --- opening placement -------------------------------------------------
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 80; i++) { if ((await banner()).includes('You: place a settlement')) break; await page.waitForTimeout(300); }
  if (!(await banner()).includes('You: place a settlement')) break;
  await sweep(async () => (await banner()).includes('place a road'), `settlement ${round + 1}`);
  await sweep(async () => !(await banner()).includes('place a road'), `road ${round + 1}`);
}
console.log('✓ opening placement done via clicks');

// --- play turns until a city is affordable ------------------------------
let cityEnabled = false;
for (let turn = 0; turn < 120 && !cityEnabled; turn++) {
  if (await btn('Roll the dice').count()) { await btn('Roll the dice').click(); await page.waitForTimeout(400); }
  // A seven can interrupt with a discard dialog; take the default.
  if (await page.locator('.modal:has-text("Discard half")').count()) {
    const submit = page.locator('.modal button:has-text("Discard")');
    for (let i = 0; i < 15 && (await submit.isDisabled()); i++) {
      // Only some counters can be raised; pick whichever is still enabled.
      const plus = page.locator('.modal .counter button:has-text("+"):not([disabled])').first();
      if (!(await plus.count())) break;
      await plus.click();
      await page.waitForTimeout(60);
    }
    if (!(await submit.isDisabled())) { await submit.click(); await page.waitForTimeout(400); }
  }
  if ((await banner()).includes('Move the robber')) await sweep(async () => !(await banner()).includes('Move the robber'), 'robber');
  if (await page.locator('.modal:has-text("Choose someone to rob")').count()) {
    await page.locator('.modal .score-row').first().click(); await page.waitForTimeout(300);
  }
  cityEnabled = (await btn('City').count()) > 0 && !(await btn('City').isDisabled());
  if (cityEnabled) break;
  if (await btn('End turn').count()) {
    const b = btn('End turn');
    if (!(await b.isDisabled())) { await b.click(); await page.waitForTimeout(250); }
  }
  for (let i = 0; i < 60; i++) {
    if (await btn('Roll the dice').count()) break;
    await page.waitForTimeout(250);
  }
}

if (!cityEnabled) { console.log('✗ never reached an affordable city'); await browser.close(); process.exit(1); }
console.log('✓ City button became enabled');

const citiesBefore = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.player-card')].find((c) => c.textContent.includes('(you)'));
  return el ? el.textContent : '';
});
await btn('City').click();
await page.waitForTimeout(300);
console.log('  action bar now:', await page.evaluate(() => document.querySelector('.actions')?.textContent));

const upgraded = await sweep(async () => (await page.evaluate(() => document.querySelector('.log-body')?.textContent ?? '')).includes('upgrades to a city'), 'city');
await page.screenshot({ path: `${OUT}/after.png` });
const t = await toast();
console.log(upgraded ? '✓ CITY UPGRADED by clicking the board' : `✗ city upgrade failed${t ? ' — toast: ' + t : ''}`);
console.log('before:', citiesBefore.replace(/\s+/g, ' '));
if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(upgraded ? 0 : 1);

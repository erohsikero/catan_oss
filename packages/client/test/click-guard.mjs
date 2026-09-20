/**
 * Browser check for the placement click guard.
 *
 * Two properties, both of which have been broken by a previous attempt at
 * this guard: a burst of clicks on one target must send exactly one action,
 * and the board must still accept clicks straight afterwards. An earlier
 * version keyed on the game's state version, which a rejected action does
 * not advance, so one rejection wedged the board permanently.
 *
 *   PORT=8081 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &
 *   BASE=http://127.0.0.1:8081 CHROME_PATH=/path/to/chrome \
 *     node packages/client/test/click-guard.mjs
 */
// Fast check of the click guard: a burst of clicks on one placement target
// must produce exactly one action, and the board must still accept clicks
// immediately afterwards.
import pw from 'playwright-core';
const { chromium } = pw;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8081';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  window.__sent = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const m = JSON.parse(d); if (m.t === 'action') window.__sent.push(m.action); } catch {}
    return send.call(this, d);
  };
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#room-name', 'guard');
await page.click('text=Create table');
await page.waitForSelector('text=At the table');
await page.click('#clock-enabled');
for (let i = 0; i < 40; i++) { if (!(await page.locator('#clock-enabled').isChecked())) break; await page.waitForTimeout(150); }
for (let i = 0; i < 3; i++) { await page.click('text=Add a bot'); await page.waitForTimeout(150); }
await page.click('text=Start the game');
await page.waitForTimeout(1500);

const banner = () => page.evaluate(() => document.querySelector('.turn-banner')?.textContent ?? '');
const sent = () => page.evaluate(() => window.__sent.slice());
for (let i = 0; i < 80; i++) { if ((await banner()).includes('You: place a settlement')) break; await page.waitForTimeout(300); }
if (!(await banner()).includes('You: place a settlement')) { console.log('never got our turn'); process.exit(1); }

const points = [];
for (let ring = 0; ring < 13; ring++) {
  for (let a = 0; a < 20; a++) {
    const ang = (a / 20) * Math.PI * 2, rad = 30 + ring * 27;
    const x = Math.round(720 + Math.cos(ang) * rad * 1.35), y = Math.round(430 + Math.sin(ang) * rad * 0.8);
    if (x >= 60 && x <= 1380 && y >= 90 && y <= 760) points.push([x, y]);
  }
}

let hit = null;
for (const [x, y] of points) {
  await page.evaluate(() => { window.__sent.length = 0; });
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  await page.waitForTimeout(450);
  const actions = await sent();
  if (actions.length > 0) { hit = { x, y, actions }; break; }
}
if (!hit) { console.log('no marker found'); process.exit(1); }
console.log(`triple-click produced ${hit.actions.length} action(s): ${JSON.stringify(hit.actions.map((a) => a.type))}`);
console.log(hit.actions.length === 1 ? '✓ exactly one action sent' : '✗ duplicates sent');
console.log('banner now:', (await banner()).slice(0, 70));

await page.evaluate(() => { window.__sent.length = 0; });
let advanced = false;
for (const [x, y] of points) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(70);
  if (!(await banner()).includes('place a road')) { advanced = true; break; }
}
console.log(advanced ? '✓ board still responsive right after the burst' : '✗ board wedged');
console.log('second phase actions:', JSON.stringify((await sent()).map((a) => a.type)));
await browser.close();
process.exit(hit.actions.length === 1 && advanced ? 0 : 1);

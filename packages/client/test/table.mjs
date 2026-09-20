/** Creating a table is identical in every browser test; do it in one place. */
export async function openTable(page, { name = 'test', bots = 3, clock = false } = {}) {
  await page.waitForSelector('#room-name');
  await page.fill('#room-name', name);
  await page.click('text=Create table');
  await page.waitForSelector('text=At the table');
  if (!clock) {
    await page.click('#clock-enabled');
    await page.waitForFunction(() => !document.querySelector('#clock-enabled')?.checked, null, {
      polling: 100,
    });
  }
  for (let i = 0; i < bots; i++) {
    await page.click('text=Add a bot');
    await page.waitForFunction((n) => (window.__view?.players?.length ?? 0) >= n, i + 2, {
      polling: 80,
    });
  }
  await page.click('text=Start the game');
  await page.waitForFunction(() => window.__view?.phase === 'setup', null, { polling: 80 });
  return page.evaluate(() => window.__view.you.id);
}

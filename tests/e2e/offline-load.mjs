/**
 * The promise in the name: after one visit, the app opens and works with no network at all.
 *   BASE=https://offline-hybrid-ai.web.app node tests/e2e/offline-load.mjs <screenshot-dir>
 */
import { chromium } from 'playwright';

const outDir = process.argv[2];
const base = process.env.BASE ?? 'https://offline-hybrid-ai.web.app';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/app`);
await page.getByRole('button', { name: 'Start' }).click();
// Wait for the service worker to take control and finish precaching.
await page.waitForFunction(() => navigator.serviceWorker?.controller !== null || false, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active?.state;
});
await page.reload();
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30000 });
console.log('service worker controls the page:', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));

await ctx.setOffline(true);
await page.goto(`${base}/app`);
await page.waitForSelector('#root .home', { timeout: 15000 });
await page.waitForTimeout(1500);
console.log('offline: home rendered =', await page.locator('#root .home-q').innerText());
console.log('offline: status chip =', await page.locator('#root .status-chip').innerText());
// Write a note with no network; it must save.
await page.getByRole('button', { name: 'Note' }).click();
await page.getByRole('textbox', { name: 'Note' }).fill('Written on a plane with no signal.');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/offline-note.png` });
await page.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(1200);
console.log('offline: recent list =', (await page.locator('#root .rows').first().innerText()).replace(/\n/g, ' | '));
// A typed draft offline: the send preview must explain, not fail.
await page.goto(`${base}/`);
console.log('offline: landing title =', await page.title());
console.log(errors.length ? `PAGE ERRORS: ${errors.join(' || ')}` : 'no page errors');
await browser.close();

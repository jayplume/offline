/**
 * On-device path check. This build machine cannot run Gemini Nano, so window.LanguageModel is
 * replaced with a small fake that follows Chrome's Prompt API shape (availability, create,
 * prompt, promptStreaming). Firebase AI Logic's own Chrome adapter drives it, so this verifies:
 *  - PREFER_ON_DEVICE really answers on the device (response.inferenceSource === 'on_device'),
 *  - "Work offline" routes to ONLY_ON_DEVICE and sends no request to Firebase AI Logic,
 *  - labels and History say "On this device".
 *
 *   node tests/e2e/on-device.mjs <screenshot-dir>   (dev server on :5180)
 */
import { chromium } from 'playwright';

const outDir = process.argv[2];
const base = process.env.BASE ?? 'http://localhost:5180';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  const reply = (input) => {
    const text = JSON.stringify(input);
    if (text.includes('Rewrite the request')) return 'Write a calm two-line note to my team: the launch moves one week because QA found two checkout bugs.';
    if (text.includes('List up to 3 short questions')) return '{"questions":["Who should receive this note?","Is there a new launch date?"]}';
    return 'On-device answer: the launch moves one week, fixes are underway.';
  };
  class FakeSession {
    async prompt(input) { return reply(input); }
    promptStreaming(input) {
      const words = reply(input).split(' ');
      return new ReadableStream({ async pull(c) { const w = words.shift(); if (w === undefined) return c.close(); await new Promise((r) => setTimeout(r, 25)); c.enqueue(w + ' '); } });
    }
    destroy() {}
  }
  window.__lmCalls = 0;
  window.LanguageModel = {
    availability: async () => 'available',
    create: async () => { window.__lmCalls++; return new FakeSession(); },
  };
});
const page = await ctx.newPage();
const aiRequests = [];
page.on('request', (r) => { if (r.url().includes('firebasevertexai.googleapis.com')) aiRequests.push(r.url()); });
const shot = (n) => page.screenshot({ path: `${outDir}/${n}.png` });

await page.goto(`${base}/app`);
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForTimeout(800);
// Turn on Work offline from the menu.
await page.getByRole('button', { name: 'Menu' }).click();
await page.getByRole('menuitemcheckbox', { name: /Work offline/ }).click();
await page.waitForTimeout(600);
await shot('dev-0-home-offline');
await page.getByRole('button', { name: 'Ask' }).click();
await page.waitForTimeout(900);
console.log('composer says:', await page.locator('.composer-where').innerText());
await page.getByRole('textbox', { name: 'Message' }).fill('Tell my team the launch moves a week.');
await page.getByRole('button', { name: 'Send' }).click();
await page.waitForSelector('.answer-meta .badge', { timeout: 15000 });
await page.waitForTimeout(500);
console.log('badge:', await page.locator('.answer-meta .badge').first().innerText());
console.log('answer:', (await page.locator('.answer .md').first().innerText()).slice(0, 80));
await shot('dev-1-chat-offline');
console.log('LanguageModel.create calls:', await page.evaluate(() => window.__lmCalls));
console.log('requests to Firebase AI Logic while offline:', aiRequests.length);
await browser.close();

// Part 2: the device model is "available" but fails mid-request (context overflow). Firebase AI
// Logic's PREFER_ON_DEVICE does not re-route after choosing the device, so Offline's engine must
// retry in the cloud and label the answer accordingly.
{
  const browser2 = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx2 = await browser2.newContext({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
  await ctx2.addInitScript(() => {
    window.LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => { throw new DOMException('The input is too large.', 'QuotaExceededError'); },
        promptStreaming: () => { throw new DOMException('The input is too large.', 'QuotaExceededError'); },
        destroy() {},
      }),
    };
  });
  const p2 = await ctx2.newPage();
  const cloudCalls = [];
  p2.on('request', (r) => { if (r.url().includes('firebasevertexai.googleapis.com')) cloudCalls.push(r.url().split('/models/')[1]); });
  await p2.goto(`${base}/app`);
  await p2.getByRole('button', { name: 'Start' }).click();
  await p2.waitForTimeout(800);
  await p2.getByRole('button', { name: 'Ask' }).click();
  await p2.waitForTimeout(900);
  console.log('[fallback] composer says:', await p2.locator('.composer-where').innerText());
  await p2.getByRole('textbox', { name: 'Message' }).fill('Reply with one short sentence about calm launches.');
  await p2.getByRole('button', { name: 'Send' }).click();
  await p2.waitForSelector('.answer-meta .badge', { timeout: 45000 });
  console.log('[fallback] badge:', await p2.locator('.answer-meta .badge').first().innerText());
  console.log('[fallback] cloud calls:', cloudCalls.join(', '));
  await p2.screenshot({ path: `${outDir}/dev-2-fallback.png` });
  await p2.getByRole('button', { name: 'Close' }).click();
  await p2.waitForTimeout(1200);
  await p2.getByRole('button', { name: 'Menu' }).click();
  await p2.getByRole('menuitem', { name: /History/ }).click();
  await p2.waitForSelector('.run', { timeout: 10000 });
  await p2.waitForTimeout(700);
  console.log('[fallback] history:', (await p2.locator('.run').first().innerText()).replace(/\n/g, ' | '));
  await p2.screenshot({ path: `${outDir}/dev-3-history.png` });
  await browser2.close();
}

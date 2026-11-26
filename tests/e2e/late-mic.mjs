/**
 * Privacy regression: if the microphone permission is answered only after the person chose
 * "Type it instead", no recording may start, and the microphone must be released at once.
 *   node tests/e2e/late-mic.mjs   (dev server on :5180)
 */
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:5180';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 880 } });
await ctx.addInitScript(() => {
  window.__mr = 0;
  window.__liveTracks = () => (window.__streams || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
  const start = MediaRecorder.prototype.start;
  MediaRecorder.prototype.start = function (...a) { window.__mr++; return start.apply(this, a); };
  navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) =>
      setTimeout(() => {
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        (window.__streams ||= []).push(dest.stream);
        resolve(dest.stream);
      }, 8000),
    );
});
const page = await ctx.newPage();
await page.goto(`${base}/app`);
await page.getByRole('button', { name: 'Start' }).click();
await page.getByRole('button', { name: 'Record a thought' }).click();
await page.waitForSelector('#root .slow-start', { timeout: 9000 });
await page.getByRole('button', { name: 'Type it instead' }).click();
await page.waitForTimeout(5000); // the "permission" is granted while the person is typing
const result = await page.evaluate(async () => {
  const req = indexedDB.open('offline');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const drafts = await new Promise((r) => { const q = dbh.transaction('drafts').objectStore('drafts').getAll(); q.onsuccess = () => r(q.result); });
  return { mediaRecorderStarts: window.__mr, liveMicTracks: window.__liveTracks(), activeRecordingDrafts: drafts.filter((d) => d.recordingActive).length };
});
console.log(JSON.stringify(result));
console.log(result.mediaRecorderStarts === 0 && result.liveMicTracks === 0 && result.activeRecordingDrafts === 0 ? 'PASS: no hidden recording' : 'FAIL');
await browser.close();

/**
 * End-to-end check of the core flow with a fake microphone:
 * record → save on device → transcribe (Firebase AI Logic, cloud) → tap-to-play sentences.
 *
 *   node tests/e2e/record.mjs <speech.wav> <screenshot-dir>   (dev server on :5180, App Check debug token)
 *
 * Headless Chrome on macOS hangs on getUserMedia even with --use-fake-device-for-media-stream, so the
 * "microphone" here is the WAV played through Web Audio into a MediaStream. Everything after
 * getUserMedia (MediaRecorder, level meter, IndexedDB, WAV re-encoding, Gemini) is the real code path.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [wav, outDir] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:5180';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 });
await ctx.route('**/__fixture.wav', (route) => route.fulfill({ body: readFileSync(wav), contentType: 'audio/wav' }));
await ctx.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext();
    await ac.resume();
    const buf = await ac.decodeAudioData(await (await fetch('/__fixture.wav')).arrayBuffer());
    const src = ac.createBufferSource();
    src.buffer = buf;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    src.start();
    return dest.stream;
  };
});
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const t = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t) / 1000).toFixed(1)}s]`, ...a);

await page.goto(`${base}/app`);
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForTimeout(700);
await shot('0-home');
await page.getByRole('button', { name: 'Record a thought' }).click();
await page.waitForSelector('#root .state-recording', { timeout: 15000 });
log('recording started');
await page.waitForTimeout(2500);
await shot('1-recording');
await page.waitForTimeout(7000);
await page.getByRole('button', { name: 'Stop and save' }).click();
await page.waitForSelector('#root .tool-draft', { timeout: 15000 });
await page.waitForTimeout(900);
log('saved; draft open');
await shot('2-draft-audio');
const stored = await page.evaluate(async () => {
  const req = indexedDB.open('offline');
  const dbh = await new Promise((r, j) => ((req.onsuccess = () => r(req.result)), (req.onerror = j)));
  const get = (store) => new Promise((r) => { const q = dbh.transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); });
  const drafts = await get('drafts');
  const audio = await get('audio');
  return { drafts: drafts.map((d) => ({ title: d.title, hasAudio: d.hasAudio, durationMs: d.durationMs, mime: d.audioMime, recordingActive: d.recordingActive })), audioBytes: audio.map((a) => a.blob.size) };
});
log('stored on device:', JSON.stringify(stored));
// Chrome's MediaRecorder WebM has no duration in its header (the reason AudioCard forces a scan).
const durations = await page.evaluate(async () => {
  const req = indexedDB.open('offline');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const blob = await new Promise((r) => { const q = dbh.transaction('audio').objectStore('audio').getAll(); q.onsuccess = () => r(q.result[0].blob); });
  const a = new Audio(URL.createObjectURL(blob));
  await new Promise((r) => a.addEventListener('loadedmetadata', r, { once: true }));
  const before = a.duration;
  await new Promise((r) => { a.addEventListener('durationchange', r, { once: true }); a.currentTime = 1e101; });
  return { reportedOnLoad: String(before), afterScan: a.duration };
});
log('webm duration:', JSON.stringify(durations));
await page.getByRole('button', { name: 'Transcribe with Gemini' }).click();
await page.waitForSelector('#root .editor-text', { timeout: 90000 });
log('transcript:', JSON.stringify(await page.locator('#root .editor-text').inputValue()));
await page.waitForTimeout(600);
await shot('3-transcribed');
await page.getByRole('button', { name: 'Show sentences' }).click();
await page.waitForTimeout(600);
await shot('4-sentences');
const sentences = await page.locator('#root .sentence').allInnerTexts();
log('sentences:', JSON.stringify(sentences));
console.log(problems.length ? `CONSOLE ERRORS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();

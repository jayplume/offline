/**
 * Renders the app icons and the social image from SVG/HTML with headless Chrome, so every
 * graphic in /public is reproducible from source:  node scripts/make-assets.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const figtree = readFileSync(require.resolve('@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2')).toString('base64');
const font = `@font-face{font-family:F;src:url(data:font/woff2;base64,${figtree}) format('woff2');font-weight:100 900}`;

const mark = (ring = '#fff') => `<circle cx="16" cy="16" r="15" fill="#9dd4f4"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="${ring}" stroke-width="2.2" opacity=".9"/><circle cx="16" cy="16" r="4" fill="#1b232b"/>`;

const icons = [
  // Standard icon: the mark on white, rounded by the platform.
  ['icons/icon-192.png', 192, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#fff"/><g transform="translate(3 3) scale(.8125)">${mark()}</g></svg>`],
  ['icons/icon-512.png', 512, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#fff"/><g transform="translate(3 3) scale(.8125)">${mark()}</g></svg>`],
  // Maskable: full-bleed sky, mark inside the 80% safe zone.
  ['icons/icon-maskable-512.png', 512, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#9dd4f4"/><circle cx="16" cy="16" r="7.2" fill="none" stroke="#fff" stroke-width="1.8" opacity=".95"/><circle cx="16" cy="16" r="3" fill="#1b232b"/></svg>`],
  ['apple-touch-icon.png', 180, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#fff"/><g transform="translate(4 4) scale(.75)">${mark()}</g></svg>`],
  // Shortcut icons: record (sky, microphone) and note (ash, pen line).
  ['icons/shortcut-record.png', 96, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#9dd4f4"/><g fill="none" stroke="#1b232b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(4.8 4.8) scale(.6)"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></g></svg>`],
  ['icons/shortcut-note.png', 96, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#eceff2"/><g fill="none" stroke="#1b232b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(4.8 4.8) scale(.6)"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></g></svg>`],
];

const og = `<!doctype html><html><head><style>${font}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;font-family:F;color:#1b232b;background:#fff;overflow:hidden;position:relative}
.glow{position:absolute;right:-180px;top:-140px;width:900px;height:900px;border-radius:50%;background:radial-gradient(closest-side,#e3f3fd,#f3faff 60%,rgba(255,255,255,0))}
.l{position:absolute;left:80px;top:84px;width:660px}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:30px;letter-spacing:-.02em}
h1{margin:46px 0 0;font-size:70px;line-height:1;letter-spacing:-.045em;font-weight:650}
p{margin:26px 0 0;font-size:24px;line-height:1.45;color:#4d5864;max-width:600px}
.chips{display:flex;gap:10px;margin-top:34px}.chips span{padding:9px 16px;border-radius:99px;font-size:18px;font-weight:600;box-shadow:inset 0 0 0 1.5px #dde2e7;color:#4d5864;background:#fff}
.phone{position:absolute;right:120px;top:70px;width:300px;height:620px;border-radius:46px;background:#fff;box-shadow:0 0 0 1px #dde2e7,0 0 0 9px #fff,0 0 0 10px #dde2e7,0 40px 80px -30px rgba(43,116,181,.5);overflow:hidden}
.scr{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 55%,#e3f3fd,#f3faff 55%,#fff)}
.notch{position:absolute;top:12px;left:107px;width:86px;height:22px;border-radius:12px;background:#1b232b}
.t{position:absolute;top:96px;width:100%;text-align:center;font-size:44px;font-weight:300;letter-spacing:-.03em}
.st{position:absolute;top:156px;width:100%;text-align:center;font-size:13px;font-weight:600;color:#4d5864}.st i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3c8dd0;margin-right:7px}
.orb{position:absolute;top:200px;left:60px;width:180px;height:180px}.orb b{position:absolute;border-radius:50%}
.r3{inset:0;background:rgba(157,212,244,.16)}.r2{inset:11%;background:rgba(157,212,244,.3)}.r1{inset:22%;background:rgba(157,212,244,.55)}.c{inset:32%;background:#9dd4f4}
.cap{position:absolute;top:404px;left:26px;right:26px;text-align:center;font-size:15px;line-height:1.5}
</style></head><body><div class="glow"></div>
<div class="l"><div class="brand"><svg width="40" height="40" viewBox="0 0 32 32">${mark()}</svg>Offline</div>
<h1>Say it now. Send it when you choose.</h1>
<p>Private voice prompts, saved on your device. Shaped by Gemini Nano on the device; the cloud only when you press Send.</p>
<div class="chips"><span>Firebase AI Logic</span><span>Hybrid inference</span><span>Works offline</span></div></div>
<div class="phone"><div class="scr"></div><div class="notch"></div><div class="t">0:07</div><div class="st"><i></i>Recording, saved on this device</div>
<div class="orb"><b class="r3"></b><b class="r2"></b><b class="r1"></b><b class="c"></b></div>
<div class="cap">tell the team we're pushing the launch a week because QA found two checkout bugs</div></div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
for (const [path, size, svg] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/${path}`, omitBackground: false });
}
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og);
await page.waitForTimeout(300);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log(`wrote ${icons.length} icons and og.png`);

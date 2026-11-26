# Engineering notes

These are the problems we hit while building Offline on Firebase AI Logic hybrid inference (web, `firebase@13.4.0` / `@firebase/ai@3.1.0`, Chrome 156–157), and how we solved each one. Every item was reproduced during the build; file references point at the fix.

## 1. Enabling the AI Logic provider from the CLI wasn't enough: 403 `USER_PROJECT_DENIED`

**What happened.** We set the project up entirely from the Firebase CLI (15.37). The `ailogic` and `appcheckadmin` commands are hidden until you set `FIREBASE_CLI_EXPERIMENTS=ailogic,appcheckadmin`. `firebase ailogic:providers:enable gemini-developer-api` reported success: it enabled `firebasevertexai.googleapis.com` and `generativelanguage.googleapis.com`. But every call to the AI Logic proxy (`firebasevertexai.googleapis.com/v1beta/projects/<p>/models/gemini-3.5-flash-lite:generateContent`), with a valid App Check token, returned:

```
403 PERMISSION_DENIED, reason USER_PROJECT_DENIED, service generativelanguage.googleapis.com
"Caller does not have required permission to use project … Grant the caller the roles/serviceusage.serviceUsageConsumer role"
```

**Fix.** Run the app-level provisioning call as well: `provisionFirebaseApp` with `firebaseAiLogicInput: {}`, which is what `firebase init ailogic` does. About 30 seconds later the same request returned 200. Enabling the provider turns the APIs on; provisioning connects the app to them.

**Open question.** Should `ailogic:providers:enable` provision the app too, or print that `init ailogic` is still required?

## 2. `PREFER_ON_DEVICE` doesn't fall back to the cloud after an on-device failure

**What we found.** In `callCloudOrDevice` (`@firebase/ai` 3.1.0), `PREFER_ON_DEVICE` calls `chromeAdapter.isAvailable(request)` *once*. If the device is chosen and `session.prompt()` then throws (for example a `QuotaExceededError` when the input overflows Gemini Nano's context, or the model is evicted), the error propagates. There is no cloud fallback at that point. `PREFER_IN_CLOUD` *does* fall back to the device for `FETCH_ERROR`, `ERROR` and `API_NOT_ENABLED`.

**Fix.** [`engine.ts`](../src/lib/ai/engine.ts) tells the two failure types apart (Chrome throws `DOMException`s; cloud errors are `AIError`s). When the route allowed the cloud, it retries with an `ONLY_IN_CLOUD` model. The answer is labelled *Cloud (device failed)* and History records why. `tests/e2e/on-device.mjs` forces a `QuotaExceededError` from a stand-in `LanguageModel` and checks this path end to end.

**Open question.** Is a runtime fallback planned for `PREFER_ON_DEVICE`, or is wrapping it the intended pattern?

## 3. Audio parts and the on-device path

**What we found.**

- `ChromeAdapterImpl.isOnDeviceRequest` accepts `inlineData` only for `image/jpeg` and `image/png`, so audio silently goes to the cloud under `PREFER_ON_DEVICE`.
- Under `ONLY_ON_DEVICE`, `isAvailable()` doesn't call `isOnDeviceRequest`. An audio part reaches `toLanguageModelMessageContent`, which converts *every* `inlineData` with `createImageBitmap`, and fails with an image-decoding error rather than "audio isn't supported".
- Chrome's Prompt API *does* accept audio (`expectedInputs: [{ type: 'audio' }]`, with Blob or AudioBuffer values, GPU required).

**Fix.** The routing policy never sends audio on-device: transcription is always `ONLY_IN_CLOUD`. The offline path for speech is Chrome's on-device Web Speech API (`SpeechRecognition.available({ langs, processLocally: true })`, confirmed in Chrome 156), used only with `processLocally`, so audio never goes to the server recognizer.

**Open question.** Will audio `inlineData` be mapped to the Prompt API's `{ type: 'audio' }` content in a future SDK?

## 4. Multi-turn chat on the device

**What we found.** The hybrid docs list multi-turn chat as not supported on-device. In the SDK, the Chrome adapter creates a **new `LanguageModel` session for every request** and passes the request's `contents` as role-mapped messages (`model` becomes `assistant`). So a request that carries the conversation does run on the device, but each turn re-creates the session and re-reads the whole history, inside a 9,216-token budget.

**Fix.** [`prompts.ts`](../src/lib/ai/prompts.ts) `packHistory` sends the newest turns that fit a character budget (Remote Config `device_char_budget` on the device, much larger in the cloud), always starting on a user turn. When the conversation outgrows the device budget, Automatic routing hands it to the cloud.

**Open question.** Is sending history as `contents` on the device supported going forward, and is session reuse for chats planned?

## 5. Chrome's WebM recordings: no duration, and not on Gemini's audio list

**What happened.**

- `MediaRecorder` in Chrome writes WebM/Opus with no duration in the header. In our e2e run, the stored recording reported `audio.duration === Infinity` on `loadedmetadata`, and 9.84 s only after a forced scan. Seeking for tap-a-sentence was unreliable until then.
- WebM isn't on Gemini's documented audio formats.

**Fix.**

- **Playback** ([`AudioCard.tsx`](../src/app/ui/AudioCard.tsx)): seek to `1e101` once to force Chrome to scan the file, then return to 0. The timeline uses our own recorded duration.
- **Transcription** ([`wav.ts`](../src/lib/audio/wav.ts)): decode with an `OfflineAudioContext` created at 16 kHz, so `decodeAudioData` decodes *and* resamples in one step. Then encode 16-bit mono WAV (32 KB per second) and send it in 120-second chunks (Remote Config) to stay well under the inline request size.
- **Timing:** each chunk returns `{start, end, text}` segments through `responseJsonSchema`. We offset them back to the whole clip and sanitize them: clamp to the chunk, keep the order, spread by length if a model returns no times.

## 6. The first `AudioContext` froze the page for a second, so the open animation never showed

**What happened.** Tapping Record opened the recording screen with no visible motion: it simply appeared. A trace in Chrome showed one **2,053 ms long task** starting about 40 ms after the tap. Wrapping the constructors pinned it down: the first `new AudioContext()` took **1,046 ms** (Chrome opening the audio device on the main thread); a second one took 71 ms. `new MediaRecorder()` took 1 ms and `start()` 3 ms. The opening animation was a WAAPI `clip-path` animation, which runs on the main thread, and its timeline kept moving while the page was blocked. By the first painted frame it was already finished. A second, smaller problem: its easing was front-loaded (half size at 0.14 s, 80% at 0.25 s), so even unblocked it read as a jump.

**Fix.**

- The level meter, the only thing that needs an `AudioContext`, moved out of `Recorder.start()` into `startMeter()`. It is called through `afterMotion()`, once the screen has finished opening ([`recorder.ts`](../src/lib/audio/recorder.ts), [`Record.tsx`](../src/app/surfaces/Record.tsx)). Recording itself starts at once: `MediaRecorder` needs no `AudioContext`.
- The animation's clock now advances by **at most 34 ms per frame** and starts on the first frame that is actually painted. A stalled frame pauses the motion; it can never skip it.

## 7. The genie: bending a live page without a screenshot API

**What we wanted.** Every page, sheet and menu pours out of the control you tapped, like a window leaving the Dock, and pours back into it on close.

**The problem.** The web has no API to snapshot DOM into a texture. `clip-path` can only mask a page, not bend it; `html2canvas`-style rasterizing is slow and loses fonts; View Transitions give one flat image per element.

**What we built** ([`genie.ts`](../src/app/ui/genie.ts), unit-tested in [`genie.test.ts`](../src/app/ui/__tests__/genie.test.ts)):

- The live element stays in place, invisible but laid out and focusable. On top of it, **up to 40 horizontal slices**, each holding a DOM clone of the element offset to its band.
- Each slice is mapped onto a trapezoid with a **projective `matrix3d`**: the square-to-quad homography (Heckbert), pre-scaled from pixels to the unit square. Neighbouring trapezoids share edges, so the outline is a smooth curve, and the content inside really bends. Rows next to the tap start 42% later than the far edge, which gives the funnel.
- **Copies are cheap.** Anything entirely off screen is emptied but keeps its box (so nothing on screen moves). Ids and form `name`s are stripped, so a cloned radio button can't uncheck the real one. Scroll positions are restored on every copy. Inside copies, animations, transitions and `will-change` are switched off. With them on, 40 copies of a pulsing button dropped headless Chrome to a few frames per second. Building 40 slices takes **1–16 ms**.
- **Copies wait for the content.** A page that loads saved data on mount would pour out empty. A `MutationObserver` waits until the element has been quiet for 60 ms (at most 320 ms) before the copies are taken.
- **`line-height` must be carried over as a ratio.** The copy lives outside the element's parent, so inherited styles are copied from `getComputedStyle`. That *resolves* `line-height: 1.5` to `18px`, and every heading inside then inherited 18 px instead of 1.5 × its own size. Copies laid out 10–25 px shorter than the real page, and a double image showed at the end. We now set the ratio, `lineHeight / fontSize`.
- A small sheet opened from a button far away was stretched over the whole screen. The trailing edge is now dragged along once the shape is **1.35×** its own height, so it travels as a teardrop instead.

## 8. iPhone Safari crashed opening long pages during the genie

**What happened.** On an iPhone, opening a long chat or a recording from the home screen ended in Safari's "a problem occurred" page; short pages (Record, Note, Ask) were fine. The genie draws up to 40 copies of the page. Each page's scrolling area uses `-webkit-overflow-scrolling: touch`, and Safari gives every scrolling area its own compositing layer, sized to everything inside it. Across 40 copies of a long chat, that is far more memory than a phone allows, so the page process was killed. Our Chrome-only testing never saw it.

**Fix** ([`genie.ts`](../src/app/ui/genie.ts)):

- Inside the copies, every scrolling area becomes a plain clipped box (`overflow: hidden`) at the same scroll position. Nothing tall is left to composite.
- Touch devices get at most 24 slices.
- A failure while building the motion now gets out of the way and shows the page, and each page is wrapped in an error boundary, so a problem on one page can't blank the app.

Verified in WebKit with iPhone emulation: a 24-message chat opens with 24 slices, about 2,000 copied elements in all, and every scroller flattened.

## 9. Desktop never got new versions, and a fix that deadlocked

**What happened.** Phones showed new features; desktop Chrome kept the old build. With the "prompt" update style, a new service worker waits until *every* tab and installed window of the app has closed; a reload is not enough. On a desktop that keeps a tab open, that can be never.

**Fix:**

- The service worker now takes over at once (`skipWaiting`, `clientsClaim`).
- An extra script, [`sw-update.js`](../public/sw-update.js), tells each open window about the new version. Windows on this version or later answer, then reload if nothing is open, or offer a reload if a page is open. Windows on an older version can't answer, so they are reloaded once.
- Open tabs check for updates when you return to them, and every half hour.

**The deadlock.** The first version waited for those reloads inside the `activate` event. Page requests wait for an *activated* worker, so activation waited for the reload and the reload waited for activation: the tab sat on a blank page. The reloads now start only after activation has finished.

Tested with four builds in Chrome and WebKit: an old tab updates about 3 seconds after reopening; an idle tab updates in about 1.3 seconds; a tab with a note open keeps the note and offers a reload; a first visit never reloads.

## 10. Safari Private Browsing refused to store recordings

**What happened.** In a private WebKit session, storing a `Blob` in IndexedDB fails (and reports no useful error name), so a recording made in Safari Private Browsing couldn't be saved.

**Fix** ([`db.ts`](../src/lib/db.ts)): if storing the Blob fails, the same audio is stored as an `ArrayBuffer` with its type, and turned back into a Blob when read. Verified in a private WebKit session: the recording saved as bytes and the draft shows its length.

## More we ran into

- **SDK v13 `Part` types need a discriminator.** `{ text }` no longer type-checks as a `Part`; it must be `{ type: 'text', text }` (and `{ type: 'inlineData', … }`). Runtime still accepts the old shape through `assignPartType`.
- **`thinkingConfig: { thinkingBudget: 0 }` returns `400 INVALID_ARGUMENT`** on `gemini-3.5-flash-lite`. It doesn't think by default anyway (`thoughtsTokenCount: 0`). Warm requests take about 0.9 s; the first one about 3.7 s.
- **App Check debug token hygiene.** Vite loads `.env.local` in *every* mode, so the debug token lives in `.env.development.local` and the build is grepped for it. The App Check SDK also prints the debug token to the console in development.
- **App Check is only on the cloud path.** `getAppCheckToken()` runs in the cloud request builder, so on-device inference works offline even when reCAPTCHA can't load. The token is warmed at idle when online, so the first cloud answer doesn't pay for reCAPTCHA set-up.
- **Remote Config deploys replace the whole template.** Our project is shared with another app, so we checked the live template was empty before `firebase deploy --only remoteconfig`.
- **Headless Chrome on macOS hangs on `getUserMedia`** even with `--use-fake-device-for-media-stream`. The e2e test feeds a WAV through Web Audio into a `MediaStream` instead; everything after `getUserMedia` is the real path.
- **pnpm + vite-plugin-pwa 2 + Vite 8 (Rolldown):** `virtual:pwa-register/react` imports `workbox-window`, which must be a direct dependency.

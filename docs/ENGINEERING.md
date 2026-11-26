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

## More we ran into

- **SDK v13 `Part` types need a discriminator.** `{ text }` no longer type-checks as a `Part`; it must be `{ type: 'text', text }` (and `{ type: 'inlineData', … }`). Runtime still accepts the old shape through `assignPartType`.
- **`thinkingConfig: { thinkingBudget: 0 }` returns `400 INVALID_ARGUMENT`** on `gemini-3.5-flash-lite`. It doesn't think by default anyway (`thoughtsTokenCount: 0`). Warm requests take about 0.9 s; the first one about 3.7 s.
- **App Check debug token hygiene.** Vite loads `.env.local` in *every* mode, so the debug token lives in `.env.development.local` and the build is grepped for it. The App Check SDK also prints the debug token to the console in development.
- **App Check is only on the cloud path.** `getAppCheckToken()` runs in the cloud request builder, so on-device inference works offline even when reCAPTCHA can't load. The token is warmed at idle when online, so the first cloud answer doesn't pay for reCAPTCHA set-up.
- **Remote Config deploys replace the whole template.** Our project is shared with another app, so we checked the live template was empty before `firebase deploy --only remoteconfig`.
- **Headless Chrome on macOS hangs on `getUserMedia`** even with `--use-fake-device-for-media-stream`. The e2e test feeds a WAV through Web Audio into a `MediaStream` instead; everything after `getUserMedia` is the real path.
- **pnpm + vite-plugin-pwa 2 + Vite 8 (Rolldown):** `virtual:pwa-register/react` imports `workbox-window`, which must be a direct dependency.

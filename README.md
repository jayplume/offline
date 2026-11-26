# Offline

**Say it now. Send it when you choose.**

Offline is a private voice-to-AI app. It records the prompts you'd rather not say to an assistant out loud, even with no signal. It keeps them on your device, helps you shape them (on the device with Gemini Nano when Chrome has it), and runs them with Gemini only when you press Send.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) on **Firebase AI Logic hybrid inference**. Platform: **Web (Chrome)**, installable as a PWA.

- **Try it:** https://offline-hybrid-ai.web.app (app at [/app](https://offline-hybrid-ai.web.app/app))
- **Licence:** Apache 2.0

---

## Why it exists

Voice is becoming the fastest way to prompt AI, but two moments get in the way:

1. **You can't talk out loud.** You're in a corridor after a meeting, in a library, or on a quiet train, and speaking to an assistant in front of people feels wrong.
2. **You have no signal.** You're on a flight, in a basement on a site visit, or anywhere the connection drops.

The thought arrives anyway. Offline catches it privately, keeps it on the device, and lets you finish it later, on your terms. Reconnecting never sends anything by itself.

## What it does

| Step | What happens | Where it runs |
| --- | --- | --- |
| **Capture** | One tap starts recording. Audio is saved to IndexedDB as you speak (checkpointed every few seconds, so even a closed tab keeps it). | Always on the device |
| **Captions** | Live captions while you speak, using Chrome's *on-device* speech recognition (`processLocally`). Offline never uses the server recognizer. | On the device, when Chrome has the speech pack |
| **Transcribe** | If there were no captions, one tap sends *that recording only* to Gemini. | Cloud, through Firebase AI Logic (audio isn't an on-device input in hybrid inference) |
| **Shape** | Edit, *Make it clearer*, *Ask me what's missing*, templates, tone, length, a "What I meant" note. Every rewrite is a version, and the original is never overwritten. | Hybrid: on the device when Gemini Nano is ready, otherwise the cloud |
| **Send** | A preview shows the exact text and where it will run. Then the answer streams in, labelled **On this device** or **Cloud**. | Hybrid |
| **Notes** | One tap to a blank page. Summaries are hybrid; long local-only notes are summarized in parts *on the device*. | Hybrid |
| **Follow up** | After each answer, two or three suggested follow-ups pop up as bubbles. Tap one and it goes into the box to edit; nothing is sent for you. Uses only the last exchange; off in Settings. | Hybrid (structured output on both paths) |
| **Export** | An *Export this conversation* bubble is always there, and the same choices sit in the chat's ⋯ menu: as it was, for a cofounder, for a teammate, or meeting notes. Save as PDF or Markdown, copy, or share to another app. | Rewrites are hybrid; files are made on the device |

## How it uses Firebase AI Logic hybrid inference

Every AI call goes through `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })` from `firebase/ai` ([`src/lib/ai/engine.ts`](src/lib/ai/engine.ts)). A small, unit-tested routing policy ([`src/lib/ai/route.ts`](src/lib/ai/route.ts)) chooses the `InferenceMode` *before* anything is sent, from things the SDK can't know:

| Situation | Mode requested | Why |
| --- | --- | --- |
| Item marked **Keep on this device only** | `ONLY_ON_DEVICE` (or AI waits) | Privacy is per item, not just a global setting |
| **No connection** or **Work offline** on | `ONLY_ON_DEVICE` (or the draft waits, saved) | Never attempt a request that can't work |
| **Audio** (transcription) | `ONLY_IN_CLOUD` | On-device input in hybrid inference is text and images |
| **Long input** (over `device_char_budget`) | `ONLY_IN_CLOUD`, or chunked on-device summaries when local-only | Gemini Nano's budget is 9,216 tokens |
| Setting **Cloud first** | `PREFER_IN_CLOUD` | Quality first, device as fallback |
| Everything else | `PREFER_ON_DEVICE` | The hybrid default |

On top of the SDK, the engine:

- reads **`response.inferenceSource`** on every answer and shows it as a label, and logs every request (mode asked, where it ran, model, latency) to **History**;
- **retries in the cloud when the device fails mid-answer**. `PREFER_ON_DEVICE` checks availability up front only, so a runtime failure such as a context overflow would otherwise just throw. The answer is then labelled *Cloud (device failed)*;
- **packs chat history** into each request within the on-device budget, because the SDK runs on-device inference one request per Prompt API session;
- **transcribes audio in chunks**: Chrome's WebM/Opus is decoded and resampled to 16 kHz mono WAV with an `OfflineAudioContext`, then sent in 120-second parts (Remote Config) with timed segments, so tapping a sentence plays that moment.

Other Firebase products:

- **App Check** (required by AI Logic, and enforced): reCAPTCHA Enterprise in production; a debug token only on the dev server.
- **Remote Config**: cloud and transcription models, the on-device budget, chunk size and the prompt templates ([`remoteconfig.template.json`](remoteconfig.template.json)), with in-code defaults when offline.
- **Firebase Hosting**: the live site.

## All 30 features

**Capture:** one-tap recording · shortcuts (Record, New note from the installed icon; **R** key) · always-visible recording state · pause and resume · stop after silence (off by default, three-second warning) · choose your microphone · low-storage warning.

**Without a connection:** on-device live captions · audio-only drafts · a live "What works right now" sheet · on-device model status and one-tap download · prompt clean-up on the device · nothing sends itself on reconnect (and the app says so) · retry on every failed step.

**Shaping:** editable transcript · tap a sentence to hear it · "What I meant" note · templates from Remote Config · Make it clearer · Ask me what's missing · tone and length · versions with a word-level compare · send preview with the exact text and destination.

**Added since:** follow-up suggestions after each answer, and export (as it was, for a cofounder, for a teammate, or meeting notes; PDF, Markdown, copy or share).

**Privacy and control:** On this device / Cloud label on every AI result · delete the audio, the text, or everything · automatic audio deletion · app lock (WebAuthn device unlock or PIN) · asks before playing aloud without headphones · "Keep on this device only" per draft, chat or note · History of every AI request.

## Run it yourself

Requirements: Node 20+, pnpm, a Firebase project, and the Firebase CLI (`npx firebase-tools`).

```bash
pnpm install
```

1. Create a web app and copy its config:

   ```bash
   npx firebase-tools apps:create WEB "Offline Web"
   npx firebase-tools apps:sdkconfig WEB <app-id>
   ```

   Put the values in `.env.local` (see [`.env.example`](.env.example)).

2. Enable Firebase AI Logic with the Gemini Developer API (free tier). In the console, open **AI Logic → Get started**, or use the CLI:

   ```bash
   FIREBASE_CLI_EXPERIMENTS=ailogic npx firebase-tools ailogic:providers:enable gemini-developer-api
   npx firebase-tools init ailogic
   ```

3. App Check (AI Logic requires it):
   - **Development:** `npx firebase-tools appcheck:debugtokens:create --app <app-id>`, then put the token in `.env.development.local` as `VITE_APPCHECK_DEBUG_TOKEN`. Vite loads that file for the dev server only, so it can never reach a production build.
   - **Production:** create a reCAPTCHA Enterprise *score* key for your domains, set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, and register it as the App Check provider.

4. Run:

   ```bash
   pnpm dev          # http://localhost:5180/app
   pnpm test         # unit tests (routing policy, prompts, audio, text, the genie's geometry)
   pnpm build && npx firebase-tools deploy --only hosting,remoteconfig
   ```

### On-device AI in Chrome

On-device AI needs desktop Chrome 139 or later with the built-in Prompt API, on hardware that meets Chrome's requirements: 16 GB of RAM or a GPU with more than 4 GB of VRAM, and about 22 GB of free disk for the one-time model download.

1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and set it to **Enabled** (Firebase's hybrid guide asks for this flag). If **Gemma 4 for built-in AI** is listed, enable it too: the Firebase team suggested it for the newer model, and also confirmed that Chrome's current Nano model counts when it is used through Firebase AI Logic.
2. Restart Chrome. `chrome://on-device-internals` shows which model Chrome has.
3. Open the app and tap the status chip (top right). **What works right now** shows whether the model is available, downloadable (with a Download button), or unavailable on this device.

## Tests

- `pnpm test`: 40 unit tests for the routing policy, prompt assembly, history packing, transcript timing, WAV encoding, text helpers, follow-up parsing, exports, and the genie's geometry (slices meet exactly, never fold, and land on the page).
- `tests/e2e/record.mjs`: records through MediaRecorder (fed by a Web Audio "microphone"), saves to IndexedDB, transcribes through Firebase AI Logic and checks the timed sentences.
- `tests/e2e/on-device.mjs`: drives Firebase AI Logic's Chrome adapter with a stand-in `LanguageModel`. It checks that on-device answers report `inferenceSource: on_device`, that **Work offline** makes zero requests to Firebase AI Logic, and that a device failure falls back to the cloud with the right label.
- `tests/e2e/offline-load.mjs`: after one visit, the live site opens and saves notes with the network switched off.
- `tests/e2e/late-mic.mjs`: if the microphone permission is answered only after the person chose to type instead, no recording starts and the microphone is released.

## Honest limits

- On-device AI depends on the device. Without Gemini Nano, AI steps need a connection (and your Send). The app says so instead of failing silently.
- Turning a saved recording into text uses the cloud. Live captions are the offline path, and only where Chrome has its on-device speech pack.
- App lock keeps casual eyes out; it does not encrypt IndexedDB.

## Project layout

```
src/lib/ai/route.ts      hybrid routing policy (pure, unit-tested)
src/lib/ai/engine.ts     every Firebase AI Logic call, inferenceSource, fallback, transcription
src/lib/ai/prompts.ts    prompt assembly, schemas shared by cloud and on-device structured output
src/lib/firebase.ts      App, App Check, AI, Remote Config
src/lib/db.ts            IndexedDB (Dexie): drafts, audio, chats, notes, history, settings
src/lib/audio/*          recorder, WAV encoding
src/lib/speech.ts        on-device live captions (Web Speech API, processLocally only)
src/lib/export.ts        exports: Markdown, PDF through the print dialog, files and the share sheet
src/app/*                the app: surfaces, sheets, menus
src/app/ui/genie.ts      the genie: every page, sheet and menu pours out of the control you tapped
src/landing/*            the site at /
scripts/make-assets.mjs  renders icons and the social image from source
```

More: [docs/ENGINEERING.md](docs/ENGINEERING.md) (problems we hit and how we solved them).

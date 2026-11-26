# Devpost submission text

Copy each section into the matching Devpost field.

**Project name:** Offline

**Tagline:** Say it now. Send it when you choose. Private voice prompts that work with no signal, shaped on-device, sent only when you say so.

**Platform:** Web (Chrome)

**Links:**
- Try it: https://offline-hybrid-ai.web.app
- Code: https://github.com/jayplume/offline
- Video: (YouTube link)

---

## Inspiration

Prompting AI by voice is becoming the fastest way to think out loud, but two everyday moments get in the way. Sometimes you can't talk out loud: in a corridor after a meeting, in a library, on a quiet train. And sometimes there's no signal: on a flight, or in a basement on a site visit. The thought arrives anyway. We wanted a place to say it privately, right then, and send it to AI later, on our own terms.

## What it does

Offline is a private voice-to-AI app built on Firebase AI Logic hybrid inference.

- **Capture.** One tap and you're recording. Audio is saved on the device while you speak, and live captions come from Chrome's on-device speech recognition when available.
- **Shape.** Fix the words, *Make it clearer*, answer *what's missing*, pick a template, tone and length, or add a "What I meant" note. When Chrome's Gemini Nano is ready, this all happens on the device, offline. Every rewrite is a version; the original is never overwritten.
- **Send when you choose.** A preview shows the exact text and where it will run (on this device, or Gemini in the cloud) before anything leaves. Reconnecting never sends anything by itself, and the app tells you so.
- **Know where it ran.** Every answer is labelled *On this device* or *Cloud*, and History logs each request: the mode asked for, where it actually ran, the model and the latency.
- **Stay in control.** Keep any recording, chat or note on this device only. Delete the audio, the text, or everything. Set recordings to delete themselves, add an app lock, and get asked before anything plays out loud without headphones.

**Value:** the thoughts you can't say out loud, or can't send right now, stop getting lost. And privacy is something you can check, not a promise you have to trust.

## How we built it

- **Firebase AI Logic hybrid inference** (`firebase/ai` 13.4). Every AI call goes through `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`. A unit-tested routing policy chooses the `InferenceMode` per task from what the SDK can't know on its own:
  - per-item "device only" → `ONLY_ON_DEVICE`
  - no connection or *Work offline* → `ONLY_ON_DEVICE`, or wait
  - audio → `ONLY_IN_CLOUD`
  - long input → cloud, or on-device map-reduce summaries when local-only
  - otherwise → `PREFER_ON_DEVICE`

  `response.inferenceSource` labels every answer.
- **Our layer on top of the SDK:**
  - a cloud retry when the device fails mid-answer (`PREFER_ON_DEVICE` only checks availability up front);
  - chat history packed within Gemini Nano's 9,216-token budget;
  - shared JSON schemas for structured output on both paths (`responseJsonSchema` in the cloud, `responseConstraint` on the device);
  - chunked cloud transcription of 16 kHz WAV with timed sentences, so tapping a sentence plays that moment.
- **App Check** with reCAPTCHA Enterprise in production (enforced for AI Logic) and a debug token on the dev server only. **Remote Config** for model names, budgets and prompt templates. **Firebase Hosting**. All provisioned from the Firebase CLI.
- **Web platform:** React 19, Vite 8, TypeScript 7, Dexie (IndexedDB) with crash-safe recording checkpoints, MediaRecorder and Web Audio, the Web Speech API with `processLocally`, WebAuthn for the app lock, and a Workbox service worker so the app opens with no network.
- **Design:** one tool on screen at a time. Recording and chats open with a slow circular reveal from the point you tapped; options live behind the three-dot menu; cancel sits top right. The palette is sky blue, soft blue, ash and white.

## Challenges we ran into

- Enabling the AI Logic provider from the CLI wasn't enough: the proxy returned `403 USER_PROJECT_DENIED` until the app was also provisioned (what `firebase init ailogic` does).
- `PREFER_ON_DEVICE` doesn't fall back after an on-device runtime failure, so we built and tested that fallback.
- Audio isn't an on-device input in hybrid inference, and under `ONLY_ON_DEVICE` an audio part is decoded as an image. We moved offline speech to Chrome's on-device Web Speech API.
- Chrome's MediaRecorder WebM reports `Infinity` duration and isn't on Gemini's audio list. We decode and resample to WAV in one step with an `OfflineAudioContext` and chunk long recordings.
- Testing on-device AI on a machine that can't run Gemini Nano: we drove the SDK's own Chrome adapter with a stand-in `LanguageModel`.

Details: [docs/ENGINEERING.md](https://github.com/jayplume/offline/blob/main/docs/ENGINEERING.md)

## Accomplishments that we're proud of

- A routing policy that makes hybrid inference visible and honest: you always know where your words will go, and where they went.
- All 30 features we set out to build work, including tap-a-sentence playback, versions with word-level compare, and per-item "device only".
- After one visit, the app opens and saves with no network at all (tested against the live site).

## What we learned

Hybrid inference is most valuable when the *person* can see and steer it. "On-device when available" isn't enough on its own: people need to know what works offline on *their* device, and to trust that reconnecting won't send anything by itself.

## What's next

- On-device transcription once audio parts are supported in the hybrid SDK.
- Android and iOS clients with the same routing policy (Gemini Nano on Android, Apple Foundation Models on iOS).
- Optional end-to-end-encrypted sync between your own devices.

## Built with

firebase-ai-logic, gemini, gemini-nano, chrome-built-in-ai, firebase-app-check, firebase-remote-config, firebase-hosting, react, typescript, vite, indexeddb, dexie, pwa, web-speech-api, webauthn

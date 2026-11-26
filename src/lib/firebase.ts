/**
 * Firebase bootstrap: App, App Check (required by Firebase AI Logic), Remote Config and the AI service.
 *
 * Offline-first rules this module follows:
 * - Nothing here blocks the UI. The app must open, record and save with no network at all.
 * - App Check only matters for cloud calls. On-device inference never asks for a token
 *   (verified in @firebase/ai 3.1.0: getAppCheckToken() runs only on the cloud request path).
 * - Remote Config falls back to in-code defaults when it cannot fetch.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import {
  fetchAndActivate,
  getRemoteConfig,
  getValue,
  type RemoteConfig,
} from 'firebase/remote-config';

export interface PromptTemplate {
  id: string;
  label: string;
  instruction: string;
}

export interface RuntimeConfig {
  cloudModel: string;
  transcribeModel: string;
  deviceCharBudget: number;
  transcribeChunkSeconds: number;
  templates: PromptTemplate[];
  /** Where these values came from, shown in Settings so the source is never a mystery. */
  source: 'defaults' | 'remote' | 'cached';
}

export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  { id: 'email', label: 'Write an email', instruction: "Turn this into a clear email. Start with a subject line, then the body. Keep the sender's intent and facts." },
  { id: 'meeting', label: 'Summarize a meeting', instruction: 'Summarize this as key points, decisions, and action items. Name an owner for each action when one is mentioned.' },
  { id: 'plan', label: 'Make a plan', instruction: 'Turn this into a short step-by-step plan, ordered by priority, with rough timing.' },
  { id: 'brainstorm', label: 'Brainstorm', instruction: 'Give eight varied ideas, then point out the two strongest and say why in one line each.' },
  { id: 'explain', label: 'Explain simply', instruction: 'Explain this clearly for someone new to the topic, with one concrete example.' },
  { id: 'reply', label: 'Reply to a message', instruction: 'Draft a reply that answers every point raised, in the same language as the request.' },
];

const DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite',
  transcribe_model: 'gemini-3.5-flash-lite',
  device_char_budget: 14000,
  transcribe_chunk_seconds: 120,
  prompt_templates: JSON.stringify(DEFAULT_TEMPLATES),
};

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export type AppCheckMode = 'recaptcha-enterprise' | 'debug-token' | 'not-configured';

interface FirebaseHandles {
  app: FirebaseApp;
  ai: AI;
  appCheck: AppCheck | null;
  appCheckMode: AppCheckMode;
  remoteConfig: RemoteConfig | null;
}

let handles: FirebaseHandles | null = null;
let runtime: RuntimeConfig = readRuntime(null, 'defaults');
const listeners = new Set<(c: RuntimeConfig) => void>();

declare global {
  // Read by the App Check SDK before initializeAppCheck(). Dev builds only.
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

function setupAppCheck(app: FirebaseApp): { appCheck: AppCheck | null; mode: AppCheckMode } {
  // The debug token lives in .env.development.local, which Vite loads for the dev server only,
  // so a production bundle can never contain it.
  const debugToken = import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (debugToken) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }
  if (!siteKey && !debugToken) return { appCheck: null, mode: 'not-configured' };
  try {
    // With a debug token set, the SDK swaps the provider for its debug provider automatically.
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-only'),
      isTokenAutoRefreshEnabled: true,
    });
    return { appCheck, mode: debugToken ? 'debug-token' : 'recaptcha-enterprise' };
  } catch (err) {
    console.warn('[offline] App Check could not start', err);
    return { appCheck: null, mode: 'not-configured' };
  }
}

export function getFirebase(): FirebaseHandles | null {
  if (handles) return handles;
  if (!isFirebaseConfigured) return null;
  const app = initializeApp(firebaseConfig);
  const { appCheck, mode } = setupAppCheck(app);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  let remoteConfig: RemoteConfig | null = null;
  try {
    remoteConfig = getRemoteConfig(app);
    remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 30 * 60_000;
    remoteConfig.settings.fetchTimeoutMillis = 8_000;
    remoteConfig.defaultConfig = DEFAULTS;
  } catch (err) {
    console.warn('[offline] Remote Config unavailable', err);
  }
  handles = { app, ai, appCheck, appCheckMode: mode, remoteConfig };
  if (remoteConfig) runtime = readRuntime(remoteConfig, 'cached');
  return handles;
}

function readRuntime(rc: RemoteConfig | null, source: RuntimeConfig['source']): RuntimeConfig {
  const str = (k: keyof typeof DEFAULTS) => (rc ? getValue(rc, k).asString() : String(DEFAULTS[k])) || String(DEFAULTS[k]);
  const num = (k: keyof typeof DEFAULTS) => {
    const v = rc ? getValue(rc, k).asNumber() : Number(DEFAULTS[k]);
    return Number.isFinite(v) && v > 0 ? v : Number(DEFAULTS[k]);
  };
  let templates = DEFAULT_TEMPLATES;
  try {
    const parsed = JSON.parse(str('prompt_templates')) as PromptTemplate[];
    if (Array.isArray(parsed) && parsed.every((t) => t.id && t.label && t.instruction)) templates = parsed;
  } catch {
    /* keep defaults */
  }
  // A value that never came from the server is a default, whatever we asked for.
  const fromServer = rc ? getValue(rc, 'cloud_model').getSource() === 'remote' : false;
  return {
    cloudModel: str('cloud_model'),
    transcribeModel: str('transcribe_model'),
    deviceCharBudget: num('device_char_budget'),
    transcribeChunkSeconds: num('transcribe_chunk_seconds'),
    templates,
    source: fromServer ? (source === 'defaults' ? 'cached' : source) : 'defaults',
  };
}

/** Fetches Remote Config in the background. Safe to call offline: failures keep the last values. */
export async function refreshRuntimeConfig(): Promise<RuntimeConfig> {
  const h = getFirebase();
  if (!h?.remoteConfig) return runtime;
  try {
    await fetchAndActivate(h.remoteConfig);
    runtime = readRuntime(h.remoteConfig, 'remote');
  } catch {
    runtime = readRuntime(h.remoteConfig, 'cached');
  }
  listeners.forEach((l) => l(runtime));
  return runtime;
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtime;
}

export function onRuntimeConfig(cb: (c: RuntimeConfig) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

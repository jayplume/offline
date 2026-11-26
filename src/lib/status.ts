/**
 * Live "what works right now" status: connectivity (actually probed, not just navigator.onLine),
 * the on-device model, on-device speech, App Check and storage. One small external store that
 * React reads with useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';
import type { DeviceModel } from './ai/route';
import { getDeviceModelStatus } from './ai/engine';
import { getFirebase, getRuntimeConfig, isFirebaseConfigured, onRuntimeConfig, refreshRuntimeConfig, type AppCheckMode, type RuntimeConfig } from './firebase';
import { onDeviceSpeechStatus, type SpeechStatus } from './speech';
import { storageStatus } from './audio/recorder';

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface Status {
  mic: MicPermission;
  online: boolean;
  browserOnline: boolean;
  device: DeviceModel;
  deviceProgress: number | null;
  speech: SpeechStatus;
  appCheck: AppCheckMode;
  configured: boolean;
  runtime: RuntimeConfig;
  storage: { usage: number; quota: number; free: number; low: boolean; persisted: boolean | null };
  checkedAt: number;
}

let status: Status = {
  mic: 'unknown',
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  device: 'unsupported',
  deviceProgress: null,
  speech: 'unsupported',
  appCheck: 'not-configured',
  configured: isFirebaseConfigured,
  runtime: getRuntimeConfig(),
  storage: { usage: 0, quota: 0, free: 0, low: false, persisted: null },
  checkedAt: 0,
};

const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function setStatus(patch: Partial<Status>): void {
  status = { ...status, ...patch };
  emit();
}

export function getStatus(): Status {
  return status;
}

export function useStatus(): Status {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => status,
    () => status,
  );
}

/** A real reachability check: a tiny no-store request to our own origin. */
async function probe(): Promise<boolean> {
  if (!navigator.onLine) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`/ping.txt?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let speechLang = 'en-US';
export function setSpeechLang(lang: string): void {
  speechLang = lang;
}

async function micPermission(): Promise<MicPermission> {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return p.state as MicPermission;
  } catch {
    return 'unknown';
  }
}

export async function refreshStatus(): Promise<Status> {
  const [online, device, speech, storage, mic] = await Promise.all([probe(), getDeviceModelStatus(), onDeviceSpeechStatus(speechLang), storageStatus(), micPermission()]);
  const fb = getFirebase();
  setStatus({
    mic,
    online,
    browserOnline: navigator.onLine,
    device,
    speech,
    storage,
    appCheck: fb?.appCheckMode ?? 'not-configured',
    configured: isFirebaseConfigured,
    checkedAt: Date.now(),
  });
  return status;
}

let started = false;

/** Starts background status updates. Safe to call more than once. */
export function startStatusWatch(): void {
  if (started) return;
  started = true;
  getFirebase();
  onRuntimeConfig((runtime) => setStatus({ runtime }));
  const refresh = () => void refreshStatus().then((s) => (s.online ? refreshRuntimeConfig() : undefined));
  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => setStatus({ online: false, browserOnline: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void refreshStatus();
  }, 30_000);
  refresh();
}

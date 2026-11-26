import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Mic, ShieldCheck, Sparkles } from 'lucide-react';
import { SurfaceHost, SurfaceProvider, useSurface, type SurfaceSpec } from './ui/Surface';
import { installTapTracker } from './ui/tap';
import { ToastProvider, useToast } from './ui/Toast';
import { Sheet } from './ui/Sheet';
import { Home } from './Home';
import { LockScreen } from './Lock';
import { RecordSurface } from './surfaces/Record';
import { DraftSurface } from './surfaces/Draft';
import { ChatSurface } from './surfaces/Chat';
import { NoteSurface } from './surfaces/Note';
import { LibrarySurface } from './surfaces/Library';
import { HistorySurface } from './surfaces/History';
import { SettingsSurface } from './surfaces/Settings';
import { setSetting, useSettings } from './settings';
import { applyAudioRetention, db, recoverInterruptedRecordings } from '../lib/db';
import { setSpeechLang, startStatusWatch, refreshStatus, useStatus } from '../lib/status';

function render(spec: SurfaceSpec) {
  switch (spec.kind) {
    case 'record':
      return <RecordSurface />;
    case 'draft':
      return <DraftSurface id={spec.id!} fresh={spec.params?.fresh === '1'} focus={spec.params?.focus === '1'} />;
    case 'chat':
      return <ChatSurface id={spec.id ?? 'new'} />;
    case 'note':
      return <NoteSurface id={spec.id ?? 'new'} />;
    case 'library':
      return <LibrarySurface tab={spec.params?.tab} />;
    case 'history':
      return <HistorySurface />;
    case 'settings':
      return <SettingsSurface />;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <SurfaceProvider>
        <Shell />
      </SurfaceProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { settings, ready } = useSettings();
  const { open, current } = useSurface();
  const toast = useToast();
  const [locked, setLocked] = useState<boolean | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const lastActive = useRef(Date.now());
  const shortcutDone = useRef(false);

  // Start-up: where taps land (for the genie), live status, recover interrupted recordings.
  useEffect(() => {
    installTapTracker();
    startStatusWatch();
    void recoverInterruptedRecordings().then((n) => {
      if (n) toast(n === 1 ? 'Recovered 1 interrupted recording' : `Recovered ${n} interrupted recordings`);
    });
  }, [toast]);

  useEffect(() => {
    if (!ready) return;
    setSpeechLang(settings.speechLang);
    void refreshStatus();
    void applyAudioRetention(settings.audioRetention);
    const t = window.setInterval(() => void applyAudioRetention(settings.audioRetention), 10 * 60_000);
    return () => window.clearInterval(t);
  }, [ready, settings.speechLang, settings.audioRetention]);

  // Reconnecting never sends anything. Say so wherever the person is, whenever the connection
  // (or "Work offline") comes back and drafts are waiting.
  const status = useStatus();
  const connected = status.online && !settings.workOffline;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (!ready) return;
    if (!wasConnected.current && connected) {
      void db.drafts
        .filter((d) => !d.lastRunAt && !d.recordingActive)
        .count()
        .then((n) => {
          if (n) toast(`Back online. ${n === 1 ? '1 draft is' : `${n} drafts are`} waiting, and nothing was sent.`);
        });
    }
    wasConnected.current = connected;
  }, [connected, ready, toast]);

  // App lock: on start, and after the chosen idle time or time away.
  useEffect(() => {
    if (!ready || locked !== null) return;
    setLocked(settings.lock.method !== 'none');
  }, [ready, settings.lock.method, locked]);

  useEffect(() => {
    if (settings.lock.method === 'none') {
      if (locked) setLocked(false);
      return;
    }
    const limit = settings.lock.autoLockMinutes * 60_000;
    const touch = () => (lastActive.current = Date.now());
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > limit) setLocked(true);
    };
    const idle = window.setInterval(() => {
      // Never lock in the middle of a recording.
      if (Date.now() - lastActive.current > limit && !document.querySelector('#root .tool-record')) setLocked(true);
    }, 15_000);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(idle);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [settings.lock.method, settings.lock.autoLockMinutes, locked]);

  // Shortcuts from the installed app icon (manifest shortcuts): /app?do=record and /app?do=note.
  useEffect(() => {
    if (!ready || locked !== false || shortcutDone.current) return;
    shortcutDone.current = true;
    const action = new URLSearchParams(window.location.search).get('do');
    if (!action) return;
    window.history.replaceState(null, '', '/app');
    // No tap to pour out of: the record button (for Record) or the bottom of the screen.
    if (action === 'record') open({ kind: 'record' });
    if (action === 'note') open({ kind: 'note', id: 'new' });
  }, [ready, locked, open]);

  // Keyboard: R records from the home screen; Escape acts like the surface's cancel button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      // #root: the genie's copies (outside it) look like menus and pages but are only pictures.
      if (e.key === 'Escape' && current && !document.querySelector('.sheet-root, #root .menu')) {
        document.querySelector<HTMLButtonElement>('#root .surface-layer .surface-step:not(.is-leaving) .surface-bar .bar-right button')?.click();
      }
      if (!current && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'r' || e.key === 'R') && locked === false) {
        document.querySelector<HTMLButtonElement>('#root .record-btn')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, locked]);

  const unlock = useCallback(() => {
    lastActive.current = Date.now();
    setLocked(false);
  }, []);

  if (!ready || locked === null) return <div className="boot" aria-busy="true" />;
  if (locked) return <LockScreen lock={settings.lock} onUnlock={unlock} />;

  return (
    <>
      <Home onLock={() => setLocked(true)} />
      <SurfaceHost render={render} />
      <Welcome open={!settings.onboarded} onDone={() => void setSetting('onboarded', true)} />
      <UpdatePrompt />
    </>
  );
}

function Welcome({ open, onDone }: { open: boolean; onDone: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onDone}
      label="Welcome to Offline"
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={onDone} data-autofocus>
          Start
        </button>
      }
    >
      <div className="welcome">
        <h2>Say it now. Send it when you choose.</h2>
        <ul>
          <li>
            <Mic aria-hidden />
            <span>Record a thought anywhere, even with no signal. It's saved on this device as you speak.</span>
          </li>
          <li>
            <Sparkles aria-hidden />
            <span>Shape it into a clear prompt. When Chrome's on-device model is ready, AI runs right here.</span>
          </li>
          <li>
            <ShieldCheck aria-hidden />
            <span>Nothing goes to the cloud until you press Send, and you see exactly what goes and where.</span>
          </li>
        </ul>
      </div>
    </Sheet>
  );
}

function UpdatePrompt() {
  const toast = useToast();
  // A page that opened under a service worker can be updated; a first visit is already current.
  const startedControlled = useRef(typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller));
  const {
    offlineReady: [offlineReady],
  } = useRegisterSW({
    // Open tabs and installed windows check for a new version when you come back to them, and
    // every half hour, so a desktop that never closes the app still gets updates.
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => void reg.update().catch(() => {});
      window.setInterval(check, 30 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
  useEffect(() => {
    if (offlineReady) toast('Offline is ready to open without a connection');
  }, [offlineReady, toast]);

  // A new version has taken over (public/sw-update.js asks). Reload into it now if nothing is
  // open; never in the middle of a recording, a draft or a chat: then offer it instead.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type !== 'offline:new-version') return;
      e.ports[0]?.postMessage({ handled: true });
      if (!startedControlled.current) return;
      const busy = Boolean(document.querySelector('#root .surface-layer, .sheet-root'));
      if (!busy) window.location.reload();
      else toast("Offline was updated. Reload when you're ready.", { label: 'Reload', run: () => window.location.reload(), sticky: true });
    };
    sw.addEventListener('message', onMessage);
    sw.startMessages?.();
    return () => sw.removeEventListener('message', onMessage);
  }, [toast]);
  return null;
}

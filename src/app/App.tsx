import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Mic, ShieldCheck, Sparkles } from 'lucide-react';
import { SurfaceHost, SurfaceProvider, useSurface, type SurfaceSpec } from './ui/Surface';
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
import { applyAudioRetention, recoverInterruptedRecordings } from '../lib/db';
import { setSpeechLang, startStatusWatch, refreshStatus } from '../lib/status';

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

  // Start-up: live status, recover interrupted recordings, apply audio clean-up.
  useEffect(() => {
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
      if (Date.now() - lastActive.current > limit && !document.querySelector('.tool-record')) setLocked(true);
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
    if (action === 'record') open({ kind: 'record', enter: 'reveal', origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.45 } });
    if (action === 'note') open({ kind: 'note', id: 'new', enter: 'rise' });
  }, [ready, locked, open]);

  // Keyboard: R records from the home screen; Escape acts like the surface's cancel button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape' && current && !document.querySelector('.sheet-root, .menu')) {
        document.querySelector<HTMLButtonElement>('.surface-layer .surface-step:not(.is-leaving) .surface-bar .bar-right button')?.click();
      }
      if (!current && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'r' || e.key === 'R') && locked === false) {
        document.querySelector<HTMLButtonElement>('.record-btn')?.click();
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
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (offlineReady) toast('Offline is ready to open without a connection');
  }, [offlineReady, toast]);
  useEffect(() => {
    if (needRefresh) toast('A new version of Offline is ready', { label: 'Reload', run: () => void updateServiceWorker(true) });
  }, [needRefresh, toast, updateServiceWorker]);
  return null;
}

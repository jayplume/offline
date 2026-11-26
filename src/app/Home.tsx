import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AudioLines,
  BookOpen,
  Cloud,
  CloudOff,
  History,
  Lock,
  MessageCircle,
  Mic,
  NotebookPen,
  Settings as SettingsIcon,
  Sparkles,
  WifiOff,
  Info,
  MoreHorizontal,
} from 'lucide-react';
import { db, type Chat, type Draft, type Note } from '../lib/db';
import { useStatus } from '../lib/status';
import { formatDuration, relativeTime } from '../lib/text';
import { centreOf, originOf, useSurface } from './ui/Surface';
import { Menu, type MenuItem } from './ui/Menu';
import { Confirm } from './ui/Sheet';
import { StatusSheet } from './StatusSheet';
import { setSetting, useSettings } from './settings';
import { formatBytes } from '../lib/text';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Home({ onLock }: { onLock: () => void }) {
  const { open, current } = useSurface();
  const status = useStatus();
  const { settings } = useSettings();
  const recordRef = useRef<HTMLButtonElement>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [lowStorageAsk, setLowStorageAsk] = useState(false);
  const [pressed, setPressed] = useState(false);

  const drafts = useLiveQuery(() => db.drafts.orderBy('updatedAt').reverse().toArray(), []);
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().limit(12).toArray(), []);
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().limit(12).toArray(), []);

  const waiting = useMemo(() => (drafts ?? []).filter((d) => !d.lastRunAt && !d.recordingActive).slice(0, 4), [drafts]);
  const waitingCount = useMemo(() => (drafts ?? []).filter((d) => !d.lastRunAt && !d.recordingActive).length, [drafts]);
  const recent = useMemo(() => {
    const items: ({ type: 'chat'; item: Chat } | { type: 'note'; item: Note })[] = [
      ...(chats ?? []).map((c) => ({ type: 'chat' as const, item: c })),
      ...(notes ?? []).filter((n) => n.body.trim()).map((n) => ({ type: 'note' as const, item: n })),
    ];
    return items.sort((a, b) => b.item.updatedAt - a.item.updatedAt).slice(0, 5);
  }, [chats, notes]);

  // The "back online, nothing was sent" reassurance is a toast in App, so it shows on every screen.

  const startRecording = () => {
    setPressed(true);
    window.setTimeout(() => setPressed(false), 700);
    open({ kind: 'record', enter: 'reveal', origin: centreOf(recordRef.current) });
  };

  const onRecord = () => {
    if (status.storage.low) setLowStorageAsk(true);
    else startRecording();
  };

  const effectiveOffline = !status.online || settings.workOffline;

  const menu: MenuItem[] = [
    { key: 'library', label: 'Library', hint: 'All drafts, chats and notes', icon: <BookOpen />, onSelect: () => open({ kind: 'library', enter: 'rise' }) },
    { key: 'history', label: 'History', hint: 'What was sent, when and where', icon: <History />, onSelect: () => open({ kind: 'history', enter: 'rise' }) },
    { key: 'settings', label: 'Settings', icon: <SettingsIcon />, onSelect: () => open({ kind: 'settings', enter: 'rise' }) },
    {
      key: 'work-offline',
      label: 'Work offline',
      hint: 'Never use the network, even when connected',
      icon: <CloudOff />,
      checked: settings.workOffline,
      divided: true,
      onSelect: () => void setSetting('workOffline', !settings.workOffline),
    },
    ...(settings.lock.method !== 'none' ? [{ key: 'lock', label: 'Lock now', icon: <Lock />, onSelect: onLock }] : []),
    { key: 'about', label: 'About Offline', icon: <Info />, onSelect: () => (window.location.href = '/'), divided: settings.lock.method === 'none' },
  ];

  const covered = Boolean(current);

  return (
    <main className={`home${covered ? ' is-covered' : ''}`} aria-hidden={covered || undefined} inert={covered || undefined}>
      <header className="home-bar">
        <Menu items={menu} label="Menu">
          <MoreHorizontal aria-hidden />
        </Menu>
        <span className="wordmark" aria-label="Offline">
          <LogoMark />
          Offline
        </span>
        <button type="button" className={`status-chip${effectiveOffline ? ' is-off' : ''}`} onClick={() => setStatusOpen(true)}>
          {effectiveOffline ? <WifiOff aria-hidden /> : <Cloud aria-hidden />}
          <span>{settings.workOffline ? 'Working offline' : status.online ? 'Connected' : 'No connection'}</span>
          {status.device === 'available' ? <span className="chip-dot" title="On-device AI ready" /> : null}
        </button>
      </header>


      <section className="home-hero" aria-labelledby="home-q">
        <p className="home-hello">{greeting()}</p>
        <h1 id="home-q" className="home-q">
          What's on your mind?
        </h1>
        <button
          ref={recordRef}
          type="button"
          className={`record-btn${pressed ? ' is-lit' : ''}`}
          onClick={onRecord}
          aria-label="Record a thought"
          aria-keyshortcuts="R"
        >
          <span className="record-ring" aria-hidden />
          <Mic aria-hidden />
        </button>
        <p className="record-caption">Tap to record</p>
        <p className="home-note">Saved on this device. Nothing is sent until you say so.</p>
        <div className="home-actions">
          <button type="button" className="btn btn-line" onClick={() => open({ kind: 'note', id: 'new', enter: 'rise' })}>
            <NotebookPen aria-hidden />
            Note
          </button>
          <button type="button" className="btn btn-line" onClick={(e) => open({ kind: 'chat', id: 'new', enter: 'reveal', origin: originOf(e) })}>
            <Sparkles aria-hidden />
            Ask
          </button>
        </div>
      </section>

      {waiting.length > 0 ? (
        <section className="list-section" aria-labelledby="waiting-h">
          <div className="list-head">
            <h2 id="waiting-h">Waiting for you</h2>
            {waitingCount > waiting.length ? (
              <button type="button" className="link-btn" onClick={() => open({ kind: 'library', enter: 'rise', params: { tab: 'drafts' } })}>
                See all {waitingCount}
              </button>
            ) : null}
          </div>
          <ul className="rows">
            {waiting.map((d) => (
              <li key={d.id}>
                <DraftRow draft={d} onOpen={(origin) => open({ kind: 'draft', id: d.id, enter: 'reveal', origin })} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="list-section" aria-labelledby="recent-h">
          <div className="list-head">
            <h2 id="recent-h">Recent</h2>
            <button type="button" className="link-btn" onClick={() => open({ kind: 'library', enter: 'rise' })}>
              Library
            </button>
          </div>
          <ul className="rows">
            {recent.map((r) => (
              <li key={`${r.type}:${r.item.id}`}>
                {r.type === 'chat' ? (
                  <Row
                    icon={<MessageCircle />}
                    title={r.item.title}
                    meta={[relativeTime(r.item.updatedAt), r.item.localOnly ? 'Device only' : '']}
                    onOpen={(origin) => open({ kind: 'chat', id: r.item.id, enter: 'reveal', origin })}
                  />
                ) : (
                  <Row
                    icon={<NotebookPen />}
                    title={noteTitle(r.item)}
                    meta={[relativeTime(r.item.updatedAt), r.item.summary ? 'Summarized' : '']}
                    onOpen={() => open({ kind: 'note', id: r.item.id, enter: 'rise' })}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {drafts && waiting.length === 0 && recent.length === 0 ? <EmptyHome /> : null}

      <StatusSheet open={statusOpen} onClose={() => setStatusOpen(false)} />
      <Confirm
        open={lowStorageAsk}
        title="Storage is almost full"
        body={<p>This browser has about {formatBytes(status.storage.free)} left for Offline. A long recording might not save. Delete old recordings in Settings, or record a short one.</p>}
        confirmLabel="Record anyway"
        cancelLabel="Not now"
        onCancel={() => setLowStorageAsk(false)}
        onConfirm={() => {
          setLowStorageAsk(false);
          startRecording();
        }}
      />
    </main>
  );
}

export function noteTitle(n: Note): string {
  const first = n.body.trim().split('\n')[0] ?? '';
  return first.length > 60 ? `${first.slice(0, 57).replace(/\s+\S*$/, '')}…` : first || 'Untitled note';
}

export function DraftRow({ draft, onOpen }: { draft: Draft; onOpen: (origin: { x: number; y: number }) => void }) {
  const text = draft.versions.length ? 'Transcribed' : draft.hasAudio ? 'Audio only' : 'Empty';
  return (
    <Row
      icon={<AudioLines />}
      title={draft.title}
      meta={[draft.durationMs ? formatDuration(draft.durationMs) : '', text, draft.localOnly ? 'Device only' : '', relativeTime(draft.updatedAt)]}
      onOpen={onOpen}
    />
  );
}

export function Row({
  icon,
  title,
  meta,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string[];
  onOpen: (origin: { x: number; y: number }) => void;
}) {
  return (
    <button type="button" className="row" onClick={(e) => onOpen(originOf(e))}>
      <span className="row-icon" aria-hidden>
        {icon}
      </span>
      <span className="row-text">
        <span className="row-title">{title}</span>
        <span className="row-meta">
          {meta.filter(Boolean).map((m) => (
            <span key={m}>{m}</span>
          ))}
        </span>
      </span>
    </button>
  );
}

function EmptyHome() {
  return (
    <section className="empty-home" aria-label="How Offline works">
      <ol className="steps">
        <li>
          <span className="step-n">1</span>
          <span>
            <strong>Say it.</strong> Tap the microphone and talk. It works with no signal.
          </span>
        </li>
        <li>
          <span className="step-n">2</span>
          <span>
            <strong>Shape it.</strong> Fix the words, make it clearer, add what you meant.
          </span>
        </li>
        <li>
          <span className="step-n">3</span>
          <span>
            <strong>Send it when you choose.</strong> On this device if it can, in the cloud if you allow.
          </span>
        </li>
      </ol>
    </section>
  );
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo-mark">
      <circle cx="16" cy="16" r="15" fill="var(--sky-300)" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="2.2" opacity="0.9" />
      <circle cx="16" cy="16" r="4" fill="var(--ink)" />
    </svg>
  );
}

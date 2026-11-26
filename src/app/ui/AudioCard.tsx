/**
 * Playback for a recording. Quiet by default: it asks before playing on a speaker unless
 * headphones look connected or the person allowed speaker playback. Tapping a sentence plays
 * from that moment (timed segments come from on-device captions or the cloud transcript).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Headphones, Pause, Play } from 'lucide-react';
import { audioBlob, db, type Draft } from '../../lib/db';
import { headphonesLikely } from '../../lib/audio/recorder';
import { formatDuration, sentences } from '../../lib/text';
import { setSetting, useSettings } from '../settings';
import { Sheet } from './Sheet';

interface Timed {
  start: number;
  end: number;
  text: string;
  approx: boolean;
}

export function AudioCard({ draft }: { draft: Draft }) {
  const rec = useLiveQuery(() => db.audio.get(draft.id), [draft.id, draft.audioBytes]);
  const { settings } = useSettings();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [open, setOpen] = useState(false);
  const [askSpeaker, setAskSpeaker] = useState<null | (() => void)>(null);
  const [remember, setRemember] = useState(false);
  const durationSec = (draft.durationMs ?? 0) / 1000;

  useEffect(() => {
    const blob = audioBlob(rec);
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec]);

  useEffect(() => {
    if (!url) return;
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    audioRef.current = a;
    // MediaRecorder WebM has no duration in its header, so Chrome reports Infinity and seeking
    // misbehaves until the whole file is scanned. Seeking far past the end forces that scan once.
    const onMeta = () => {
      if (!Number.isFinite(a.duration)) {
        const fix = () => {
          a.removeEventListener('durationchange', fix);
          a.currentTime = 0;
        };
        a.addEventListener('durationchange', fix);
        a.currentTime = 1e101;
      }
    };
    const onTime = () => setT(a.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setT(0);
    };
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('play', () => setPlaying(true));
    return () => {
      a.pause();
      a.removeAttribute('src');
      a.load();
      audioRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const a = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (a?.setSinkId && settings.outputDeviceId) void a.setSinkId(settings.outputDeviceId).catch(() => {});
  }, [settings.outputDeviceId, url]);

  const timed: Timed[] = useMemo(() => {
    const segs = draft.transcript?.segments ?? [];
    if (segs.length && segs.some((s) => s.end > 0)) return segs.map((s) => ({ ...s, approx: false }));
    // No timing: spread the sentences of the original text across the clip by length.
    const original = draft.versions.find((v) => v.kind === 'original')?.text ?? '';
    const parts = sentences(original);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let at = 0;
    return parts.map((p) => {
      const len = (p.length / total) * durationSec;
      const seg = { start: at, end: at + len, text: p, approx: true };
      at += len;
      return seg;
    });
  }, [draft.transcript, draft.versions, durationSec]);

  const current = timed.findLast((s) => t >= s.start - 0.05);

  const guarded = async (run: () => void) => {
    if (settings.speakerPlayback || (await headphonesLikely())) return run();
    setRemember(false);
    setAskSpeaker(() => run);
  };

  const playFrom = (sec: number | null) => {
    const a = audioRef.current;
    if (!a) return;
    void guarded(() => {
      if (sec !== null) a.currentTime = Math.max(0, sec);
      void a.play();
    });
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else playFrom(null);
  };

  if (!draft.hasAudio) {
    return draft.audioDeletedAt ? <p className="audio-gone">Audio deleted {new Date(draft.audioDeletedAt).toLocaleDateString()}. The text is kept.</p> : null;
  }

  const pct = durationSec ? Math.min(100, (t / durationSec) * 100) : 0;

  return (
    <div className={`audio-card${open ? ' is-open' : ''}`}>
      <div className="audio-main">
        <button type="button" className="audio-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play recording'} disabled={!url}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <div className="audio-mid">
          <input
            type="range"
            className="audio-seek"
            min={0}
            max={Math.max(0.1, durationSec)}
            step={0.1}
            value={Math.min(t, durationSec)}
            aria-label="Seek"
            style={{ ['--pct' as string]: `${pct}%` }}
            onChange={(e) => {
              const a = audioRef.current;
              if (a) a.currentTime = Number(e.target.value);
              setT(Number(e.target.value));
            }}
          />
          <div className="audio-meta">
            <span className="tabular">
              {formatDuration(t * 1000)} / {formatDuration(draft.durationMs ?? 0)}
            </span>
            {current && playing ? <span className="audio-now">{current.text}</span> : null}
          </div>
        </div>
        {timed.length > 0 ? (
          <button type="button" className="icon-btn audio-expand" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Show sentences">
            <ChevronDown aria-hidden />
          </button>
        ) : null}
      </div>
      {open ? (
        <ol className="sentences">
          {timed.map((s, i) => (
            <li key={i}>
              <button type="button" className={`sentence${current === s && playing ? ' is-now' : ''}`} onClick={() => playFrom(s.start)}>
                <span className="sentence-t tabular">
                  {s.approx ? '≈' : ''}
                  {formatDuration(s.start * 1000)}
                </span>
                <span>{s.text}</span>
              </button>
            </li>
          ))}
          {timed.some((s) => s.approx) ? <li className="sentence-hint">Times marked ≈ are estimates.</li> : null}
        </ol>
      ) : null}

      <Sheet
        open={askSpeaker !== null}
        onClose={() => setAskSpeaker(null)}
        label="Play out loud?"
        footer={
          <div className="sheet-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setAskSpeaker(null)} data-autofocus>
              Not now
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const run = askSpeaker;
                setAskSpeaker(null);
                if (remember) void setSetting('speakerPlayback', true);
                run?.();
              }}
            >
              Play on speaker
            </button>
          </div>
        }
      >
        <div className="speaker-ask">
          <span className="speaker-icon" aria-hidden>
            <Headphones />
          </span>
          <h2 className="confirm-title">Play out loud?</h2>
          <p className="confirm-body">No headphones seem to be connected, so people nearby may hear this recording.</p>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Don't ask again on this device
          </label>
        </div>
      </Sheet>
    </div>
  );
}

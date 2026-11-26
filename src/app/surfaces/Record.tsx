/**
 * Recording: the one tool on screen. Starts the moment the surface opens, shows that it is
 * recording at all times, and saves to this device as it goes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Captions, Check, Lock, Mic, MicOff, Pause, Play, Square, Trash2, Timer } from 'lucide-react';
import { SurfaceBar, useSurface } from '../ui/Surface';
import { afterMotion } from '../ui/genie';
import { Confirm } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { MicError, Recorder } from '../../lib/audio/recorder';
import { startCaptions, type CaptionSession, type LiveCaption } from '../../lib/speech';
import { checkpointRecording, createDraft, db, readSettings, saveRecording, setTranscript, type Settings } from '../../lib/db';
import { getStatus } from '../../lib/status';
import { formatDuration } from '../../lib/text';
import { setSetting } from '../settings';

type Phase = 'starting' | 'recording' | 'paused' | 'saving' | 'saved' | 'error';

const SILENCE_LEVEL = 0.012;

export function RecordSurface() {
  const { replace, close } = useSurface();
  const toast = useToast();
  const recorder = useRef<Recorder | null>(null);
  const captions = useRef<CaptionSession | null>(null);
  const draftId = useRef<string | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);
  const lastCheckpoint = useRef(0);
  const silentSince = useRef<number | null>(null);
  const heardSpeech = useRef(false);
  /** False once this surface is gone, so late async steps can never leave a recording running. */
  const alive = useRef(true);
  const stopMeterWait = useRef<(() => void) | null>(null);

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<MicError | null>(null);
  const [caption, setCaption] = useState<LiveCaption | null>(null);
  const [captionNote, setCaptionNote] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [mic, setMic] = useState('');
  const [silenceOn, setSilenceOn] = useState(0);
  const [slowStart, setSlowStart] = useState(false);

  // getUserMedia can wait indefinitely on a browser or system permission prompt; say what is happening.
  useEffect(() => {
    if (phase !== 'starting') {
      setSlowStart(false);
      return;
    }
    const t = window.setTimeout(() => setSlowStart(true), 5000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const stopLoop = () => cancelAnimationFrame(raf.current);

  const loop = useCallback(() => {
    const rec = recorder.current;
    if (!rec) return;
    let smooth = 0;
    let lastTimer = -1;
    const tick = () => {
      const lvl = rec.level();
      // Fast attack, slow release: the orb follows the voice without flickering.
      smooth = lvl > smooth ? smooth + (lvl - smooth) * 0.4 : smooth + (lvl - smooth) * 0.08;
      const v = Math.min(1, smooth * 7);
      orbRef.current?.style.setProperty('--lvl', v.toFixed(3));
      const sec = Math.floor(rec.elapsedMs() / 1000);
      if (sec !== lastTimer && timerRef.current) {
        lastTimer = sec;
        timerRef.current.textContent = formatDuration(rec.elapsedMs());
      }
      // Stop after silence (off by default). Only counts once the person has started talking.
      const limit = settingsRef.current?.stopAfterSilence ?? 0;
      if (rec.state === 'recording') {
        if (lvl > SILENCE_LEVEL * 1.6) {
          heardSpeech.current = true;
          silentSince.current = null;
          setCountdown((c) => (c === null ? c : null));
        } else if (limit > 0 && heardSpeech.current) {
          const now = performance.now();
          silentSince.current ??= now;
          const left = limit - (now - silentSince.current) / 1000;
          if (left <= 3) setCountdown((c) => (c === Math.ceil(Math.max(0, left)) ? c : Math.ceil(Math.max(0, left))));
          if (left <= 0) {
            void finish('silence');
            return;
          }
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    // finish is stable for the life of the surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = useCallback(async () => {
    setError(null);
    setPhase('starting');
    const settings = await readSettings();
    settingsRef.current = settings;
    setLocalOnly(settings.defaultLocalOnly);
    setSilenceOn(settings.stopAfterSilence);
    const rec = new Recorder();
    recorder.current = rec;
    try {
      await rec.start(settings.micDeviceId || undefined);
    } catch (err) {
      if (recorder.current === rec) recorder.current = null;
      if (!alive.current) return;
      setError(err instanceof MicError ? err : new MicError('The microphone could not start.', 'unknown'));
      setPhase('error');
      return;
    }
    if (!alive.current || recorder.current !== rec) {
      rec.cancel();
      return;
    }
    setMic(rec.deviceLabel);
    const draft = await createDraft({ localOnly: settings.defaultLocalOnly, recordingActive: true, title: 'Recording…' });
    if (!alive.current || recorder.current !== rec) {
      rec.cancel();
      await db.drafts.delete(draft.id);
      return;
    }
    draftId.current = draft.id;
    // Crash-safe: write what we have every few seconds.
    rec.onChunk = (chunks, elapsed) => {
      const now = performance.now();
      if (now - lastCheckpoint.current < 4000 || !draftId.current) return;
      lastCheckpoint.current = now;
      void checkpointRecording(draftId.current, new Blob(chunks, { type: rec.mimeType }), elapsed);
    };
    setPhase('recording');
    loop();
    // The meter's AudioContext can stall the page while Chrome opens the audio device, so it
    // starts once the screen has finished opening. Recording itself is already running.
    stopMeterWait.current?.();
    stopMeterWait.current = afterMotion(() => {
      if (alive.current && recorder.current === rec) rec.startMeter();
    });

    if (settings.liveCaptions && getStatus().speech === 'available') {
      captions.current = startCaptions({
        lang: settings.speechLang,
        track: rec.track,
        clock: () => rec.elapsedMs(),
        onUpdate: setCaption,
        onError: setCaptionNote,
      });
      if (!captions.current) setCaptionNote(null);
    }
  }, [loop]);

  useEffect(() => {
    alive.current = true;
    void begin();
    return () => {
      alive.current = false;
      stopMeterWait.current?.();
      stopLoop();
      // Leaving without Stop (e.g. the app closed): keep what was recorded as a draft.
      if (recorder.current && recorder.current.state !== 'stopped') {
        const rec = recorder.current;
        const id = draftId.current;
        captions.current?.stop();
        void rec.stop().then(async ({ blob, durationMs }) => {
          if (!id) return;
          if (blob.size > 0) {
            await saveRecording(id, blob, durationMs);
            await db.drafts.update(id, { recordingActive: false, title: 'Recording' });
          } else {
            await db.drafts.delete(id);
          }
        });
      }
    };
  }, [begin]);

  const finish = useCallback(
    async (why: 'button' | 'silence' = 'button') => {
      const rec = recorder.current;
      const id = draftId.current;
      if (!rec || !id || rec.state === 'stopped') return;
      setPhase('saving');
      setCountdown(null);
      stopLoop();
      const live = captions.current?.stop();
      captions.current = null;
      const { blob, durationMs } = await rec.stop();
      recorder.current = null;
      if (durationMs < 600 || blob.size === 0) {
        await db.drafts.delete(id);
        toast('That was too short to keep');
        close();
        return;
      }
      await saveRecording(id, blob, durationMs);
      await db.drafts.update(id, { recordingActive: false, title: 'Recording', localOnly });
      if (live && live.finals.length) await setTranscript(id, live.finals, 'device-speech');
      setPhase('saved');
      if (why === 'silence') toast('Stopped after silence. Saved on this device.');
      // Let the check land, then move to the draft inside the same surface.
      window.setTimeout(() => replace({ kind: 'draft', id, params: { fresh: '1' } }), 650);
    },
    [close, localOnly, replace, toast],
  );

  const togglePause = () => {
    const rec = recorder.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      captions.current?.pause();
      setPhase('paused');
      setCountdown(null);
      silentSince.current = null;
    } else if (rec.state === 'paused') {
      rec.resume();
      captions.current?.resume();
      setPhase('recording');
    }
  };

  const discard = async () => {
    setAskDiscard(false);
    stopLoop();
    captions.current?.stop();
    captions.current = null;
    recorder.current?.cancel();
    recorder.current = null;
    if (draftId.current) {
      const id = draftId.current;
      draftId.current = null;
      await db.transaction('rw', db.drafts, db.audio, async () => {
        await db.audio.delete(id);
        await db.drafts.delete(id);
      });
    }
    close();
  };

  const onCancel = () => {
    const rec = recorder.current;
    if (!rec || phase === 'error') {
      void discard();
      return;
    }
    if (rec.elapsedMs() < 1500) void discard();
    else setAskDiscard(true);
  };

  const typeInstead = async () => {
    // Stop any microphone request still waiting on a permission prompt.
    recorder.current?.cancel();
    recorder.current = null;
    const settings = settingsRef.current ?? (await readSettings());
    const draft = await createDraft({ localOnly: settings.defaultLocalOnly, title: 'Typed prompt' });
    replace({ kind: 'draft', id: draft.id, params: { focus: '1' } });
  };

  const recent = caption ? caption.finals.slice(-2).map((f) => f.text).join(' ') : '';
  const live = phase === 'recording' || phase === 'paused';

  return (
    <div className="tool tool-record">
      <SurfaceBar
        title={phase === 'paused' ? 'Paused' : phase === 'saved' ? 'Saved' : 'Recording'}
        onCancel={onCancel}
        cancelLabel="Cancel recording"
        menu={[
          {
            key: 'local',
            label: 'Keep on this device only',
            hint: 'Never use the cloud for this recording',
            icon: <Lock />,
            checked: localOnly,
            onSelect: () => {
              setLocalOnly((v) => !v);
              if (draftId.current) void db.drafts.update(draftId.current, { localOnly: !localOnly });
            },
          },
          {
            key: 'captions',
            label: 'Live captions',
            hint: getStatus().speech === 'available' ? 'On-device speech recognition' : 'Not available in this browser',
            icon: <Captions />,
            checked: Boolean(captions.current),
            disabled: getStatus().speech !== 'available',
            onSelect: () => {
              if (captions.current) {
                captions.current.stop();
                captions.current = null;
                setCaption(null);
                void setSetting('liveCaptions', false);
              } else if (recorder.current && settingsRef.current) {
                void setSetting('liveCaptions', true);
                const rec = recorder.current;
                captions.current = startCaptions({ lang: settingsRef.current.speechLang, track: rec.track, clock: () => rec.elapsedMs(), onUpdate: setCaption, onError: setCaptionNote });
              }
            },
          },
          {
            key: 'silence',
            label: silenceOn ? `Stop after ${silenceOn} s of silence` : 'Stop after silence',
            hint: silenceOn ? 'On' : 'Off',
            icon: <Timer />,
            checked: silenceOn > 0,
            onSelect: () => {
              const next = (silenceOn ? 0 : 10) as Settings['stopAfterSilence'];
              setSilenceOn(next);
              if (settingsRef.current) settingsRef.current = { ...settingsRef.current, stopAfterSilence: next };
              void setSetting('stopAfterSilence', next);
            },
          },
          { key: 'mic', label: mic || 'Default microphone', hint: 'Change it in Settings', icon: <Mic />, disabled: true, onSelect: () => {} },
          { key: 'discard', label: 'Discard recording', icon: <Trash2 />, divided: true, onSelect: () => (live ? setAskDiscard(true) : void discard()) },
        ]}
      />

      {phase === 'error' && error ? (
        <div className="record-error">
          <span className="record-error-icon" aria-hidden>
            <MicOff />
          </span>
          <h2>{error.code === 'denied' ? 'Microphone is blocked' : error.code === 'no-device' ? 'No microphone found' : "Can't record right now"}</h2>
          <p>{error.message}</p>
          <div className="record-error-actions">
            <button type="button" className="btn btn-primary" onClick={() => void begin()}>
              Try again
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void typeInstead()}>
              Type it instead
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="record-stage">
            <p className="record-timer tabular" aria-live="off">
              <span ref={timerRef}>0:00</span>
            </p>
            <p className={`record-state state-${phase}`} role="status">
              <span className="rec-dot" aria-hidden />
              {phase === 'starting' && 'Starting the microphone…'}
              {phase === 'recording' && 'Recording, saved on this device'}
              {phase === 'paused' && 'Paused'}
              {phase === 'saving' && 'Saving…'}
              {phase === 'saved' && 'Saved on this device'}
            </p>

            <div ref={orbRef} className={`orb orb-${phase}`} aria-hidden>
              <span className="orb-ring r3" />
              <span className="orb-ring r2" />
              <span className="orb-ring r1" />
              <span className="orb-core">{phase === 'saved' ? <Check /> : <Mic />}</span>
            </div>

            <div className="record-caption-area" aria-live="polite">
              {slowStart ? (
                <div className="slow-start">
                  <p className="caption-note">Waiting for the microphone. If your browser or computer is asking for permission, allow it.</p>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => void typeInstead()}>
                    Type it instead
                  </button>
                </div>
              ) : recent || caption?.interim ? (
                <p className="live-caption">
                  {recent} <span className="interim">{caption?.interim}</span>
                </p>
              ) : captionNote ? (
                <p className="caption-note">{captionNote}</p>
              ) : live && !captions.current ? (
                <p className="caption-note">Speak naturally. You can review and fix the words after you save.</p>
              ) : null}
            </div>

            {countdown !== null ? (
              <div className="silence-note" role="alert">
                Stopping in {countdown}…
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => {
                  silentSince.current = null;
                  heardSpeech.current = false;
                  setCountdown(null);
                }}>
                  Keep recording
                </button>
              </div>
            ) : null}
          </div>

          <div className="record-controls">
            <button type="button" className="ctl ctl-quiet" onClick={togglePause} disabled={!live} aria-label={phase === 'paused' ? 'Resume recording' : 'Pause recording'}>
              {phase === 'paused' ? <Play aria-hidden /> : <Pause aria-hidden />}
              <span>{phase === 'paused' ? 'Resume' : 'Pause'}</span>
            </button>
            <button type="button" className="ctl ctl-main" onClick={() => void finish()} disabled={!live} aria-label="Stop and save">
              <span className="ctl-main-face">{phase === 'saved' ? <Check aria-hidden /> : <Square aria-hidden />}</span>
              <span>{phase === 'saved' ? 'Saved' : 'Save'}</span>
            </button>
          </div>
        </>
      )}

      <Confirm
        open={askDiscard}
        title="Discard this recording?"
        body={<p>The audio you just recorded will be deleted from this device. This can't be undone.</p>}
        confirmLabel="Discard"
        cancelLabel="Keep recording"
        onCancel={() => setAskDiscard(false)}
        onConfirm={() => void discard()}
      />
    </div>
  );
}

/**
 * Draft: review and shape a captured thought, then run it when ready.
 * The person always sees where AI work will happen before it happens, and the original words
 * are never overwritten (edits and rewrites become versions).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowUp,
  Copy,
  FileAudio,
  GitCompare,
  Keyboard,
  Layers,
  Lock,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  HelpCircle,
  Cloud,
  Smartphone,
  X,
} from 'lucide-react';
import { SurfaceBar, useSurface } from '../ui/Surface';
import { afterMotion } from '../ui/genie';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { SourceBadge, LocalOnlyBadge } from '../ui/Badge';
import { AudioCard } from '../ui/AudioCard';
import {
  activeText,
  addVersion,
  audioBlob,
  db,
  deleteAudio,
  deleteDraft,
  deleteTranscript,
  editActiveText,
  setTranscript,
  titleFrom,
  uid,
  type Draft,
} from '../../lib/db';
import { LENGTHS, TONES, assemblePrompt, clarifyPrompt, questionsPrompt } from '../../lib/ai/prompts';
import { AIUserError, findMissingDetails, runText, toUserError, transcribe, DEVICE_MODEL_LABEL } from '../../lib/ai/engine';
import type { Route, RouteDecision } from '../../lib/ai/route';
import { useRoute } from '../useRoute';
import { useStatus } from '../../lib/status';
import { relativeTime, wordCount, wordDiff } from '../../lib/text';
import { queueRun } from '../runs';
import { setSetting, useSettings } from '../settings';
import { refreshStatus } from '../../lib/status';

type Busy = null | 'transcribe' | 'clarify' | 'questions';

export function DraftSurface({ id, fresh, focus }: { id: string; fresh?: boolean; focus?: boolean }) {
  const draft = useLiveQuery(() => db.drafts.get(id), [id]);
  if (draft === undefined) return <div className="tool" />;
  if (draft === null || !draft) return <Missing />;
  return <DraftView draft={draft} fresh={fresh} focus={focus} />;
}

function Missing() {
  return (
    <div className="tool">
      <SurfaceBar title="Draft" />
      <div className="empty-tool">This draft was deleted.</div>
    </div>
  );
}

function DraftView({ draft, fresh, focus }: { draft: Draft; fresh?: boolean; focus?: boolean }) {
  const { replace, close } = useSurface();
  const toast = useToast();
  const status = useStatus();
  const { settings } = useSettings();
  const text = activeText(draft);
  const [local, setLocal] = useState(text);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ what: Exclude<Busy, null>; message: string } | null>(null);
  const [sheet, setSheet] = useState<null | 'improve' | 'send' | 'versions' | 'delete'>(null);
  const [showIntent, setShowIntent] = useState(Boolean(draft.intentNote));
  const [compareId, setCompareId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const activeVersion = draft.versions.find((v) => v.id === draft.activeVersionId);

  // Keep the editor in sync when the active version changes from elsewhere (rewrite, version pick).
  useEffect(() => {
    setLocal(activeText(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.activeVersionId, draft.versions.length]);

  useEffect(() => {
    if (fresh && !draft.versions.length) toast(draft.recovered ? 'Recovered an interrupted recording' : 'Saved on this device');
    // Once the page has landed: on phones a focused field opens the keyboard and resizes the view.
    if (focus) return afterMotion(() => textRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  // Auto-grow the editor.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.55)}px`;
  }, [local]);

  const onEdit = (v: string) => {
    setLocal(v);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void editActiveText(draft.id, v), 350);
  };
  const flush = async () => {
    window.clearTimeout(saveTimer.current);
    if (local !== activeText(draft)) await editActiveText(draft.id, local);
  };

  const template = status.runtime.templates.find((t) => t.id === draft.templateId) ?? null;
  const finalPrompt = useMemo(
    () => assemblePrompt(local, { template, tone: draft.tone, length: draft.length, intentNote: draft.intentNote, answers: draft.answers }),
    [local, template, draft.tone, draft.length, draft.intentNote, draft.answers],
  );

  const transcribeRoute = useRoute('transcribe', draft.localOnly, 0);
  const clarifyRoute = useRoute('clarify', draft.localOnly, local.length);
  const questionsRoute = useRoute('questions', draft.localOnly, local.length);
  const runRoute = useRoute('run', draft.localOnly, finalPrompt.length);

  const needsText = !draft.versions.length;
  const hasText = local.trim().length > 0;

  const doTranscribe = async (route: RouteDecision) => {
    if (!route.ok) return;
    setFailure(null);
    setBusy('transcribe');
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const audio = audioBlob(await db.audio.get(draft.id));
      if (!audio) throw new AIUserError('The audio for this draft is gone.', 'unknown');
      const { segments, model } = await transcribe(audio, {
        route,
        itemId: draft.id,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress(total > 1 ? `Transcribing part ${Math.min(done + 1, total)} of ${total}…` : 'Transcribing…'),
      });
      if (!segments.length) {
        setFailure({ what: 'transcribe', message: "Gemini didn't hear any speech in this recording." });
      } else {
        await setTranscript(draft.id, segments, 'cloud', model);
        toast('Transcribed by Gemini in the cloud');
        if (settings.audioRetention === 'after-transcript') {
          await deleteAudio(draft.id);
          toast('Audio deleted after transcription (your setting)');
        }
      }
    } catch (err) {
      const e = toUserError(err);
      if (e.code !== 'cancelled') setFailure({ what: 'transcribe', message: e.message });
    } finally {
      setBusy(null);
      setProgress(null);
      abort.current = null;
    }
  };

  // Optional: transcribe right after saving when the person turned that on in Settings.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !fresh || !settings.autoTranscribe || !needsText || !draft.hasAudio || !transcribeRoute.ok) return;
    autoStarted.current = true;
    void doTranscribe(transcribeRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, settings.autoTranscribe, transcribeRoute.ok]);

  const doClarify = async () => {
    if (!clarifyRoute.ok || !hasText) return;
    await flush();
    setSheet(null);
    setFailure(null);
    setBusy('clarify');
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await runText(clarifyPrompt(local), { task: 'clarify', route: clarifyRoute, itemId: draft.id, signal: ctrl.signal });
      const rewritten = res.text.trim().replace(/^"+|"+$/g, '');
      const n = draft.versions.filter((v) => v.kind === 'clearer').length + 1;
      await addVersion(draft.id, { kind: 'clearer', label: n > 1 ? `Clearer ${n}` : 'Clearer', text: rewritten, source: res.source, model: res.model });
      toast(res.source === 'device' ? 'Rewritten on this device' : res.fellBackFrom ? 'Rewritten in the cloud (device failed)' : 'Rewritten in the cloud');
    } catch (err) {
      const e = toUserError(err);
      if (e.code !== 'cancelled') setFailure({ what: 'clarify', message: e.message });
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const doQuestions = async () => {
    if (!questionsRoute.ok || !hasText) return;
    await flush();
    setSheet(null);
    setFailure(null);
    setBusy('questions');
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { questions, result } = await findMissingDetails(questionsPrompt(local), { route: questionsRoute, itemId: draft.id, signal: ctrl.signal });
      if (!questions.length) toast(`Nothing important seems to be missing (${result.source === 'device' ? 'checked on this device' : 'checked in the cloud'})`);
      else await db.drafts.update(draft.id, { answers: questions.map((q) => ({ question: q, answer: '' })), updatedAt: Date.now() });
    } catch (err) {
      const e = toUserError(err);
      if (e.code !== 'cancelled') setFailure({ what: 'questions', message: e.message });
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const send = async (route: Route) => {
    await flush();
    const now = Date.now();
    let chatId = draft.chatId;
    if (!chatId) {
      chatId = uid();
      await db.chats.add({ id: chatId, title: titleFrom(local, draft.title), createdAt: now, updatedAt: now, draftId: draft.id, localOnly: draft.localOnly });
    }
    await db.messages.add({ id: uid(), chatId, role: 'user', text: finalPrompt, createdAt: now, status: 'done' });
    await db.chats.update(chatId, { updatedAt: now, localOnly: draft.localOnly });
    await db.drafts.update(draft.id, { chatId, lastRunAt: now, updatedAt: now });
    queueRun({ chatId, route, draftId: draft.id });
    setSheet(null);
    replace({ kind: 'chat', id: chatId });
  };

  const setLocalOnly = async (v: boolean) => {
    await db.drafts.update(draft.id, { localOnly: v, updatedAt: Date.now() });
    if (draft.chatId) await db.chats.update(draft.chatId, { localOnly: v });
    toast(v ? 'This draft will never use the cloud' : 'Cloud allowed for this draft');
  };

  const menu = [
    {
      key: 'versions',
      label: 'Versions',
      hint: draft.versions.length ? `${draft.versions.length} saved, original kept` : 'None yet',
      icon: <Layers />,
      disabled: draft.versions.length < 1,
      onSelect: () => setSheet('versions'),
    },
    {
      key: 'intent',
      label: showIntent ? 'Hide "What I meant"' : 'Add "What I meant"',
      hint: 'A note in your own words, sent with the prompt',
      icon: <MessageSquareText />,
      onSelect: () => setShowIntent((s) => !s),
    },
    {
      key: 'local',
      label: 'Keep on this device only',
      hint: 'Never use the cloud for this draft',
      icon: <Lock />,
      checked: draft.localOnly,
      onSelect: () => void setLocalOnly(!draft.localOnly),
    },
    { key: 'copy', label: 'Copy text', icon: <Copy />, disabled: !hasText, onSelect: () => void navigator.clipboard.writeText(finalPrompt).then(() => toast('Copied')) },
    ...(draft.chatId ? [{ key: 'chat', label: 'Open the chat', icon: <MessageSquareText />, onSelect: () => replace({ kind: 'chat', id: draft.chatId! }) }] : []),
    { key: 'delete', label: 'Delete…', icon: <Trash2 />, divided: true, onSelect: () => setSheet('delete') },
  ];

  const statusLine = draft.lastRunAt ? `Sent ${relativeTime(draft.lastRunAt)}` : 'Saved on this device, not sent';

  return (
    <div className="tool tool-draft">
      <SurfaceBar
        title="Draft"
        sub={
          <span className="bar-status">
            {draft.localOnly ? <LocalOnlyBadge /> : null}
            {statusLine}
          </span>
        }
        menu={menu}
        onCancel={async () => {
          await flush();
          close();
        }}
      />

      <div className="tool-scroll">
        <AudioCard draft={draft} />

        {needsText && draft.hasAudio ? (
          <section className="transcribe-card" aria-live="polite">
            {busy === 'transcribe' ? (
              <div className="working">
                <span className="spinner" aria-hidden />
                <span>{progress ?? 'Preparing audio…'}</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              </div>
            ) : (
              <>
                <h2>Turn it into text</h2>
                <p className="muted">
                  {status.speech === 'available'
                    ? 'Live captions were off for this recording.'
                    : "This browser can't transcribe speech on the device, so the words need Gemini in the cloud."}
                </p>
                {transcribeRoute.ok ? (
                  <button type="button" className="btn btn-primary btn-block" onClick={() => void doTranscribe(transcribeRoute)}>
                    <Cloud aria-hidden />
                    Transcribe with Gemini
                  </button>
                ) : (
                  <BlockedNote decision={transcribeRoute} onAllowCloud={() => void setLocalOnly(false)} />
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={async () => {
                    await editActiveText(draft.id, '');
                    window.setTimeout(() => textRef.current?.focus(), 80);
                  }}
                >
                  <Keyboard aria-hidden />
                  Type it myself
                </button>
                {transcribeRoute.ok ? <p className="fine">Sends only this recording to Gemini through Firebase AI Logic. Nothing else leaves this device.</p> : null}
              </>
            )}
            {failure?.what === 'transcribe' ? <RetryNote message={failure.message} onRetry={() => void doTranscribe(transcribeRoute)} /> : null}
          </section>
        ) : null}

        {!needsText || !draft.hasAudio ? (
          <section className="editor">
            <div className="editor-head">
              <button type="button" className="version-chip" onClick={() => setSheet('versions')} disabled={draft.versions.length < 2}>
                {activeVersion?.label ?? 'Your words'}
                {draft.versions.length > 1 ? <span className="version-count">{draft.versions.length}</span> : null}
              </button>
              {activeVersion?.source && activeVersion.kind !== 'original' ? <SourceBadge source={activeVersion.source} model={activeVersion.model} /> : null}
              {activeVersion?.kind === 'original' && draft.transcript?.source === 'device-speech' ? <SourceBadge source="device" model="On-device speech recognition" /> : null}
              {activeVersion?.kind === 'original' && draft.transcript?.source === 'cloud' ? <SourceBadge source="cloud" model={draft.transcript.model} /> : null}
              <span className="editor-count tabular">{wordCount(local)} words</span>
            </div>
            <textarea
              ref={textRef}
              className="editor-text"
              value={local}
              onChange={(e) => onEdit(e.target.value)}
              onBlur={() => void flush()}
              placeholder="Type or fix your prompt here…"
              aria-label="Prompt text"
              rows={4}
            />
            {activeVersion?.kind === 'original' && draft.versions.length > 0 ? <p className="fine">Editing keeps the original. Your changes become a new version.</p> : null}

            {busy === 'clarify' || busy === 'questions' ? (
              <div className="working">
                <span className="spinner" aria-hidden />
                <span>
                  {busy === 'clarify' ? 'Making it clearer' : 'Looking for missing details'}
                  {whereText(busy === 'clarify' ? clarifyRoute : questionsRoute)}
                </span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              </div>
            ) : null}
            {failure && failure.what !== 'transcribe' ? (
              <RetryNote message={failure.message} onRetry={() => void (failure.what === 'clarify' ? doClarify() : doQuestions())} />
            ) : null}

            {showIntent || draft.intentNote ? (
              <label className="intent">
                <span className="intent-label">What I meant</span>
                <textarea
                  className="intent-text"
                  defaultValue={draft.intentNote}
                  placeholder="Anything the words above don't say. For example: this is for my manager, keep it under 100 words."
                  onChange={(e) => void db.drafts.update(draft.id, { intentNote: e.target.value, updatedAt: Date.now() })}
                  rows={2}
                />
              </label>
            ) : null}

            {draft.answers.length ? (
              <div className="answers">
                <div className="answers-head">
                  <span>A few details would help</span>
                  <button type="button" className="icon-btn" aria-label="Remove these questions" onClick={() => void db.drafts.update(draft.id, { answers: [] })}>
                    <X aria-hidden />
                  </button>
                </div>
                {draft.answers.map((a, i) => (
                  <label key={a.question} className="answer">
                    <span>{a.question}</span>
                    <input
                      defaultValue={a.answer}
                      placeholder="Your answer (optional)"
                      onChange={(e) => {
                        const answers = draft.answers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x));
                        void db.drafts.update(draft.id, { answers, updatedAt: Date.now() });
                      }}
                    />
                  </label>
                ))}
              </div>
            ) : null}

            {template || draft.tone !== 'neutral' || draft.length !== 'any' ? (
              <div className="shape-chips">
                {template ? <span className="chip-static">{template.label}</span> : null}
                {draft.tone !== 'neutral' ? <span className="chip-static">{TONES.find((t) => t.id === draft.tone)?.label}</span> : null}
                {draft.length !== 'any' ? <span className="chip-static">{LENGTHS.find((l) => l.id === draft.length)?.label}</span> : null}
                <button type="button" className="link-btn" onClick={() => setSheet('improve')}>
                  Change
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {!needsText || !draft.hasAudio ? (
        <footer className="tool-foot">
          <button type="button" className="btn btn-line" onClick={() => setSheet('improve')} disabled={!hasText || busy !== null}>
            <Wand2 aria-hidden />
            Improve
          </button>
          <button type="button" className="btn btn-primary foot-main" onClick={() => setSheet('send')} disabled={!hasText || busy !== null}>
            <Sparkles aria-hidden />
            Run with AI
          </button>
        </footer>
      ) : null}

      {/* Improve: rewrite, missing details, template, tone, length. */}
      <Sheet open={sheet === 'improve'} onClose={() => setSheet(null)} title="Improve">
        <div className="improve">
          <button type="button" className="improve-row" onClick={() => void doClarify()} disabled={!clarifyRoute.ok}>
            <span className="improve-icon" aria-hidden>
              <Wand2 />
            </span>
            <span className="improve-text">
              <span className="improve-title">Make it clearer</span>
              <span className="improve-sub">Same meaning, cleaner words. Your original is kept.</span>
            </span>
            <RouteHint decision={clarifyRoute} />
          </button>
          <button type="button" className="improve-row" onClick={() => void doQuestions()} disabled={!questionsRoute.ok}>
            <span className="improve-icon" aria-hidden>
              <HelpCircle />
            </span>
            <span className="improve-text">
              <span className="improve-title">Ask me what's missing</span>
              <span className="improve-sub">Up to three questions that would sharpen the answer.</span>
            </span>
            <RouteHint decision={questionsRoute} />
          </button>
          {!clarifyRoute.ok ? <p className="fine block-note">{clarifyRoute.reason}</p> : null}

          <ChoiceGroup
            label="Template"
            value={draft.templateId ?? ''}
            options={[{ id: '', label: 'None' }, ...status.runtime.templates.map((t) => ({ id: t.id, label: t.label }))]}
            onChange={(v) => void db.drafts.update(draft.id, { templateId: v || null, updatedAt: Date.now() })}
          />
          <ChoiceGroup label="Tone" value={draft.tone} options={TONES} onChange={(v) => void db.drafts.update(draft.id, { tone: v as Draft['tone'], updatedAt: Date.now() })} />
          <ChoiceGroup label="Length" value={draft.length} options={LENGTHS} onChange={(v) => void db.drafts.update(draft.id, { length: v as Draft['length'], updatedAt: Date.now() })} />
        </div>
      </Sheet>

      {/* Send preview: the exact text, and exactly where it can go. */}
      <Sheet
        open={sheet === 'send'}
        onClose={() => setSheet(null)}
        title="Send to AI"
        footer={
          runRoute.ok ? (
            <div className="sheet-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setSheet(null)}>
                Not yet
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void send(runRoute)} data-autofocus>
                <ArrowUp aria-hidden />
                Send
              </button>
            </div>
          ) : undefined
        }
      >
        <p className="preview-label">This exact text will be sent</p>
        <pre className="preview-text">{finalPrompt}</pre>
        {runRoute.ok ? <Destination route={runRoute} cloudModel={status.runtime.cloudModel} /> : <BlockedNote decision={runRoute} onAllowCloud={() => void setLocalOnly(false)} />}
      </Sheet>

      {/* Versions and compare. */}
      <Sheet open={sheet === 'versions'} onClose={() => { setSheet(null); setCompareId(null); }} title="Versions" wide>
        {compareId ? (
          <Compare draft={draft} versionId={compareId} onBack={() => setCompareId(null)} />
        ) : (
          <ul className="versions">
            {draft.versions.map((v) => (
              <li key={v.id} className={v.id === draft.activeVersionId ? 'is-active' : ''}>
                <button
                  type="button"
                  className="version-pick"
                  onClick={async () => {
                    await flush();
                    await db.drafts.update(draft.id, { activeVersionId: v.id, title: titleFrom(v.text, draft.title), updatedAt: Date.now() });
                    setSheet(null);
                  }}
                >
                  <span className="version-name">
                    {v.label}
                    {v.id === draft.activeVersionId ? <span className="version-using">In use</span> : null}
                  </span>
                  <span className="version-excerpt">{v.text.slice(0, 140) || 'Empty'}</span>
                  <span className="version-meta">
                    {v.source ? <SourceBadge source={v.source} model={v.model} /> : null}
                    <span>{relativeTime(v.createdAt)}</span>
                  </span>
                </button>
                {v.kind !== 'original' && draft.versions.some((x) => x.kind === 'original') ? (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCompareId(v.id)}>
                    <GitCompare aria-hidden />
                    Compare
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      {/* Delete: pick exactly what goes. */}
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete">
        <div className="delete-list">
          <button
            type="button"
            className="improve-row"
            disabled={!draft.hasAudio}
            onClick={async () => {
              await deleteAudio(draft.id);
              setSheet(null);
              toast('Audio deleted. The text is kept.');
            }}
          >
            <span className="improve-icon" aria-hidden>
              <FileAudio />
            </span>
            <span className="improve-text">
              <span className="improve-title">Delete the audio only</span>
              <span className="improve-sub">{draft.hasAudio ? 'Keep the text and versions.' : 'Already deleted.'}</span>
            </span>
          </button>
          <button
            type="button"
            className="improve-row"
            disabled={!draft.versions.length}
            onClick={async () => {
              await deleteTranscript(draft.id);
              setSheet(null);
              toast('Text deleted. The audio is kept.');
            }}
          >
            <span className="improve-icon" aria-hidden>
              <RotateCcw />
            </span>
            <span className="improve-text">
              <span className="improve-title">Delete the text only</span>
              <span className="improve-sub">Transcript and all versions. Keep the audio.</span>
            </span>
          </button>
          <button
            type="button"
            className="improve-row is-danger"
            onClick={async () => {
              setSheet(null);
              await deleteDraft(draft.id, true);
              close();
              toast('Draft deleted from this device');
            }}
          >
            <span className="improve-icon" aria-hidden>
              <Trash2 />
            </span>
            <span className="improve-text">
              <span className="improve-title">Delete everything</span>
              <span className="improve-sub">Audio, text, versions{draft.chatId ? ', the chat and its answers' : ''}. This can't be undone.</span>
            </span>
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function whereText(d: RouteDecision): string {
  if (!d.ok) return '…';
  return d.expect === 'device' ? ' on this device…' : ' in the cloud…';
}

function RouteHint({ decision }: { decision: RouteDecision }) {
  if (!decision.ok) return <span className="route-hint is-off">Unavailable</span>;
  return (
    <span className={`route-hint is-${decision.expect}`}>
      {decision.expect === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden />}
      {decision.expect === 'device' ? 'This device' : 'Cloud'}
    </span>
  );
}

export function Destination({ route, cloudModel }: { route: Route; cloudModel: string }) {
  const device = route.expect === 'device';
  return (
    <div className={`destination is-${route.expect}`}>
      <span className="destination-icon" aria-hidden>
        {device ? <Smartphone /> : <Cloud />}
      </span>
      <div>
        <div className="destination-title">{device ? `On this device: ${DEVICE_MODEL_LABEL}` : `Cloud: ${cloudModel} through Firebase AI Logic`}</div>
        <div className="destination-why">{route.reason}</div>
        {route.mayUse.length > 1 ? (
          <div className="destination-why">{device ? 'If the on-device model fails, Gemini in the cloud answers instead.' : 'If the cloud fails, the on-device model answers instead.'}</div>
        ) : null}
      </div>
    </div>
  );
}

export function BlockedNote({ decision, onAllowCloud }: { decision: RouteDecision; onAllowCloud?: () => void }) {
  const { settings } = useSettings();
  if (decision.ok) return null;
  return (
    <div className="blocked">
      <p>{decision.reason}</p>
      <div className="blocked-actions">
        {decision.fix === 'allow-cloud' && onAllowCloud && settings.preference !== 'device-only' ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onAllowCloud}>
            Allow the cloud for this draft
          </button>
        ) : null}
        {decision.fix === 'allow-cloud' && settings.preference === 'device-only' ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void setSetting('preference', 'auto')}>
            Let AI use the cloud
          </button>
        ) : null}
        {decision.fix === 'connect' && settings.workOffline ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void setSetting('workOffline', false)}>
            Turn off Work offline
          </button>
        ) : null}
        {decision.fix === 'connect' && !settings.workOffline ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void refreshStatus()}>
            Check again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RetryNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="retry" role="alert">
      <p>{message}</p>
      <button type="button" className="btn btn-quiet btn-sm" onClick={onRetry}>
        <RotateCcw aria-hidden />
        Try again
      </button>
    </div>
  );
}

function ChoiceGroup({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <fieldset className="choices">
      <legend>{label}</legend>
      <div className="choice-row">
        {options.map((o) => (
          <button key={o.id} type="button" className={`choice${o.id === value ? ' is-on' : ''}`} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Compare({ draft, versionId, onBack }: { draft: Draft; versionId: string; onBack: () => void }) {
  const original = draft.versions.find((v) => v.kind === 'original');
  const other = draft.versions.find((v) => v.id === versionId);
  if (!original || !other) return null;
  const parts = wordDiff(original.text, other.text);
  return (
    <div className="compare">
      <button type="button" className="link-btn" onClick={onBack}>
        Back to versions
      </button>
      <p className="compare-legend">
        Original compared with <strong>{other.label}</strong>. <del>Removed words</del> and <ins>added words</ins> are marked.
      </p>
      <p className="compare-text">
        {parts.map((p, i) => (p.type === 'same' ? <span key={i}>{p.text}</span> : p.type === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
      </p>
    </div>
  );
}

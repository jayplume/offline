/**
 * Chat: answers stream in with a label saying where they were produced. Follow-ups use the same
 * hybrid route: on this device when possible, in the cloud when allowed. Firebase AI Logic runs
 * on-device inference one turn at a time, so the conversation is packed into each request.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowUp, Copy, FileText, Lock, Mic, RotateCcw, Square, Trash2, Cloud, Smartphone } from 'lucide-react';
import type { Content } from 'firebase/ai';
import { SurfaceBar, useSurface } from '../ui/Surface';
import { Confirm } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { SourceBadge, LocalOnlyBadge } from '../ui/Badge';
import { Markdown } from '../ui/Markdown';
import { db, deleteChat, titleFrom, uid, type Message } from '../../lib/db';
import { packHistory } from '../../lib/ai/prompts';
import { streamText, toUserError, transcribe } from '../../lib/ai/engine';
import type { Route } from '../../lib/ai/route';
import { useRoute } from '../useRoute';
import { getStatus, useStatus } from '../../lib/status';
import { takeRun } from '../runs';
import { clockTime } from '../../lib/text';
import { BlockedNote } from './Draft';
import { Recorder } from '../../lib/audio/recorder';
import { startCaptions, type CaptionSession } from '../../lib/speech';
import { readSettings } from '../../lib/db';

const CLOUD_HISTORY_CHARS = 60_000;

export function ChatSurface({ id }: { id: string }) {
  const { replace, close } = useSurface();
  const toast = useToast();
  const status = useStatus();
  const [chatId, setChatId] = useState<string | null>(id === 'new' ? null : id);
  const chat = useLiveQuery(() => (chatId ? db.chats.get(chatId) : undefined), [chatId]);
  const messages = useLiveQuery(() => (chatId ? db.messages.where('chatId').equals(chatId).sortBy('createdAt') : Promise.resolve([] as Message[])), [chatId]);
  const [draftText, setDraftText] = useState('');
  const [streaming, setStreaming] = useState<{ text: string; route: Route } | null>(null);
  const [error, setError] = useState<{ message: string; route: Route } | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [localOnlyNew, setLocalOnlyNew] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const localOnly = chat?.localOnly ?? localOnlyNew;

  const historyChars = useMemo(() => (messages ?? []).reduce((n, m) => n + m.text.length, 0), [messages]);
  const route = useRoute('chat', localOnly, historyChars + draftText.length);

  useEffect(() => {
    void readSettings().then((s) => setLocalOnlyNew(s.defaultLocalOnly));
  }, []);

  const scrollDown = () => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }));

  const run = useCallback(
    async (cid: string, r: Route) => {
      const all = await db.messages.where('chatId').equals(cid).sortBy('createdAt');
      const budget = r.expect === 'device' ? getStatus().runtime.deviceCharBudget : CLOUD_HISTORY_CHARS;
      const turns = packHistory(
        all.filter((m) => m.status === 'done').map((m) => ({ role: m.role, text: m.text })),
        budget,
      );
      const contents: Content[] = turns.map((t) => ({ role: t.role, parts: [{ type: 'text' as const, text: t.text }] }));
      setError(null);
      setStreaming({ text: '', route: r });
      scrollDown();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await streamText(contents, {
          task: 'chat',
          route: r,
          itemId: cid,
          signal: ctrl.signal,
          onText: (full) => {
            setStreaming({ text: full, route: r });
          },
        });
        const now = Date.now();
        await db.messages.add({ id: uid(), chatId: cid, role: 'model', text: res.text, createdAt: now, source: res.source, model: res.model, ms: res.ms, status: 'done', fellBackFrom: res.fellBackFrom });
        await db.chats.update(cid, { updatedAt: now });
      } catch (err) {
        const e = toUserError(err);
        if (e.code === 'cancelled') {
          toast('Stopped');
        } else {
          setError({ message: e.message, route: r });
        }
      } finally {
        setStreaming(null);
        abort.current = null;
        scrollDown();
      }
    },
    [toast],
  );

  // A run confirmed in the send preview starts here, exactly once.
  useEffect(() => {
    if (!chatId) {
      window.setTimeout(() => inputRef.current?.focus(), 450);
      return;
    }
    const pending = takeRun(chatId);
    if (pending) void run(chatId, pending.route);
  }, [chatId, run]);

  useEffect(() => {
    scrollDown();
  }, [messages?.length]);

  useEffect(() => () => abort.current?.abort(), []);

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draftText]);

  const send = async () => {
    const text = draftText.trim();
    if (!text || !route.ok || streaming) return;
    const now = Date.now();
    let cid = chatId;
    if (!cid) {
      cid = uid();
      await db.chats.add({ id: cid, title: titleFrom(text, 'New chat'), createdAt: now, updatedAt: now, draftId: null, localOnly: localOnlyNew });
      setChatId(cid);
    }
    await db.messages.add({ id: uid(), chatId: cid, role: 'user', text, createdAt: now, status: 'done' });
    await db.chats.update(cid, { updatedAt: now });
    setDraftText('');
    void run(cid, route);
  };

  const setLocal = async (v: boolean) => {
    if (chatId) await db.chats.update(chatId, { localOnly: v });
    else setLocalOnlyNew(v);
    toast(v ? 'This chat will never use the cloud' : 'Cloud allowed for this chat');
  };

  const copyAll = async () => {
    const text = (messages ?? []).map((m) => `${m.role === 'user' ? 'You' : 'AI'}: ${m.text}`).join('\n\n');
    await navigator.clipboard.writeText(text);
    toast('Conversation copied');
  };

  const lastUserWaiting = messages && messages.length > 0 && messages[messages.length - 1].role === 'user' && !streaming;

  return (
    <div className="tool tool-chat">
      <SurfaceBar
        title={chat?.title ? 'Chat' : 'Ask'}
        sub={
          <span className="bar-status">
            {localOnly ? <LocalOnlyBadge /> : null}
            {chat?.title ? <span className="bar-chat-title">{chat.title}</span> : 'Nothing is sent until you press Send'}
          </span>
        }
        menu={[
          { key: 'local', label: 'Keep on this device only', hint: 'Never use the cloud for this chat', icon: <Lock />, checked: localOnly, onSelect: () => void setLocal(!localOnly) },
          ...(chat?.draftId ? [{ key: 'draft', label: 'Open the draft', icon: <FileText />, onSelect: () => replace({ kind: 'draft', id: chat.draftId! }) }] : []),
          { key: 'copy', label: 'Copy conversation', icon: <Copy />, disabled: !messages?.length, onSelect: () => void copyAll() },
          { key: 'delete', label: 'Delete chat', icon: <Trash2 />, divided: true, disabled: !chatId, onSelect: () => setAskDelete(true) },
        ]}
      />

      <div className="tool-scroll chat-scroll" ref={scroller}>
        {!messages?.length && !streaming ? (
          <div className="chat-empty">
            <p className="chat-empty-title">Ask anything.</p>
            <p className="muted">
              {route.ok
                ? route.expect === 'device'
                  ? 'Answers come from the model on this device. Nothing leaves it.'
                  : `Answers come from ${status.runtime.cloudModel} in the cloud, only after you press Send.`
                : route.reason}
            </p>
          </div>
        ) : null}
        <ol className="messages">
          {(messages ?? []).map((m) => (
            <li key={m.id} className={`msg msg-${m.role}`}>
              {m.role === 'user' ? (
                <div className="bubble">{m.text}</div>
              ) : (
                <div className="answer">
                  <Markdown text={m.text} />
                  <div className="answer-meta">
                    {m.source ? <SourceBadge source={m.source} model={m.model} fellBack={Boolean(m.fellBackFrom)} /> : null}
                    <span>{clockTime(m.createdAt)}</span>
                    {m.ms ? <span className="tabular">{(m.ms / 1000).toFixed(1)} s</span> : null}
                    <button type="button" className="mini-btn" onClick={() => void navigator.clipboard.writeText(m.text).then(() => toast('Copied'))} aria-label="Copy answer">
                      <Copy aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {streaming ? (
            <li className="msg msg-model">
              <div className="answer is-streaming">
                {streaming.text ? <Markdown text={streaming.text} /> : <Thinking where={streaming.route.expect} />}
                <div className="answer-meta">
                  <span className={`route-hint is-${streaming.route.expect}`}>
                    {streaming.route.expect === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden />}
                    {streaming.route.expect === 'device' ? 'Answering on this device' : 'Answering in the cloud'}
                  </span>
                  <button type="button" className="mini-btn" onClick={() => abort.current?.abort()} aria-label="Stop answer">
                    <Square aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ) : null}
        </ol>
        {error ? (
          <div className="retry" role="alert">
            <p>{error.message}</p>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => chatId && void run(chatId, route.ok ? route : error.route)}>
              <RotateCcw aria-hidden />
              Try again
            </button>
          </div>
        ) : null}
        {lastUserWaiting && !error && chatId ? (
          <div className="retry">
            <p>This message hasn't been answered yet.</p>
            {route.ok ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void run(chatId, route)}>
                Answer it now
              </button>
            ) : (
              <BlockedNote decision={route} onAllowCloud={() => void setLocal(false)} />
            )}
          </div>
        ) : null}
      </div>

      <footer className="composer">
        {!route.ok && (messages?.length ?? 0) > 0 && !lastUserWaiting ? <p className="composer-note">{route.reason}</p> : null}
        <div className="composer-box">
          <textarea
            ref={inputRef}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={messages?.length ? 'Ask a follow-up' : 'Type your question'}
            aria-label="Message"
            rows={1}
          />
          <Dictate localOnly={localOnly} onText={(t) => setDraftText((cur) => (cur ? `${cur.trimEnd()} ${t}` : t))} />
          <button type="button" className="send-btn" onClick={() => void send()} disabled={!draftText.trim() || !route.ok || Boolean(streaming)} aria-label="Send">
            <ArrowUp aria-hidden />
          </button>
        </div>
        <div className="composer-where">
          {route.ok ? (
            <span className={`route-hint is-${route.expect}`}>
              {route.expect === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden />}
              {route.expect === 'device' ? 'Runs on this device' : `Runs in the cloud (${status.runtime.cloudModel})`}
            </span>
          ) : (
            <span className="route-hint is-off">AI unavailable right now</span>
          )}
        </div>
      </footer>

      <Confirm
        open={askDelete}
        title="Delete this chat?"
        body={<p>The questions and answers are removed from this device. The draft it came from stays.</p>}
        confirmLabel="Delete chat"
        onCancel={() => setAskDelete(false)}
        onConfirm={async () => {
          setAskDelete(false);
          if (chatId) await deleteChat(chatId);
          close();
          toast('Chat deleted');
        }}
      />
    </div>
  );
}

function Thinking({ where }: { where: 'device' | 'cloud' }) {
  return (
    <p className="thinking" aria-live="polite">
      <span className="dots3" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {where === 'device' ? 'Thinking on this device' : 'Asking Gemini in the cloud'}
    </p>
  );
}

/**
 * Voice for follow-ups. Uses on-device captions when Chrome has them (nothing leaves the device);
 * otherwise records and, only if the cloud is allowed, transcribes with Gemini into the box,
 * where it can be reviewed before sending.
 */
function Dictate({ localOnly, onText }: { localOnly: boolean; onText: (t: string) => void }) {
  const status = useStatus();
  const toast = useToast();
  const transcribeRoute = useRoute('transcribe', localOnly, 0);
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle');
  const rec = useRef<Recorder | null>(null);
  const cap = useRef<CaptionSession | null>(null);
  const onDevice = status.speech === 'available';
  const usable = onDevice || transcribeRoute.ok;

  const start = async () => {
    const settings = await readSettings();
    const r = new Recorder();
    try {
      await r.start(settings.micDeviceId || undefined);
    } catch (err) {
      toast((err as Error).message);
      return;
    }
    rec.current = r;
    if (onDevice) cap.current = startCaptions({ lang: settings.speechLang, track: r.track, clock: () => r.elapsedMs(), onUpdate: () => {} });
    setState('listening');
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    const captions = cap.current?.stop();
    cap.current = null;
    const { blob } = await r.stop();
    if (captions && captions.finals.length) {
      onText(captions.finals.map((f) => f.text).join(' '));
      setState('idle');
      return;
    }
    if (!transcribeRoute.ok) {
      toast(transcribeRoute.reason);
      setState('idle');
      return;
    }
    setState('working');
    try {
      const { segments } = await transcribe(blob, { route: transcribeRoute });
      const text = segments.map((s) => s.text).join(' ').trim();
      if (text) onText(text);
      else toast("Didn't catch any speech");
    } catch (err) {
      toast(toUserError(err).message);
    } finally {
      setState('idle');
    }
  };

  return (
    <button
      type="button"
      className={`dictate-btn is-${state}`}
      disabled={!usable || state === 'working'}
      onClick={() => void (state === 'listening' ? stop() : start())}
      aria-label={state === 'listening' ? 'Stop dictating' : 'Dictate'}
      title={!usable ? (transcribeRoute.ok ? '' : transcribeRoute.reason) : onDevice ? 'Dictate on this device' : 'Dictate (transcribed in the cloud)'}
    >
      {state === 'working' ? <span className="spinner" aria-hidden /> : state === 'listening' ? <Square aria-hidden /> : <Mic aria-hidden />}
    </button>
  );
}

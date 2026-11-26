/**
 * Notes: one tap opens a blank page with the cursor ready. Saved on this device as you type.
 * Summaries use the hybrid route; long notes kept on-device are summarized in parts.
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Lock, ListCollapse, Sparkles, Trash2, X } from 'lucide-react';
import { SurfaceBar, useSurface } from '../ui/Surface';
import { Confirm, Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { SourceBadge, LocalOnlyBadge } from '../ui/Badge';
import { Markdown } from '../ui/Markdown';
import { createDraft, db, readSettings, titleFrom, uid, editActiveText, type Note } from '../../lib/db';
import { summarize, toUserError } from '../../lib/ai/engine';
import { useRoute } from '../useRoute';
import { wordCount } from '../../lib/text';
import { BlockedNote, Destination } from './Draft';
import { useStatus } from '../../lib/status';

export function NoteSurface({ id }: { id: string }) {
  const { close, replace } = useSurface();
  const toast = useToast();
  const status = useStatus();
  const [noteId, setNoteId] = useState<string | null>(id === 'new' ? null : id);
  const note = useLiveQuery(() => (noteId ? db.notes.get(noteId) : undefined), [noteId]);
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(id === 'new');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askSummary, setAskSummary] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [localOnlyNew, setLocalOnlyNew] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  const creating = useRef<Promise<string> | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const summaryAt = note?.summary?.at;
  useEffect(() => {
    if (summaryAt && Date.now() - summaryAt < 5000) summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [summaryAt]);
  const localOnly = note?.localOnly ?? localOnlyNew;
  const route = useRoute('summarize', localOnly, body.length);

  useEffect(() => {
    void readSettings().then((s) => setLocalOnlyNew(s.defaultLocalOnly));
  }, []);

  useEffect(() => {
    if (!loaded && note) {
      setBody(note.body);
      setLoaded(true);
    }
  }, [note, loaded]);

  useEffect(() => {
    // The page is ready to type the moment it appears.
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, []);

  const ensureNote = async (): Promise<string> => {
    if (noteId) return noteId;
    if (!creating.current) {
      creating.current = (async () => {
        const now = Date.now();
        const n: Note = { id: uid(), body: '', createdAt: now, updatedAt: now, localOnly: localOnlyNew };
        await db.notes.add(n);
        setNoteId(n.id);
        return n.id;
      })();
    }
    return creating.current;
  };

  const save = async (text: string) => {
    const nid = await ensureNote();
    await db.notes.update(nid, { body: text, updatedAt: Date.now() });
    setSaved('saved');
  };

  const onChange = (v: string) => {
    setBody(v);
    setSaved('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(v), 300);
  };

  const finish = async () => {
    window.clearTimeout(timer.current);
    if (body.trim()) await save(body);
    else if (noteId) await db.notes.delete(noteId);
    close();
  };

  const runSummary = async () => {
    if (!route.ok) return;
    setAskSummary(false);
    setBusy(true);
    setError(null);
    try {
      const nid = await ensureNote();
      await save(body);
      const res = await summarize(body, { route, itemId: nid });
      await db.notes.update(nid, { summary: { text: res.text.trim(), source: res.source, model: res.model, at: Date.now(), parts: res.parts } });
      toast(res.source === 'device' ? (res.parts > 1 ? `Summarized on this device in ${res.parts} parts` : 'Summarized on this device') : 'Summarized in the cloud');
    } catch (err) {
      setError(toUserError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const toPrompt = async () => {
    if (!body.trim()) return;
    await save(body);
    const draft = await createDraft({ localOnly, title: titleFrom(body, 'From a note') });
    await editActiveText(draft.id, body.trim());
    replace({ kind: 'draft', id: draft.id });
  };

  const setLocal = async (v: boolean) => {
    if (noteId) await db.notes.update(noteId, { localOnly: v });
    else setLocalOnlyNew(v);
    toast(v ? 'This note will never use the cloud' : 'Cloud allowed for this note');
  };

  return (
    <div className="tool tool-note">
      <SurfaceBar
        title="Note"
        sub={
          <span className="bar-status">
            {localOnly ? <LocalOnlyBadge /> : null}
            {saved === 'saving' ? 'Saving…' : body.trim() ? 'Saved on this device' : 'Start typing'}
          </span>
        }
        onCancel={() => void finish()}
        menu={[
          { key: 'sum', label: 'Summarize', hint: route.ok ? (route.expect === 'device' ? 'On this device' : 'In the cloud') : 'Unavailable right now', icon: <ListCollapse />, disabled: wordCount(body) < 12, onSelect: () => setAskSummary(true) },
          { key: 'prompt', label: 'Turn into a prompt', hint: 'Shape it and run it with AI', icon: <Sparkles />, disabled: !body.trim(), onSelect: () => void toPrompt() },
          { key: 'local', label: 'Keep on this device only', icon: <Lock />, checked: localOnly, onSelect: () => void setLocal(!localOnly) },
          { key: 'copy', label: 'Copy', icon: <Copy />, disabled: !body.trim(), onSelect: () => void navigator.clipboard.writeText(body).then(() => toast('Copied')) },
          { key: 'delete', label: 'Delete note', icon: <Trash2 />, divided: true, disabled: !noteId, onSelect: () => setAskDelete(true) },
        ]}
      />
      <div className="tool-scroll note-scroll">
        <textarea
          ref={ref}
          className="note-text"
          value={body}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write anything. It stays on this device."
          aria-label="Note"
        />
        {busy ? (
          <div className="working">
            <span className="spinner" aria-hidden />
            <span>{route.ok && route.expect === 'device' ? 'Summarizing on this device…' : 'Summarizing in the cloud…'}</span>
          </div>
        ) : null}
        {error ? (
          <div className="retry" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void runSummary()}>
              Try again
            </button>
          </div>
        ) : null}
        {note?.summary ? (
          <section className="summary" ref={summaryRef}>
            <div className="summary-head">
              <span>Summary</span>
              <SourceBadge source={note.summary.source} model={note.summary.model} />
              {note.summary.parts > 1 ? <span className="muted small">{note.summary.parts} parts</span> : null}
              <button type="button" className="icon-btn" aria-label="Remove summary" onClick={() => noteId && void db.notes.update(noteId, { summary: undefined })}>
                <X aria-hidden />
              </button>
            </div>
            <Markdown text={note.summary.text} />
          </section>
        ) : null}
      </div>
      <div className="note-foot">
        <span className="tabular">{wordCount(body)} words</span>
      </div>

      <Sheet
        open={askSummary}
        onClose={() => setAskSummary(false)}
        title="Summarize this note"
        footer={
          route.ok ? (
            <div className="sheet-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setAskSummary(false)}>
                Not now
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void runSummary()} data-autofocus>
                Summarize
              </button>
            </div>
          ) : undefined
        }
      >
        <p className="muted">
          {wordCount(body)} words. {route.ok && route.expect === 'device' && body.length > status.runtime.deviceCharBudget ? 'This is long for the on-device model, so it will be summarized in parts and merged, all on this device.' : ''}
        </p>
        {route.ok ? <Destination route={route} cloudModel={status.runtime.cloudModel} /> : <BlockedNote decision={route} onAllowCloud={() => void setLocal(false)} />}
      </Sheet>

      <Confirm
        open={askDelete}
        title="Delete this note?"
        body={<p>It will be removed from this device. This can't be undone.</p>}
        confirmLabel="Delete note"
        onCancel={() => setAskDelete(false)}
        onConfirm={async () => {
          setAskDelete(false);
          window.clearTimeout(timer.current);
          if (noteId) await db.notes.delete(noteId);
          close();
          toast('Note deleted');
        }}
      />
    </div>
  );
}

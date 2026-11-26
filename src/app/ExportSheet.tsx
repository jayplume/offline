/**
 * Export a conversation, to work on it somewhere else: as it was, or rewritten for a cofounder,
 * a teammate or as meeting notes (by the same hybrid AI: on this device when it can). Then save
 * it as a PDF or Markdown file, copy it, or hand it to another app with the share sheet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Copy, FileDown, FileText, RotateCcw, Share2, Smartphone } from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { Markdown } from './ui/Markdown';
import { useToast } from './ui/Toast';
import { useRoute } from './useRoute';
import { useSettings } from './settings';
import { DEVICE_MODEL_LABEL, runText, toUserError } from '../lib/ai/engine';
import { EXPORT_STYLES, conversationText, exportPrompt, type ExportStyle } from '../lib/ai/prompts';
import { getStatus, useStatus } from '../lib/status';
import { canShare, downloadText, longDate, printDocument, rawMarkdown, shareDocument, slugify } from '../lib/export';
import type { Message } from '../lib/db';

const ORDER: ExportStyle[] = ['raw', 'cofounder', 'teammate', 'meeting'];
const SHORT: Record<ExportStyle, string> = { raw: 'As it was', cofounder: 'Cofounder', teammate: 'Teammate', meeting: 'Meeting notes' };
const KIND_LINE: Record<Exclude<ExportStyle, 'raw'>, string> = {
  cofounder: 'Brief for a cofounder',
  teammate: 'Hand-off note for a teammate',
  meeting: 'Meeting notes',
};

interface Written {
  md: string;
  by: string;
}

export function ExportSheet({
  open,
  onClose,
  title,
  messages,
  localOnly,
  chatId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  messages: Message[];
  localOnly: boolean;
  chatId: string | null;
  initial: ExportStyle;
}) {
  const toast = useToast();
  const status = useStatus();
  const [style, setStyle] = useState<ExportStyle>(initial);
  const [written, setWritten] = useState<Partial<Record<ExportStyle, Written>>>({});
  const [busy, setBusy] = useState<ExportStyle | null>(null);
  const [error, setError] = useState<{ style: ExportStyle; message: string } | null>(null);
  const docRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => messages.filter((m) => m.status === 'done').map((m) => ({ role: m.role, text: m.text })), [messages]);
  const chars = useMemo(() => turns.reduce((n, t) => n + t.text.length + 6, 0), [turns]);
  const { settings } = useSettings();
  // On the device, a long conversation is trimmed to its newest part rather than refused.
  const deviceOnly = localOnly || settings.preference === 'device-only';
  const route = useRoute('export', localOnly, deviceOnly ? Math.min(chars, Math.floor(status.runtime.deviceCharBudget * 0.85)) : chars);

  // The conversation changed (a new answer): earlier write-ups no longer cover all of it.
  useEffect(() => setWritten({}), [messages.length]);
  useEffect(() => {
    if (open) {
      setStyle(initial);
      setError(null);
    }
  }, [open, initial]);

  const write = async (st: Exclude<ExportStyle, 'raw'>) => {
    if (!route.ok) return;
    setBusy(st);
    setError(null);
    const budget = route.expect === 'device' ? Math.floor(getStatus().runtime.deviceCharBudget * 0.85) : 60_000;
    const conv = conversationText(turns, budget);
    try {
      const res = await runText(exportPrompt(st, conv.text, conv.trimmed), { task: 'export', route, itemId: chatId ?? undefined });
      const by = res.source === 'device' ? `${DEVICE_MODEL_LABEL}, on this device` : `${res.model}, in the cloud`;
      // Models sometimes wrap the whole thing in a fence or add a title line; the document has its own.
      const md = res.text
        .trim()
        .replace(/^```(?:markdown|md)?\s*/i, '')
        .replace(/```$/, '')
        .replace(/^#\s+.*\n+/, '')
        .trim();
      setWritten((w) => ({ ...w, [st]: { md, by } }));
    } catch (err) {
      setError({ style: st, message: toUserError(err).message });
    } finally {
      setBusy(null);
    }
  };

  // Choosing a style is the go-ahead: it is written right away, where the line above says.
  useEffect(() => {
    if (!open || style === 'raw' || written[style] || busy || error?.style === style || !route.ok) return;
    void write(style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, style, written, busy, route.ok]);

  const date = longDate();
  const raw = useMemo(() => rawMarkdown(title, messages, DEVICE_MODEL_LABEL), [title, messages]);
  const shaped = style === 'raw' ? null : written[style];
  const markdown =
    style === 'raw'
      ? raw
      : shaped
        ? `# ${title}\n\n_${KIND_LINE[style]}, ${date}._\n\n${shaped.md}\n\n---\n\n_Written by ${shaped.by}, from a conversation in Offline._\n`
        : null;
  const ready = Boolean(markdown) && busy !== style;
  const fileBase = `${slugify(title)}${style === 'raw' ? '' : `-${style}`}`;
  const docTitle = style === 'raw' ? title : `${title} (${KIND_LINE[style]})`;

  const savePdf = () => {
    if (!docRef.current) return;
    printDocument(docTitle, docRef.current.innerHTML);
  };
  const saveMd = () => {
    if (!markdown) return;
    downloadText(`${fileBase}.md`, markdown);
    toast('Saved as a Markdown file');
  };
  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      toast('Copied');
    } catch {
      toast("Couldn't copy here. Try Markdown or Share.");
    }
  };
  const share = async () => {
    if (!markdown) return;
    const r = await shareDocument(docTitle, `${fileBase}.md`, markdown);
    if (r === 'failed') toast("Couldn't open sharing here. Try Markdown or Copy.");
  };

  const where = (
    <span className={`route-hint is-${route.ok ? route.expect : 'off'}`}>
      {route.ok ? route.expect === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden /> : null}
      {route.ok ? (route.expect === 'device' ? 'Written on this device' : `Written in the cloud (${status.runtime.cloudModel})`) : route.reason}
    </span>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export conversation"
      wide
      footer={
        <div className="export-actions">
          <button type="button" className="export-act is-primary" onClick={savePdf} disabled={!ready} data-autofocus>
            <FileDown aria-hidden />
            <span>Save as PDF</span>
          </button>
          <button type="button" className="export-act" onClick={saveMd} disabled={!ready}>
            <FileText aria-hidden />
            <span>Markdown</span>
          </button>
          <button type="button" className="export-act" onClick={() => void copy()} disabled={!ready}>
            <Copy aria-hidden />
            <span>Copy</span>
          </button>
          {canShare() ? (
            <button type="button" className="export-act" onClick={() => void share()} disabled={!ready}>
              <Share2 aria-hidden />
              <span>Share</span>
            </button>
          ) : null}
        </div>
      }
    >
      <div className="export-styles" role="radiogroup" aria-label="How to export it">
        {ORDER.map((st) => (
          <button key={st} type="button" role="radio" aria-checked={style === st} className={`choice${style === st ? ' is-on' : ''}`} onClick={() => setStyle(st)}>
            {SHORT[st]}
          </button>
        ))}
      </div>
      <p className="export-hint">{EXPORT_STYLES[style].hint}</p>
      {style !== 'raw' && route.ok ? <p className="export-where">{where}</p> : null}

      <div className="export-doc" aria-live="polite">
        {busy === style ? (
          <p className="thinking">
            <span className="dots3" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {route.ok && route.expect === 'device' ? 'Writing it on this device' : 'Asking Gemini to write it'}
          </p>
        ) : error?.style === style ? (
          <div className="retry" role="alert">
            <p>{error.message}</p>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => style !== 'raw' && void write(style)}>
              <RotateCcw aria-hidden />
              Try again
            </button>
          </div>
        ) : markdown ? (
          <div ref={docRef} className="doc">
            <h1>{title}</h1>
            <p className="doc-meta">
              {style === 'raw'
                ? `Exported from Offline on ${date}. ${turns.length} message${turns.length === 1 ? '' : 's'}.`
                : `${KIND_LINE[style]}, ${date}.`}
            </p>
            {style === 'raw' ? (
              messages
                .filter((m) => m.status === 'done')
                .map((m) => (
                  <div key={m.id} className="doc-msg">
                    <p className="doc-who">
                      {m.role === 'user' ? 'You' : 'AI'}
                      {m.role === 'model' && m.source ? (m.source === 'device' ? ', on this device' : `, in the cloud (${m.model ?? 'Gemini'})`) : ''}
                    </p>
                    <Markdown text={m.text} />
                  </div>
                ))
            ) : (
              <>
                <Markdown text={shaped!.md} />
                <p className="doc-foot">Written by {shaped!.by}, from a conversation in Offline.</p>
              </>
            )}
          </div>
        ) : (
          <p className="export-wait">{route.ok ? 'Choose a style above.' : `${route.reason} “As it was” still works.`}</p>
        )}
      </div>
    </Sheet>
  );
}

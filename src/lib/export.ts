/**
 * Moving a conversation out of Offline: as Markdown text, a Markdown file, a PDF (through the
 * browser's own Save as PDF), or the system share sheet. Everything here works with no network.
 */
import type { Message } from './db';

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 60)
      .replace(/-+$/, '') || 'offline-conversation'
  );
}

export function longDate(t = Date.now()): string {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function shortTime(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Every message as it was, with when it was sent and where each answer ran. */
export function rawMarkdown(title: string, messages: Message[], deviceLabel: string): string {
  const done = messages.filter((m) => m.status === 'done');
  const out = [`# ${title}`, '', `_Exported from Offline on ${longDate()}. ${done.length} message${done.length === 1 ? '' : 's'}._`, ''];
  for (const m of done) {
    const where = m.role === 'model' && m.source ? (m.source === 'device' ? `on this device (${deviceLabel})` : `in the cloud (${m.model ?? 'Gemini'})`) : '';
    out.push(`**${m.role === 'user' ? 'You' : 'AI'}**, ${shortTime(m.createdAt)}${where ? `, ${where}` : ''}`, '', m.text.trim(), '');
  }
  return out.join('\n').trimEnd() + '\n';
}

/** Saves text as a file, e.g. `notes.md`. */
export function downloadText(filename: string, text: string, mime = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const canShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** Opens the system share sheet with the document (as a file where supported, else as text). */
export async function shareDocument(title: string, filename: string, text: string): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    const file = new File([text], filename, { type: 'text/markdown' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ title, files: [file] });
    else await navigator.share({ title, text });
    return 'shared';
  } catch (err) {
    return (err as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

const PRINT_CSS = `
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1b232b; font: 11pt/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
h1 { font-size: 19pt; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 4pt; }
.doc-meta { color: #5b6772; font-size: 9.5pt; margin: 0 0 16pt; }
.md p { margin: 0 0 7pt; }
.md .md-h { font-size: 12.5pt; font-weight: 650; margin: 14pt 0 5pt; break-after: avoid; }
.md ul, .md ol { margin: 0 0 8pt; padding-left: 16pt; }
.md li { margin: 0 0 3pt; }
.md code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9.5pt; }
.md-task { list-style: none; margin-left: -14pt; }
.md-check { display: inline-block; width: 14pt; }
.doc-msg { break-inside: avoid; margin: 0 0 11pt; }
.doc-who { color: #5b6772; font-size: 9pt; margin: 0 0 2pt; }
.doc-foot { margin-top: 18pt; padding-top: 7pt; border-top: 1px solid #d6dde3; color: #5b6772; font-size: 9pt; }
`;

/**
 * Prints the document in a hidden frame, so the browser's dialog offers Save as PDF with just
 * the document, not the app around it. The title becomes the suggested file name.
 */
export function printDocument(title: string, bodyHtml: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  const safeTitle = title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
  doc.open();
  doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const pageTitle = document.title;
  const back = document.activeElement as HTMLElement | null;
  document.title = title; // Chrome names the PDF after the page that asked to print.
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    document.title = pageTitle;
    // Printing focused the frame; hand focus back to the button that asked for it.
    back?.focus?.({ preventScroll: true });
    window.setTimeout(() => frame.remove(), 500);
  };
  win.addEventListener('afterprint', done, { once: true });
  window.setTimeout(() => {
    win.focus();
    win.print();
    // Some browsers return from print() without firing afterprint.
    window.setTimeout(done, 60_000);
  }, 60);
}

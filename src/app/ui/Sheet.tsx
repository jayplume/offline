/**
 * Bottom sheet for focused choices (confirmations, the send preview, improve options, status).
 * Slides up calmly, closes on the backdrop, Escape, or its own buttons. Focus stays inside.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  label,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  label?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!mounted || !open || !panelRef.current) return;
    restore.current = document.activeElement as HTMLElement | null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    backRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 120 : 360, easing: 'ease-out' });
    panelRef.current.animate(
      reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { transform: 'translateY(100%)', opacity: 0.6 },
            { transform: 'none', opacity: 1 },
          ],
      { duration: reduce ? 120 : 480, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)' },
    );
    const first = panelRef.current.querySelector<HTMLElement>('[data-autofocus], textarea, input, button:not(.sheet-x)');
    first?.focus({ preventScroll: true });
  }, [mounted, open]);

  useEffect(() => {
    if (open || !mounted) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    backRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 100 : 260, fill: 'forwards' });
    const a = panelRef.current?.animate(
      reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'none' }, { transform: 'translateY(100%)' }],
      { duration: reduce ? 100 : 320, easing: 'cubic-bezier(0.45, 0, 0.75, 0.2)', fill: 'forwards' },
    );
    const done = () => {
      setMounted(false);
      restore.current?.focus?.({ preventScroll: true });
    };
    if (a) a.finished.then(done, done);
    else done();
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const f = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'));
        if (!f.length) return;
        const firstEl = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className="sheet-root">
      <div ref={backRef} className="sheet-backdrop" onClick={onClose} />
      <div ref={panelRef} className={`sheet${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title ?? label}>
        <div className="sheet-grip" aria-hidden />
        {title ? (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn sheet-x" aria-label="Close" onClick={onClose}>
              <X aria-hidden />
            </button>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** A yes/no question in a sheet. */
export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      label={title}
      footer={
        <div className="sheet-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <h2 className="confirm-title">{title}</h2>
      {body ? <div className="confirm-body">{body}</div> : null}
    </Sheet>
  );
}

export function SheetClose() {
  return <X aria-hidden />;
}

/**
 * The three-dot options menu. Pours out of its button (the genie) and back into it.
 * Choosing an item fades the menu instead, so the page that item opens has the stage.
 * Keyboard: arrows move, Enter selects, Escape closes and returns focus.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MOTION, boxOf, genie, reducedMotion, type Genie } from './genie';

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
  /** Visually separates this item from the ones above it. */
  divided?: boolean;
}

export function Menu({ items, label, children }: { items: MenuItem[]; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const run = useRef<Genie | null>(null);

  const closeMenu = (focusButton = true, how: 'genie' | 'fade' = 'genie') => {
    const list = listRef.current;
    const btn = btnRef.current;
    const finish = () => {
      setOpen(false);
      if (focusButton) btnRef.current?.focus();
    };
    const at = run.current ? run.current.progress() : 1;
    run.current?.cancel();
    run.current = null;
    if (!list) return finish();
    if (how === 'genie' && btn && !reducedMotion()) {
      // The copies finish the motion on their own; the live menu can go now.
      genie(list, { from: boxOf(btn.getBoundingClientRect()), mode: 'close', duration: MOTION.menuClose, zIndex: 61, at });
      return finish();
    }
    list.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 80 : 140, easing: 'ease-in', fill: 'forwards' }).finished.then(finish, finish);
  };

  useLayoutEffect(() => {
    if (!open || !listRef.current || !btnRef.current) return;
    const list = listRef.current;
    const g = genie(list, { from: boxOf(btnRef.current.getBoundingClientRect()), mode: 'open', duration: MOTION.menuOpen, zIndex: 61, ready: true });
    run.current = g;
    void g.finished.then(() => {
      if (run.current === g) run.current = null;
    });
    list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) closeMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(at + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };

  return (
    <div className="menu-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`icon-btn${open ? ' is-active' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? closeMenu() : setOpen(true))}
      >
        {children}
      </button>
      {open ? (
        <div ref={listRef} id={id} role="menu" aria-label={label} className="menu" onKeyDown={onListKey}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              disabled={it.disabled}
              className={`menu-item${it.divided ? ' is-divided' : ''}`}
              onClick={() => {
                closeMenu(false, 'fade');
                // Let the menu fade before a sheet or page pours out of this spot.
                window.setTimeout(it.onSelect, 120);
              }}
            >
              <span className="menu-icon" aria-hidden>
                {it.icon}
              </span>
              <span className="menu-text">
                <span className="menu-label">{it.label}</span>
                {it.hint ? <span className="menu-hint">{it.hint}</span> : null}
              </span>
              {it.checked ? <Check className="menu-check" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

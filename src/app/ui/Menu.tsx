/**
 * The three-dot options menu. Pours out of its button (the genie) and back into it.
 * Choosing an item fades the menu instead, so the page that item opens has the stage.
 * An item with `children` opens them in place (options inside options), with a way back.
 * Keyboard: arrows move, Enter selects, Right opens, Left goes back, Escape closes.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
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
  /** A second level, shown in place of this menu when the item is chosen. */
  children?: MenuItem[];
}

export function Menu({ items, label, children }: { items: MenuItem[]; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const run = useRef<Genie | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const parent = sub ? items.find((i) => i.key === sub) : undefined;
  const shown = parent?.children ?? items;

  const closeMenu = (focusButton = true, how: 'genie' | 'fade' = 'genie') => {
    const list = listRef.current;
    const btn = btnRef.current;
    const finish = () => {
      setOpen(false);
      setSub(null);
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

  // Moving between levels: a short slide in the direction of travel.
  const level = useRef(0);
  /** The parent whose options are showing, so going back returns focus to it. */
  const parentKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const next = sub ? 1 : 0;
    if (!open || !list || next === level.current) return;
    const dir = next > level.current ? 1 : -1;
    level.current = next;
    if (!reducedMotion()) {
      list.animate(
        [
          { opacity: 0.2, transform: `translateX(${dir * 14}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 200, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)' },
      );
    }
    list.querySelector<HTMLButtonElement>(sub ? '.menu-item:not(.menu-back):not(:disabled)' : `[data-key="${CSS.escape(parentKey.current ?? '')}"]`)?.focus({ preventScroll: true });
  }, [sub, open]);

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
    } else if (e.key === 'ArrowLeft' && sub) {
      e.preventDefault();
      setSub(null);
    } else if (e.key === 'ArrowRight') {
      const it = shown.find((i) => i.key === (document.activeElement as HTMLElement | null)?.dataset.key);
      if (it?.children?.length) {
        e.preventDefault();
        parentKey.current = it.key;
        setSub(it.key);
      }
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
        onClick={() => (open ? closeMenu() : (setSub(null), (level.current = 0), setOpen(true)))}
      >
        {children}
      </button>
      {open ? (
        <div ref={listRef} id={id} role="menu" aria-label={parent ? parent.label : label} className="menu" onKeyDown={onListKey}>
          {parent ? (
            <button type="button" role="menuitem" className="menu-item menu-back" data-key="__back" onClick={() => setSub(null)}>
              <span className="menu-icon" aria-hidden>
                <ChevronLeft />
              </span>
              <span className="menu-text">
                <span className="menu-label">{parent.label}</span>
              </span>
            </button>
          ) : null}
          {shown.map((it) => (
            <button
              key={it.key}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              aria-haspopup={it.children?.length ? 'menu' : undefined}
              disabled={it.disabled}
              data-key={it.key}
              className={`menu-item${it.divided ? ' is-divided' : ''}`}
              onClick={() => {
                if (it.children?.length) {
                  parentKey.current = it.key;
                  setSub(it.key);
                  return;
                }
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
              {it.children?.length ? <ChevronRight className="menu-more" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

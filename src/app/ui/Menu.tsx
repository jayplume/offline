/**
 * The three-dot options menu. Opens from the top-left corner with a short, calm scale-in.
 * Keyboard: arrows move, Enter selects, Escape closes and returns focus.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

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

  const closeMenu = (focusButton = true) => {
    const list = listRef.current;
    const finish = () => {
      setOpen(false);
      if (focusButton) btnRef.current?.focus();
    };
    if (!list || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    list
      .animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'scale(0.96) translateY(-4px)' },
        ],
        { duration: 160, easing: 'ease-in', fill: 'forwards' },
      )
      .finished.then(finish, finish);
  };

  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const list = listRef.current;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.animate(
        [
          { opacity: 0, transform: 'scale(0.94) translateY(-6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)' },
      );
    }
    list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
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
                closeMenu(false);
                // Let the menu finish closing before a sheet or surface opens on top.
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

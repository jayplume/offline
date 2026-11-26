/**
 * Surfaces: one active tool at a time, opened from the point you tapped.
 *
 * - "reveal": a circle grows from the tap point until it covers the screen (Record, chats, drafts).
 * - "rise": a calm fade and lift (Notes, Settings): no page-wide effect for simple screens.
 * Closing plays the same motion in reverse, back into the button or row it came from.
 * Moving between steps of one task (Record → Draft → Chat) crossfades inside the same surface.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { Menu, type MenuItem } from './Menu';

export type SurfaceKind = 'record' | 'draft' | 'chat' | 'note' | 'library' | 'history' | 'settings';

export interface SurfaceSpec {
  kind: SurfaceKind;
  id?: string;
  enter: 'reveal' | 'rise';
  origin?: { x: number; y: number } | null;
  /** Extra data for the surface, e.g. which library tab to show. */
  params?: Record<string, string>;
}

interface SurfaceApi {
  current: SurfaceSpec | null;
  open(spec: SurfaceSpec): void;
  /** Swap what the open surface shows, with a crossfade, keeping its origin for the close. */
  replace(spec: Omit<SurfaceSpec, 'enter' | 'origin'>): void;
  close(): void;
  closing: boolean;
}

const Ctx = createContext<SurfaceApi | null>(null);

export function useSurface(): SurfaceApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSurface outside SurfaceProvider');
  return v;
}

/** Where a tap happened, or the element's centre for keyboard activation. */
export function originOf(e: { clientX?: number; clientY?: number; currentTarget?: EventTarget | null }): { x: number; y: number } {
  const el = e.currentTarget as HTMLElement | null;
  if (e.clientX && e.clientY) return { x: e.clientX, y: e.clientY };
  if (el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Centre of an element: reveals start from the middle of the button, which reads calmer. */
export function centreOf(el: Element | null): { x: number; y: number } {
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<SurfaceSpec | null>(null);
  const [closing, setClosing] = useState(false);

  const open = useCallback((spec: SurfaceSpec) => {
    setClosing(false);
    setCurrent(spec);
  }, []);
  const replace = useCallback((spec: Omit<SurfaceSpec, 'enter' | 'origin'>) => {
    setCurrent((cur) => (cur ? { ...cur, ...spec } : { ...spec, enter: 'rise' }));
  }, []);
  const close = useCallback(() => setClosing(true), []);
  const finishClose = useCallback(() => {
    setCurrent(null);
    setClosing(false);
  }, []);

  const api = useMemo<SurfaceApi>(() => ({ current, open, replace, close, closing }), [current, open, replace, close, closing]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <FinishCloseBridge onFinish={finishClose} />
    </Ctx.Provider>
  );
}

// The layer reports the end of its exit animation through this event, keeping the provider simple.
const EXITED = 'offline:surface-exited';
function FinishCloseBridge({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const h = () => onFinish();
    window.addEventListener(EXITED, h);
    return () => window.removeEventListener(EXITED, h);
  }, [onFinish]);
  return null;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function radiusFor(x: number, y: number): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y))) + 2;
}

/** Hosts the open surface. `render` maps a spec to the tool's content. */
export function SurfaceHost({ render }: { render: (spec: SurfaceSpec) => ReactNode }) {
  const { current, closing } = useSurface();
  const layerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const shownKey = useRef<string | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // Enter.
  useLayoutEffect(() => {
    if (!current || !layerRef.current || !innerRef.current) return;
    if (shownKey.current) return; // already open: content swaps are handled by Crossfade
    shownKey.current = `${current.kind}:${current.id ?? ''}`;
    lastFocus.current = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('surface-open');
    const layer = layerRef.current;
    const inner = innerRef.current;
    if (reducedMotion()) {
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
      return;
    }
    if (current.enter === 'reveal') {
      const { x, y } = current.origin ?? { x: window.innerWidth / 2, y: window.innerHeight - 120 };
      const r = radiusFor(x, y);
      layer.animate(
        [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }],
        { duration: 780, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)' },
      );
      inner.animate(
        [
          { opacity: 0, transform: 'translateY(12px) scale(0.99)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 560, delay: 220, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)', fill: 'backwards' },
      );
    } else {
      layer.animate(
        [
          { opacity: 0, transform: 'translateY(22px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 460, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)' },
      );
    }
  }, [current]);

  // Exit.
  useEffect(() => {
    if (!closing || !current || !layerRef.current || !innerRef.current) return;
    const layer = layerRef.current;
    const inner = innerRef.current;
    const done = () => {
      shownKey.current = null;
      document.documentElement.classList.remove('surface-open');
      window.dispatchEvent(new Event(EXITED));
      lastFocus.current?.focus?.({ preventScroll: true });
    };
    if (reducedMotion()) {
      layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.then(done, done);
      return;
    }
    if (current.enter === 'reveal') {
      const { x, y } = current.origin ?? { x: window.innerWidth / 2, y: window.innerHeight - 120 };
      const r = radiusFor(x, y);
      inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
      layer
        .animate([{ clipPath: `circle(${r}px at ${x}px ${y}px)` }, { clipPath: `circle(0px at ${x}px ${y}px)` }], {
          duration: 620,
          delay: 90,
          easing: 'cubic-bezier(0.55, 0, 0.75, 0.3)',
          fill: 'forwards',
        })
        .finished.then(done, done);
    } else {
      layer
        .animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(16px)' },
          ],
          { duration: 300, easing: 'cubic-bezier(0.45, 0, 0.75, 0.2)', fill: 'forwards' },
        )
        .finished.then(done, done);
    }
  }, [closing, current]);

  if (!current) return null;
  const tone = current.kind === 'record' ? 'sky' : 'paper';
  return (
    <div ref={layerRef} className={`surface-layer tone-${tone}`} role="dialog" aria-modal="true" aria-label={labelFor(current.kind)}>
      <div ref={innerRef} className="surface-inner">
        <Crossfade k={`${current.kind}:${current.id ?? ''}`}>{render(current)}</Crossfade>
      </div>
    </div>
  );
}

function labelFor(kind: SurfaceKind): string {
  return { record: 'Recording', draft: 'Draft', chat: 'Chat', note: 'Note', library: 'Library', history: 'History', settings: 'Settings' }[kind];
}

/** Crossfades between steps of one task without remounting the layer. */
function Crossfade({ k, children }: { k: string; children: ReactNode }) {
  const [items, setItems] = useState<{ k: string; node: ReactNode; leaving: boolean }[]>([{ k, node: children, leaving: false }]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setItems((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.k === k) return prev.map((it) => (it.k === k ? { ...it, node: children } : it));
      return [...prev.filter((p) => p.k !== k).map((p) => ({ ...p, leaving: true })), { k, node: children, leaving: false }];
    });
  }, [k, children]);
  return (
    <>
      {items.map((it) => (
        <CrossItem key={it.k} leaving={it.leaving} onGone={() => setItems((p) => p.filter((x) => x.k !== it.k))}>
          {!it.leaving && it.k === k ? children : it.node}
        </CrossItem>
      ))}
    </>
  );
}

function CrossItem({ leaving, onGone, children }: { leaving: boolean; onGone: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!mounted.current) {
      mounted.current = true;
      // The very first item rides the layer's own entrance.
      if (el.parentElement && el.parentElement.children.length > 1 && !reducedMotion()) {
        el.animate(
          [
            { opacity: 0, transform: 'translateY(14px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 520, delay: 120, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)', fill: 'backwards' },
        );
      }
    }
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!leaving || !el) return;
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 80 : 220, easing: 'ease-out', fill: 'forwards' });
    a.finished.then(onGone, onGone);
  }, [leaving, onGone]);
  return (
    <div ref={ref} className={`surface-step${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined} inert={leaving || undefined}>
      {children}
    </div>
  );
}

/** The bar every tool shares: options on the left, the tool's name, cancel on the right. */
export function SurfaceBar({
  title,
  sub,
  menu,
  onCancel,
  cancelLabel = 'Close',
}: {
  title: string;
  sub?: ReactNode;
  menu?: MenuItem[];
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { close } = useSurface();
  return (
    <header className="surface-bar">
      <div className="bar-side">
        {menu && menu.length > 0 ? (
          <Menu items={menu} label={`${title} options`}>
            <MoreHorizontal aria-hidden />
          </Menu>
        ) : (
          <span className="bar-spacer" />
        )}
      </div>
      <div className="bar-title">
        <h1>{title}</h1>
        {sub ? <div className="bar-sub">{sub}</div> : null}
      </div>
      <div className="bar-side bar-right">
        <button type="button" className="icon-btn" aria-label={cancelLabel} onClick={onCancel ?? close}>
          <X aria-hidden />
        </button>
      </div>
    </header>
  );
}

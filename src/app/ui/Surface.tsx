/**
 * Surfaces: one active tool at a time, poured out of the control you tapped (the genie in
 * ./genie.ts) and poured back into it when it closes. Moving between steps of one task
 * (Record → Draft → Chat) pours the next step out of the button that started it, over the last.
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
import { MOTION, cancelGeniesIn, genie, markNavigation, reducedMotion, type Box, type Genie } from './genie';
import { recentTap, tapFor, whereNow, type Tap } from './tap';

export type SurfaceKind = 'record' | 'draft' | 'chat' | 'note' | 'library' | 'history' | 'settings';

export interface SurfaceSpec {
  kind: SurfaceKind;
  id?: string;
  /** Where it opened from; it closes back into the same place. Defaults to the last tap. */
  origin?: Tap | null;
  /** Where the current step poured out from, when a step replaced the one before it. */
  stepFrom?: Box | null;
  /** Extra data for the surface, e.g. which library tab to show. */
  params?: Record<string, string>;
}

interface SurfaceApi {
  current: SurfaceSpec | null;
  open(spec: SurfaceSpec): void;
  /** Swap what the open surface shows, keeping its origin for the close. */
  replace(spec: Pick<SurfaceSpec, 'kind' | 'id' | 'params'>): void;
  close(): void;
  closing: boolean;
}

const Ctx = createContext<SurfaceApi | null>(null);

export function useSurface(): SurfaceApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSurface outside SurfaceProvider');
  return v;
}

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<SurfaceSpec | null>(null);
  const [closing, setClosing] = useState(false);

  const open = useCallback((spec: SurfaceSpec) => {
    markNavigation();
    setClosing(false);
    setCurrent({ ...spec, origin: spec.origin ?? recentTap(1200), stepFrom: null });
  }, []);
  const replace = useCallback((spec: Pick<SurfaceSpec, 'kind' | 'id' | 'params'>) => {
    markNavigation();
    // A step that follows a tap (Save, Send, a library row) pours out of it.
    const tap = recentTap(3000);
    setCurrent((cur) =>
      cur
        ? { ...cur, kind: spec.kind, id: spec.id, params: spec.params, stepFrom: tap ? whereNow(tap) : null }
        : { ...spec, origin: tap, stepFrom: null },
    );
  }, []);
  const close = useCallback(() => {
    markNavigation();
    setClosing(true);
  }, []);
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

// The host reports that its close has begun through this event, keeping the provider simple.
const EXITED = 'offline:surface-exited';
function FinishCloseBridge({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const h = () => onFinish();
    window.addEventListener(EXITED, h);
    return () => window.removeEventListener(EXITED, h);
  }, [onFinish]);
  return null;
}

/** Where a surface opened by a shortcut comes from: the record button, or the bottom centre. */
function fallbackOrigin(kind: SurfaceKind): Box {
  const t = kind === 'record' ? tapFor(document.querySelector('#root .record-btn')) : null;
  if (t) return t.box;
  return { x: window.innerWidth / 2 - 32, y: window.innerHeight - 104, w: 64, h: 64 };
}

/** Hosts the open surface. `render` maps a spec to the tool's content. */
export function SurfaceHost({ render }: { render: (spec: SurfaceSpec) => ReactNode }) {
  const { current, closing } = useSurface();
  const layerRef = useRef<HTMLDivElement>(null);
  const shownKey = useRef<string | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const run = useRef<Genie | null>(null);

  // Enter: pour out of the tap.
  useLayoutEffect(() => {
    if (!current || !layerRef.current) return;
    if (shownKey.current) return; // already open: steps are handled by Crossfade
    shownKey.current = `${current.kind}:${current.id ?? ''}`;
    lastFocus.current = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('surface-open');
    const from = current.origin ? current.origin.box : fallbackOrigin(current.kind);
    const g = genie(layerRef.current, { from, mode: 'open', duration: MOTION.open, zIndex: 40, dim: 0.14, edges: true });
    run.current = g;
    void g.finished.then(() => {
      if (run.current === g) run.current = null;
    });
  }, [current]);

  // Exit: pour back into where it came from. The page underneath is usable at once.
  useEffect(() => {
    if (!closing || !current || !layerRef.current) return;
    const layer = layerRef.current;
    const at = run.current ? run.current.progress() : 1;
    run.current?.cancel();
    run.current = null;
    cancelGeniesIn(layer);
    const into = current.origin ? whereNow(current.origin) : fallbackOrigin(current.kind);
    genie(layer, { from: into, mode: 'close', duration: MOTION.close, zIndex: 40, at, dim: 0.14, edges: true });
    shownKey.current = null;
    document.documentElement.classList.remove('surface-open');
    window.dispatchEvent(new Event(EXITED));
    const back = lastFocus.current;
    // Focus returns once the home screen is interactive again (it is inert while covered).
    requestAnimationFrame(() => requestAnimationFrame(() => back?.focus?.({ preventScroll: true })));
  }, [closing, current]);

  if (!current) return null;
  return (
    <div ref={layerRef} className="surface-layer" role="dialog" aria-modal="true" aria-label={labelFor(current.kind)}>
      <div className="surface-inner">
        <Crossfade k={`${current.kind}:${current.id ?? ''}`} tone={current.kind === 'record' ? 'sky' : 'paper'} from={current.stepFrom ?? null}>
          {render(current)}
        </Crossfade>
      </div>
    </div>
  );
}

function labelFor(kind: SurfaceKind): string {
  return { record: 'Recording', draft: 'Draft', chat: 'Chat', note: 'Note', library: 'Library', history: 'History', settings: 'Settings' }[kind];
}

interface Step {
  k: string;
  node: ReactNode;
  tone: string;
  leaving: boolean;
  /** Stays fully visible under the next step until that one has poured out. */
  hold: boolean;
  from: Box | null;
}

/** Moves between steps of one task without remounting the layer. */
function Crossfade({ k, tone, from, children }: { k: string; tone: string; from: Box | null; children: ReactNode }) {
  const [items, setItems] = useState<Step[]>([{ k, node: children, tone, leaving: false, hold: false, from: null }]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setItems((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.k === k) return prev.map((it) => (it.k === k ? { ...it, node: children, tone } : it));
      const pour = Boolean(from) && !reducedMotion();
      return [
        ...prev.filter((p) => p.k !== k).map((p) => ({ ...p, leaving: true, hold: pour })),
        { k, node: children, tone, leaving: false, hold: false, from: pour ? from : null },
      ];
    });
  }, [k, tone, from, children]);
  const arrived = useCallback(() => setItems((p) => p.filter((x) => !x.leaving)), []);
  return (
    <>
      {items.map((it) => (
        <CrossItem
          key={it.k}
          tone={it.tone}
          leaving={it.leaving}
          hold={it.hold}
          from={it.from}
          onArrived={arrived}
          onGone={() => setItems((p) => p.filter((x) => x.k !== it.k))}
        >
          {!it.leaving && it.k === k ? children : it.node}
        </CrossItem>
      ))}
    </>
  );
}

function CrossItem({
  tone,
  leaving,
  hold,
  from,
  onArrived,
  onGone,
  children,
}: {
  tone: string;
  leaving: boolean;
  hold: boolean;
  from: Box | null;
  onArrived: () => void;
  onGone: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (from) {
      // A new step pours out of the button that asked for it, over the step before.
      const g = genie(el, { from, mode: 'open', duration: MOTION.step, zIndex: 41, dim: 0.1, edges: true });
      void g.finished.then(onArrived);
      return () => g.cancel();
    }
    // The very first step rides the layer's own entrance.
    if (el.parentElement && el.parentElement.children.length > 1 && !reducedMotion()) {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(14px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 520, delay: 120, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)', fill: 'backwards' },
      );
    }
    // Mount-only: a step's entrance plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!leaving || hold || !el) return;
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 80 : 220, easing: 'ease-out', fill: 'forwards' });
    a.finished.then(onGone, onGone);
  }, [leaving, hold, onGone]);
  return (
    <div ref={ref} className={`surface-step tone-${tone}${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined} inert={leaving || undefined}>
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

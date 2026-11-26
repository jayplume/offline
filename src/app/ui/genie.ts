/**
 * The genie: whatever you open pours out of the control you tapped, like a window leaving the
 * Dock, and pours back into it when it closes.
 *
 * The real element stays in place, invisible, while copies of it are drawn on top in horizontal
 * slices. Each slice is mapped onto a trapezoid with a projective transform (matrix3d), so the
 * sides of the page curve and the content inside really bends: it is not a mask. The edge of the
 * page farthest from the tap leads; the slices next to the tap leave it last.
 *
 * The clock moves at most one long frame per frame. If the main thread stalls (a heavy screen
 * mounting, the microphone starting), the motion waits instead of jumping to the end.
 */

import './genie.css';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GenieOptions {
  /** Where the motion starts (open) or ends (close), in viewport pixels. */
  from: Box;
  mode: 'open' | 'close';
  /** Full length of the motion, in ms. */
  duration: number;
  /** Stacking level for the slices: just above the element's own layer. */
  zIndex: number;
  /** Where to start on the open path (0 at the tap, 1 fully open), e.g. when a close interrupts an open. */
  at?: number;
  /** 'document' keeps the slices with the page when it scrolls (the landing page demo). */
  attach?: 'viewport' | 'document';
  /**
   * Opening only: true when the content is complete at mount (a menu). Otherwise the copies are
   * taken once the page stops changing (saved data loading in), at most a third of a second later.
   */
  ready?: boolean;
  /** How much to dim what is behind while a full page pours over it (0 to 1). White on white needs it. */
  dim?: number;
  /** Hairline edges along the sides of the slices, so a white page's outline reads on a white screen. */
  edges?: boolean;
}

export interface Genie {
  readonly finished: Promise<void>;
  /** Position on the open path: 0 at the tap, 1 fully open. */
  progress(): number;
  /** Stops now, removes the slices and shows the element as it is. */
  cancel(): void;
}

/** Durations in ms. Calm enough to see, short enough not to wait for. */
export const MOTION = {
  open: 1000,
  close: 820,
  step: 920,
  sheetOpen: 860,
  sheetClose: 700,
  menuOpen: 620,
  menuClose: 480,
} as const;

/** How much later the slices next to the tap start than the far edge, as a share of the motion. */
const LAG = 0.42;
/**
 * The most a shape may stretch beyond its own height. A small sheet opened from a button far
 * away travels as a teardrop instead of being pulled into a long ribbon.
 */
const STRETCH = 1.35;
/** The most the clock moves in one frame, so a stalled frame never skips the motion. */
const MAX_FRAME = 34;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Cubic ease in and out: every slice starts calmly and lands softly. */
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const boxOf = (r: { left: number; top: number; width: number; height: number }): Box => ({
  x: r.left,
  y: r.top,
  w: r.width,
  h: r.height,
});

// ─── What is moving ───────────────────────────────────────────────────────────

let moving = 0;
let waiting: (() => void)[] = [];
let lastNavigation = -Infinity;
const runs = new Set<{ el: HTMLElement; cancel: () => void }>();

/** Runs `fn` once nothing is moving (on the next frame if nothing is). Returns a cancel function. */
export function afterMotion(fn: () => void): () => void {
  let live = true;
  const go = () => {
    if (live) fn();
  };
  if (moving === 0) {
    const id = requestAnimationFrame(go);
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }
  waiting.push(go);
  return () => {
    live = false;
  };
}

function settle() {
  moving = Math.max(0, moving - 1);
  if (moving === 0) {
    const w = waiting;
    waiting = [];
    w.forEach((f) => f());
  }
}

/** Marks that a page is opening, changing or closing, so a sheet closing at the same moment steps aside. */
export function markNavigation(): void {
  lastNavigation = performance.now();
}

export function navigatedWithin(ms: number): boolean {
  return performance.now() - lastNavigation < ms;
}

/** Stops every genie running on an element inside `root` (not `root` itself). */
export function cancelGeniesIn(root: Element): void {
  for (const r of [...runs]) if (r.el !== root && root.contains(r.el)) r.cancel();
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

export interface Shape {
  /** Size of the element, and how many slices it is cut into. */
  W: number;
  H: number;
  N: number;
  /** Centre and size of the tapped control, relative to the element's top-left corner. */
  ox: number;
  oy: number;
  ow: number;
  oh: number;
}

/**
 * Corners of every slice at time t (0: squeezed into the tapped control, 1: open), clockwise
 * from the top-left: [x0, y0, x1, y1, x2, y2, x3, y3] per slice.
 */
export function slices(s: Shape, t: number): Float64Array {
  const { W, H, N, ox, oy, ow, oh } = s;
  // The page pours away from the tap: down from a tap in the top half, up from one in the bottom half.
  const down = oy < H / 2;
  // Progress of a content row v (0 top, 1 bottom). Rows next to the tap start LAG later.
  const pull = (v: number) => ease(clamp01((t - LAG * (down ? 1 - v : v)) / (1 - LAG)));

  let top = lerp(oy - oh / 2, 0, pull(0));
  let bottom = lerp(oy + oh / 2, H, pull(1));
  // The edge that leads drags the trailing one along once the shape is stretched to its limit.
  if (down) top = Math.max(top, bottom - STRETCH * H);
  else bottom = Math.min(bottom, top + STRETCH * H);

  // Slices still in the narrow neck get less height than the open part: the squeeze of a genie.
  const weights = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    weights[i] = 0.45 + 0.55 * pull((i + 0.5) / N);
    total += weights[i];
  }

  const out = new Float64Array(N * 8);
  let y = top;
  let e = pull(0);
  for (let i = 0; i < N; i++) {
    const y2 = i === N - 1 ? bottom : y + ((bottom - top) * weights[i]) / total;
    const e2 = pull((i + 1) / N);
    const w1 = lerp(ow, W, e);
    const c1 = lerp(ox, W / 2, e);
    const w2 = lerp(ow, W, e2);
    const c2 = lerp(ox, W / 2, e2);
    out[i * 8] = c1 - w1 / 2;
    out[i * 8 + 1] = y;
    out[i * 8 + 2] = c1 + w1 / 2;
    out[i * 8 + 3] = y;
    out[i * 8 + 4] = c2 + w2 / 2;
    out[i * 8 + 5] = y2;
    out[i * 8 + 6] = c2 - w2 / 2;
    out[i * 8 + 7] = y2;
    y = y2;
    e = e2;
  }
  return out;
}

/**
 * A CSS matrix3d that maps the box (0, 0)–(w, h) onto the quad at `p[o..o+7]` (clockwise from the
 * top-left). Square-to-quad homography (Heckbert), pre-scaled from pixels to the unit square.
 */
export function quadMatrix(w: number, h: number, p: ArrayLike<number>, o = 0): string {
  const x0 = p[o];
  const y0 = p[o + 1];
  const x1 = p[o + 2];
  const y1 = p[o + 3];
  const x2 = p[o + 4];
  const y2 = p[o + 5];
  const x3 = p[o + 6];
  const y3 = p[o + 7];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let k = 0;
  if ((Math.abs(dx3) > 1e-6 || Math.abs(dy3) > 1e-6) && Math.abs(det) > 1e-9) {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    k = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

// Not line-height: getComputedStyle resolves a ratio like 1.5 to pixels, and pixels would be
// inherited as-is by headings with their own size. It is carried over as a ratio instead.
const INHERITED = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant-numeric',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-transform',
  'white-space',
  'direction',
];
const BLOCKISH = new Set(['block', 'flex', 'grid', 'list-item', 'flow-root', 'table']);
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Snapshot {
  node: HTMLElement;
  restoreScroll(roots: HTMLElement[]): void;
}

/**
 * A copy of `el` that looks exactly like it does now: scroll positions kept, form values kept
 * (cloning carries them), ids and form names removed so the copies can't disturb the page, and
 * anything off screen emptied (its box kept, so nothing on screen moves) to keep copies light.
 */
function snapshot(el: HTMLElement, R: DOMRect): Snapshot {
  const node = el.cloneNode(true) as HTMLElement;
  const scrolls: { path: number[]; top: number; left: number }[] = [];

  const visit = (live: Element, copy: Element, path: number[]) => {
    if (live.scrollTop > 0 || live.scrollLeft > 0) scrolls.push({ path, top: live.scrollTop, left: live.scrollLeft });
    const lk = live.children;
    const ck = copy.children;
    const n = Math.min(lk.length, ck.length);
    for (let i = 0; i < n; i++) {
      const l = lk[i];
      const c = ck[i] as HTMLElement;
      if (l.namespaceURI === SVG_NS) continue;
      const r = l.getBoundingClientRect();
      const sized = r.width > 0 || r.height > 0;
      const off = sized && (r.bottom < R.top - 2 || r.top > R.bottom + 2 || r.right < R.left - 2 || r.left > R.right + 2);
      if (off) {
        if (c.childNodes.length && BLOCKISH.has(getComputedStyle(l).display)) {
          c.replaceChildren();
          const st = c.style;
          st.setProperty('box-sizing', 'border-box');
          st.setProperty('width', `${r.width}px`);
          st.setProperty('height', `${r.height}px`);
          st.setProperty('min-width', '0');
          st.setProperty('min-height', '0');
          st.setProperty('flex', 'none');
        }
        continue;
      }
      visit(l, c, [...path, i]);
    }
  };
  visit(el, node, []);

  // Copies must not take ids, group radio buttons, or play media. Placeholders keep child indexes.
  node.removeAttribute('id');
  node.querySelectorAll('[id]:not(svg, svg *)').forEach((n) => n.removeAttribute('id'));
  node.querySelectorAll('[name]').forEach((n) => n.removeAttribute('name'));
  node.querySelectorAll('audio, video, iframe, object, embed').forEach((n) => n.replaceWith(document.createElement('span')));

  // The copy lives outside the element's parent: carry over what it inherited, and pin its box.
  const cs = getComputedStyle(el);
  const st = node.style;
  for (const p of INHERITED) st.setProperty(p, cs.getPropertyValue(p));
  const lh = parseFloat(cs.lineHeight);
  const fs = parseFloat(cs.fontSize);
  if (lh > 0 && fs > 0) st.setProperty('line-height', String(Math.round((lh / fs) * 1e4) / 1e4));
  st.setProperty('position', 'absolute');
  st.setProperty('inset', 'auto');
  st.setProperty('left', '0px');
  st.setProperty('top', '0px');
  st.setProperty('margin', '0');
  st.setProperty('box-sizing', 'border-box');
  st.setProperty('width', `${R.width}px`);
  st.setProperty('height', `${R.height}px`);
  st.setProperty('min-width', '0');
  st.setProperty('min-height', '0');
  st.setProperty('max-width', 'none');
  st.setProperty('max-height', 'none');
  st.setProperty('transform', 'none');
  st.setProperty('translate', 'none');
  st.setProperty('scale', 'none');
  st.setProperty('rotate', 'none');
  st.setProperty('opacity', '1');
  st.setProperty('visibility', 'visible');
  st.setProperty('clip-path', 'none');
  st.setProperty('animation', 'none');
  st.setProperty('transition', 'none');
  st.setProperty('will-change', 'auto');
  st.setProperty('pointer-events', 'none');

  return {
    node,
    restoreScroll(roots) {
      if (!scrolls.length) return;
      for (const root of roots) {
        for (const s of scrolls) {
          let n: Element | undefined = root;
          for (const i of s.path) n = n?.children[i];
          n?.scrollTo({ top: s.top, left: s.left, behavior: 'instant' });
        }
      }
    },
  };
}

// ─── The motion ───────────────────────────────────────────────────────────────

/** Resolves once `el` has gone `ms` without changing, or after `max` ms at most. */
function quiet(el: Element, ms: number, max: number): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const finish = () => {
      mo.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(cap);
      resolve();
    };
    const mo = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, ms);
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    timer = window.setTimeout(finish, ms);
    const cap = window.setTimeout(finish, max);
  });
}

/** Plays the genie on `el`: pouring out of `from` (open) or back into it (close). */
export function genie(el: HTMLElement, opt: GenieOptions): Genie {
  const open = opt.mode === 'open';
  let t = clamp01(opt.at ?? (open ? 0 : 1));
  if (!el.isConnected) return { finished: Promise.resolve(), progress: () => 1, cancel: () => {} };

  const reduce = reducedMotion();
  const D = reduce ? 200 : Math.max(1, opt.duration);
  // Hidden at once, so a page that is still loading never flashes before the motion.
  const before = el.style.opacity;
  el.style.opacity = '0';

  moving++;
  let raf = 0;
  let last = 0;
  let done = false;
  let layer: HTMLDivElement | null = null;
  let dimmer: HTMLDivElement | null = null;
  let resolve!: () => void;
  const finished = new Promise<void>((r) => (resolve = r));
  const entry = { el, cancel: () => stop(true) };
  runs.add(entry);

  const stop = (cancelled: boolean) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    runs.delete(entry);
    if (open || cancelled) el.style.opacity = before;
    // Open, the page itself now covers the dimmer; closed, the dimmer has faded with it.
    dimmer?.remove();
    const l = layer;
    if (l && open && !cancelled && !reduce) {
      // The live element is underneath now; let the copies go softly in case it changed meanwhile.
      const fade = l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: 'ease-out' });
      fade.finished.then(
        () => l.remove(),
        () => l.remove(),
      );
    } else {
      l?.remove();
    }
    settle();
    resolve();
  };

  const begin = () => {
    if (done) return;
    const R = el.getBoundingClientRect();
    if (!el.isConnected || R.width < 4 || R.height < 4) {
      t = open ? 1 : 0;
      stop(false);
      return;
    }
    const t0 = performance.now();
    // Thin slices keep the curve smooth and the bend free of perspective stretch.
    const N = reduce ? 1 : Math.max(14, Math.min(40, Math.round(R.height / 14)));
    const sh = R.height / N;
    const snap = snapshot(el, R);

    // Behind a full page: a light dimmer, so a white page pouring over a white screen still shows.
    if (opt.dim && !reduce) {
      const d = document.createElement('div');
      d.className = 'genie-dim';
      d.style.zIndex = String(opt.zIndex);
      document.body.appendChild(d);
      dimmer = d;
    }
    const lay = document.createElement('div');
    layer = lay;
    lay.className = opt.edges && !reduce ? 'genie has-edges' : 'genie';
    lay.setAttribute('aria-hidden', 'true');
    lay.inert = true;
    const doc = opt.attach === 'document';
    const ls = lay.style;
    ls.position = doc ? 'absolute' : 'fixed';
    ls.left = `${R.left + (doc ? window.scrollX : 0)}px`;
    ls.top = `${R.top + (doc ? window.scrollY : 0)}px`;
    ls.width = `${R.width}px`;
    ls.height = `${R.height}px`;
    ls.zIndex = String(opt.zIndex);

    const parts: HTMLElement[] = [];
    for (let i = 0; i < N; i++) {
      const part = document.createElement('div');
      part.className = 'genie-slice';
      const copy = i === N - 1 ? snap.node : (snap.node.cloneNode(true) as HTMLElement);
      copy.style.top = `${-i * sh}px`;
      part.style.width = `${R.width}px`;
      // One spare pixel under each slice, covered by the next one: no hairline seams.
      part.style.height = `${i === N - 1 ? sh : sh + 1}px`;
      part.appendChild(copy);
      lay.appendChild(part);
      parts.push(part);
    }
    document.body.appendChild(lay);
    snap.restoreScroll(parts.map((p) => p.firstElementChild as HTMLElement));
    if (import.meta.env.DEV) performance.measure(`genie ${opt.mode} ×${N}`, { start: t0 });

    const shape: Shape = {
      W: R.width,
      H: R.height,
      N,
      ox: opt.from.x - R.left + opt.from.w / 2,
      oy: opt.from.y - R.top + opt.from.h / 2,
      ow: Math.max(24, Math.min(opt.from.w, R.width)),
      oh: Math.max(24, Math.min(opt.from.h, R.height)),
    };
    const draw = () => {
      if (reduce) {
        ls.opacity = String(t);
        return;
      }
      const q = slices(shape, t);
      for (let i = 0; i < N; i++) parts[i].style.transform = quadMatrix(R.width, sh, q, i * 8);
      // Appear out of the control, and disappear into it, over the first few percent.
      ls.opacity = String(Math.min(1, t / 0.06));
      if (dimmer) dimmer.style.opacity = String((opt.dim ?? 0) * ease(t));
    };
    draw();

    const frame = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME);
      last = now;
      t = clamp01(t + (open ? dt : -dt) / D);
      draw();
      if (open ? t >= 1 : t <= 0) stop(false);
      else raf = requestAnimationFrame(frame);
    };
    // The clock starts on the first frame that is actually drawn, not when the call was made.
    raf = requestAnimationFrame((now) => {
      last = now;
      raf = requestAnimationFrame(frame);
    });
  };

  if (open && !opt.ready && !reduce) void quiet(el, 60, 320).then(begin);
  else begin();

  return { finished, progress: () => t, cancel: () => stop(true) };
}

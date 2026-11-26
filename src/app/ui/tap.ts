/**
 * Remembers where the last tap or click landed, so whatever it opens can pour out of that spot
 * and pour back into it when it closes. Small controls use their own outline; big ones (a list
 * row) use a small box under the finger.
 */
import { boxOf, type Box } from './genie';

export interface Tap {
  box: Box;
  /** The control that was tapped, followed if it moves before the close. */
  el: Element | null;
  elBox: Box | null;
  at: number;
}

const TARGETS =
  'button, a[href], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="option"], label, summary, input, select, textarea';

let last: Tap | null = null;
let installed = false;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function tapOn(target: EventTarget | null, x?: number, y?: number): Tap {
  const at = performance.now();
  const el = target instanceof Element ? target.closest(TARGETS) : null;
  if (el) {
    const r = el.getBoundingClientRect();
    const elBox = boxOf(r);
    if (r.width <= 220 && r.height <= 140) return { box: elBox, el, elBox, at };
    const w = Math.min(r.width, 72);
    const h = Math.min(r.height, 56);
    const cx = x ?? r.left + r.width / 2;
    const cy = y ?? r.top + r.height / 2;
    return { box: { x: clamp(cx - w / 2, r.left, r.right - w), y: clamp(cy - h / 2, r.top, r.bottom - h), w, h }, el, elBox, at };
  }
  const cx = x ?? window.innerWidth / 2;
  const cy = y ?? window.innerHeight / 2;
  return { box: { x: cx - 28, y: cy - 28, w: 56, h: 56 }, el: null, elBox: null, at };
}

export function installTapTracker(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', (e) => (last = tapOn(e.target, e.clientX, e.clientY)), true);
  document.addEventListener(
    'click',
    (e) => {
      const same = last?.el && e.target instanceof Node && last.el.contains(e.target);
      // A keyboard press or a scripted click has no position: use the control itself.
      if (e.detail === 0) last = tapOn(e.target);
      else if (!same) last = tapOn(e.target, e.clientX, e.clientY);
      else if (last) last.at = performance.now();
    },
    true,
  );
}

/** The last tap, if it happened in the last `ms` milliseconds. */
export function recentTap(ms = 1000): Tap | null {
  return last && performance.now() - last.at <= ms ? last : null;
}

/** Where a tap's box is now: it follows its control if that moved, and keeps its spot if it's gone. */
export function whereNow(t: Tap): Box {
  if (t.el?.isConnected && t.elBox) {
    const r = t.el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { x: t.box.x + r.left - t.elBox.x, y: t.box.y + r.top - t.elBox.y, w: t.box.w, h: t.box.h };
  }
  return t.box;
}

/** A tap on an element without an event: for things opened by a shortcut. */
export function tapFor(el: Element | null): Tap | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { box: boxOf(r), el, elBox: boxOf(r), at: performance.now() };
}

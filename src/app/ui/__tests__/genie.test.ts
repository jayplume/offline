import { describe, expect, it } from 'vitest';
import { quadMatrix, slices, type Shape } from '../genie';

/** Applies a CSS matrix3d string to a point (x, y), with the perspective divide. */
function apply(m: string, x: number, y: number): [number, number] {
  const v = m.slice('matrix3d('.length, -1).split(',').map(Number);
  const X = v[0] * x + v[4] * y + v[12];
  const Y = v[1] * x + v[5] * y + v[13];
  const W = v[3] * x + v[7] * y + v[15];
  return [X / W, Y / W];
}

const shape = (over: Partial<Shape> = {}): Shape => ({ W: 430, H: 880, N: 26, ox: 215, oy: 330, ow: 128, oh: 128, ...over });

describe('quadMatrix', () => {
  it('maps the corners of a slice onto its trapezoid', () => {
    const quad = [100, 40, 300, 40, 340, 72, 60, 72];
    const m = quadMatrix(430, 33.8, quad);
    const corners: [number, number][] = [
      [0, 0],
      [430, 0],
      [430, 33.8],
      [0, 33.8],
    ];
    corners.forEach(([x, y], i) => {
      const [X, Y] = apply(m, x, y);
      expect(X).toBeCloseTo(quad[i * 2], 6);
      expect(Y).toBeCloseTo(quad[i * 2 + 1], 6);
    });
  });

  it('is a plain scale and move for a rectangle', () => {
    const m = quadMatrix(200, 50, [10, 20, 110, 20, 110, 45, 10, 45]);
    expect(apply(m, 100, 25)).toEqual([60, 32.5]);
  });
});

describe('slices', () => {
  it('lands exactly on the page when open', () => {
    const s = shape();
    const q = slices(s, 1);
    for (let i = 0; i < s.N; i++) {
      const top = (i * s.H) / s.N;
      const bottom = ((i + 1) * s.H) / s.N;
      expect([...q.slice(i * 8, i * 8 + 8)].map((n) => +n.toFixed(6))).toEqual([0, top, s.W, top, s.W, bottom, 0, bottom].map((n) => +n.toFixed(6)));
    }
  });

  it('starts squeezed into the tapped control', () => {
    const s = shape({ ox: 80, oy: 700, ow: 96, oh: 44 });
    const q = slices(s, 0);
    for (let i = 0; i < q.length; i += 2) {
      expect(q[i]).toBeGreaterThanOrEqual(80 - 48 - 1e-9);
      expect(q[i]).toBeLessThanOrEqual(80 + 48 + 1e-9);
      expect(q[i + 1]).toBeGreaterThanOrEqual(700 - 22 - 1e-9);
      expect(q[i + 1]).toBeLessThanOrEqual(700 + 22 + 1e-9);
    }
  });

  it('never folds: slices stay in order, with positive height and width, all the way', () => {
    for (const oy of [-40, 120, 330, 700, 900]) {
      const s = shape({ oy, ox: 60 });
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const q = slices(s, Math.min(1, t));
        for (let i = 0; i < s.N; i++) {
          const o = i * 8;
          expect(q[o + 5]).toBeGreaterThan(q[o + 1]); // bottom below top
          expect(q[o + 2]).toBeGreaterThan(q[o]); // right of left
          if (i > 0) expect(q[o + 1]).toBeCloseTo(q[o - 3], 9); // meets the slice above
        }
      }
    }
  });

  it('pours away from the tap: the far edge arrives first', () => {
    // Tap in the top half: the bottom edge (far) is nearly home while the top is still at the tap.
    const down = slices(shape({ oy: 200 }), 0.5);
    expect(down[down.length - 1]).toBeGreaterThan(860);
    expect(down[1]).toBeGreaterThan(100);
    // Tap in the bottom half: the top edge leads.
    const up = slices(shape({ oy: 700 }), 0.5);
    expect(up[1]).toBeLessThan(20);
    expect(up[up.length - 1]).toBeLessThan(800);
  });
});

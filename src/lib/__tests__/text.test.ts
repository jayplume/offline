import { describe, expect, it } from 'vitest';
import { formatDuration, sentences, wordDiff } from '../text';
import { encodeWav, sliceSamples } from '../audio/wav';
import { titleFrom } from '../db';

describe('text helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
  });
  it('splits sentences', () => expect(sentences('One. Two? Three')).toEqual(['One.', 'Two?', 'Three']));
  it('diffs words', () => {
    const d = wordDiff('send it now', 'send it later');
    expect(d.filter((p) => p.type === 'del').map((p) => p.text.trim())).toEqual(['now']);
    expect(d.filter((p) => p.type === 'add').map((p) => p.text.trim())).toEqual(['later']);
  });
  it('titles drop spoken filler', () => {
    expect(titleFrom('um so like I need to tell the team. Then more.', 'x')).toBe('I need to tell the team');
    expect(titleFrom('   ', 'Fallback')).toBe('Fallback');
  });
});

describe('wav', () => {
  it('writes a valid 16-bit mono header', async () => {
    const samples = new Float32Array(1600).fill(0.5);
    const blob = encodeWav(samples, 16000);
    const v = new DataView(await blob.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(blob.size).toBe(44 + 3200);
  });
  it('slices by seconds', () => expect(sliceSamples(new Float32Array(16000), 16000, 0.25, 0.5).length).toBe(4000));
});

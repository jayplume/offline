import { describe, expect, it } from 'vitest';
import { assemblePrompt, packHistory, parseQuestions } from '../ai/prompts';
import { sanitizeSegments, splitForBudget } from '../ai/engine';

describe('assemblePrompt', () => {
  it('keeps the words unchanged when nothing is chosen', () => {
    expect(assemblePrompt('  Plan my week  ', { tone: 'neutral', length: 'any' })).toBe('Plan my week');
  });
  it('adds intent, answered questions, template, tone and length after the words', () => {
    const p = assemblePrompt('Write to Dami about Thursday', {
      tone: 'friendly',
      length: 'short',
      intentNote: 'She is my manager',
      answers: [
        { question: 'Which Thursday?', answer: 'the 3rd' },
        { question: 'Unanswered?', answer: '  ' },
      ],
      template: { id: 'email', label: 'Email', instruction: 'Turn this into an email.' },
    });
    expect(p.startsWith('Write to Dami about Thursday')).toBe(true);
    expect(p).toContain('What I meant: She is my manager');
    expect(p).toContain('- Which Thursday? the 3rd');
    expect(p).not.toContain('Unanswered?');
    expect(p).toContain('Turn this into an email. Use a warm, friendly tone. Keep the answer short');
  });
});

describe('parseQuestions', () => {
  it('reads schema JSON', () => expect(parseQuestions('{"questions":["Who is it for?","By when?"]}')).toEqual(['Who is it for?', 'By when?']));
  it('accepts fenced JSON and caps at three', () =>
    expect(parseQuestions('```json\n{"questions":["a?","b?","c?","d?"]}\n```')).toHaveLength(3));
  it('falls back to question lines', () => expect(parseQuestions('1. Who is the audience?\n- Any deadline?\nThanks')).toEqual(['Who is the audience?', 'Any deadline?']));
});

describe('packHistory', () => {
  const turns = [
    { role: 'user' as const, text: 'a'.repeat(50) },
    { role: 'model' as const, text: 'b'.repeat(50) },
    { role: 'user' as const, text: 'c'.repeat(50) },
    { role: 'model' as const, text: 'd'.repeat(50) },
    { role: 'user' as const, text: 'e'.repeat(50) },
  ];
  it('keeps the newest turns within budget and starts on a user turn', () => {
    const packed = packHistory(turns, 120);
    expect(packed[0].role).toBe('user');
    expect(packed[packed.length - 1].text[0]).toBe('e');
    expect(packed.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(150);
  });
  it('always keeps the latest turn even if it alone exceeds the budget', () => {
    expect(packHistory([{ role: 'user', text: 'x'.repeat(500) }], 10)).toHaveLength(1);
  });
});

describe('sanitizeSegments', () => {
  it('clamps, orders and keeps segments inside the clip', () => {
    const s = sanitizeSegments([{ start: -2, end: 3, text: ' a ' }, { start: 2, end: 99, text: 'b' }], 10);
    expect(s).toEqual([{ start: 0, end: 3, text: 'a' }, { start: 2, end: 10, text: 'b' }]);
  });
  it('spreads untimed segments by length', () => {
    const s = sanitizeSegments([{ start: 0, end: 0, text: 'aaaa' }, { start: 0, end: 0, text: 'aaaa' }], 8);
    expect(s[1].start).toBe(4);
    expect(s[1].end).toBe(8);
  });
});

describe('splitForBudget', () => {
  it('never returns a part over the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ') + '\n\n' + 'x'.repeat(700);
    const parts = splitForBudget(text, 200);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
});

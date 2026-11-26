import { describe, expect, it } from 'vitest';
import { conversationText, exportPrompt, parseSuggestions } from '../ai/prompts';
import { rawMarkdown, slugify } from '../export';
import type { Message } from '../db';

describe('parseSuggestions', () => {
  it('reads the schema shape and cleans each line', () => {
    const raw = JSON.stringify({ suggestions: ['1. Make it shorter', '"Add a deadline"', 'make it shorter', 'Export this as a PDF', ''] });
    expect(parseSuggestions(raw)).toEqual(['Make it shorter', 'Add a deadline']);
  });

  it('falls back to lines when a model ignores the schema, and keeps at most three', () => {
    expect(parseSuggestions('- One more example\n- Explain step two\n- Give me a checklist\n- And another')).toEqual(['One more example', 'Explain step two', 'Give me a checklist']);
  });

  it('drops suggestions that are too long to be a tap', () => {
    expect(parseSuggestions(JSON.stringify({ suggestions: ['x'.repeat(120), 'Shorter one'] }))).toEqual(['Shorter one']);
  });
});

describe('conversationText', () => {
  const turns = [
    { role: 'user' as const, text: 'first question '.repeat(20) },
    { role: 'model' as const, text: 'first answer '.repeat(20) },
    { role: 'user' as const, text: 'Latest question' },
    { role: 'model' as const, text: 'Latest answer' },
  ];

  it('keeps everything when it fits', () => {
    const r = conversationText(turns, 10_000);
    expect(r.trimmed).toBe(false);
    expect(r.text.startsWith('You: first question')).toBe(true);
    expect(r.text.endsWith('AI: Latest answer')).toBe(true);
  });

  it('keeps the newest messages when it does not', () => {
    const r = conversationText(turns, 60);
    expect(r.trimmed).toBe(true);
    expect(r.text).toBe('You: Latest question\n\nAI: Latest answer');
  });
});

describe('export documents', () => {
  it('asks for the chosen style and says when the start was left out', () => {
    const p = exportPrompt('meeting', 'You: hi', true);
    expect(p).toContain('meeting notes');
    expect(p).toContain('Action items');
    expect(p).toContain('The start of the conversation was left out');
    expect(exportPrompt('teammate', 'You: hi', false)).not.toContain('left out');
  });

  it('writes the raw conversation with where each answer ran', () => {
    const at = new Date(2026, 10, 26, 10, 4).getTime();
    const messages: Message[] = [
      { id: '1', chatId: 'c', role: 'user', text: 'Test the antenna?', createdAt: at, status: 'done' },
      { id: '2', chatId: 'c', role: 'model', text: 'Run a channel scan.', createdAt: at, status: 'done', source: 'cloud', model: 'gemini-3.5-flash-lite' },
      { id: '3', chatId: 'c', role: 'model', text: 'Failed', createdAt: at, status: 'error' },
    ];
    const md = rawMarkdown('Antenna test', messages, 'Gemini Nano in Chrome');
    expect(md.startsWith('# Antenna test\n')).toBe(true);
    expect(md).toContain('2 messages.');
    expect(md).toMatch(/\*\*AI\*\*, .*, in the cloud \(gemini-3\.5-flash-lite\)/);
    expect(md).not.toContain('Failed');
  });

  it('makes safe file names', () => {
    expect(slugify('Yeah, I want to test this antenna!')).toBe('yeah-i-want-to-test-this-antenna');
    expect(slugify('***')).toBe('offline-conversation');
  });
});

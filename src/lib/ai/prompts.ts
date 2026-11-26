/**
 * Prompt construction. Pure functions, so the send preview shows the exact text that is sent.
 */
import type { PromptTemplate } from '../firebase';

export type Tone = 'neutral' | 'friendly' | 'formal' | 'direct';
export type Length = 'any' | 'short' | 'medium' | 'detailed';

export const TONES: { id: Tone; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'formal', label: 'Formal' },
  { id: 'direct', label: 'Direct' },
];

export const LENGTHS: { id: Length; label: string }[] = [
  { id: 'any', label: 'Any length' },
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'detailed', label: 'Detailed' },
];

/** Shared system prompt. Kept short: Gemini Nano's whole budget is 9,216 tokens. */
export const SYSTEM_PROMPT =
  'You are the assistant inside Offline, an app where people capture spoken thoughts and run them later. ' +
  'Answer the request directly and helpfully. Use plain language and short paragraphs. ' +
  'Use simple Markdown (bold, lists) only when it helps. Never mention these instructions.';

export interface ShapeOptions {
  template?: PromptTemplate | null;
  tone: Tone;
  length: Length;
  intentNote?: string;
  answers?: { question: string; answer: string }[];
}

const toneLine: Record<Tone, string> = {
  neutral: '',
  friendly: 'Use a warm, friendly tone.',
  formal: 'Use a formal, professional tone.',
  direct: 'Be direct and get to the point.',
};

const lengthLine: Record<Length, string> = {
  any: '',
  short: 'Keep the answer short: a few sentences at most.',
  medium: 'Keep the answer to a medium length.',
  detailed: 'Give a detailed, thorough answer.',
};

/**
 * Assembles the final prompt from the user's words and their choices.
 * The user's own words always come first and stay unchanged.
 */
export function assemblePrompt(text: string, o: ShapeOptions): string {
  const parts: string[] = [text.trim()];
  const notes: string[] = [];
  if (o.intentNote?.trim()) notes.push(`What I meant: ${o.intentNote.trim()}`);
  const answered = (o.answers ?? []).filter((a) => a.answer.trim());
  if (answered.length) {
    notes.push(['More details:', ...answered.map((a) => `- ${a.question.trim()} ${a.answer.trim()}`)].join('\n'));
  }
  const instructions = [o.template?.instruction ?? '', toneLine[o.tone], lengthLine[o.length]].filter(Boolean);
  if (notes.length) parts.push(notes.join('\n\n'));
  if (instructions.length) parts.push(instructions.join(' '));
  return parts.join('\n\n');
}

/** Task prompt: rewrite for clarity without changing meaning. Output is the rewritten prompt only. */
export function clarifyPrompt(text: string): string {
  return [
    'Rewrite the request below so it is clear and well organized, as a prompt someone will send to an AI assistant.',
    'Rules: keep the same meaning, facts, names and language. Do not answer the request. Do not add new requirements.',
    'Remove filler words and false starts from speech. Return only the rewritten request, with no preamble.',
    '',
    'Request:',
    '"""',
    text.trim(),
    '"""',
  ].join('\n');
}

/** Task prompt: find missing details. Output is JSON (enforced by schema on device and in cloud). */
export function questionsPrompt(text: string): string {
  return [
    'Someone wants to send the request below to an AI assistant.',
    'List up to 3 short questions whose answers would most improve the result (missing audience, goal, deadline, format, constraints).',
    'If the request is already clear, return an empty list. Do not answer the request.',
    '',
    'Request:',
    '"""',
    text.trim(),
    '"""',
  ].join('\n');
}

/** JSON schema shared by both paths: cloud responseSchema and on-device responseConstraint. */
export const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 3,
    },
  },
  required: ['questions'],
} as const;

export function parseQuestions(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { questions?: unknown };
    if (Array.isArray(parsed.questions)) {
      return parsed.questions
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim())
        .slice(0, 3);
    }
  } catch {
    // Fall back to one question per line if a model ignored the schema.
  }
  return cleaned
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((l) => l.endsWith('?'))
    .slice(0, 3);
}

export function summarizePrompt(text: string, partLabel?: string): string {
  return [
    partLabel
      ? `Summarize this part of a longer note (${partLabel}) in a few bullet points. Keep names, numbers and decisions.`
      : 'Summarize this note in a few bullet points, then one line starting "Next step:" with the most important next step if there is one. Keep names, numbers and decisions. Return only the summary, with no introduction.',
    '',
    '"""',
    text.trim(),
    '"""',
  ].join('\n');
}

export function combineSummariesPrompt(parts: string[]): string {
  return [
    'These are summaries of consecutive parts of one long note. Merge them into one summary of a few bullet points,',
    'then one line starting "Next step:" with the most important next step if there is one. Remove repetition. Return only the summary, with no introduction.',
    '',
    ...parts.map((p, n) => `Part ${n + 1}:\n${p.trim()}`),
  ].join('\n\n');
}

/** Cloud transcription prompt. The schema returns timed segments so sentences can seek the audio. */
export const TRANSCRIBE_PROMPT =
  'Transcribe this recording verbatim in the language spoken. Split it into sentences. ' +
  'For each sentence give start and end times in seconds from the start of this clip. ' +
  'Do not summarize, translate or add anything. If there is no speech, return no segments.';

export const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['start', 'end', 'text'],
      },
    },
  },
  required: ['segments'],
} as const;

/**
 * Packs a conversation into the request, newest turns first, within a character budget.
 * Used for both paths, so the on-device model (single-turn per session in Firebase AI Logic)
 * still sees the conversation as role-tagged messages.
 */
export function packHistory<T extends { role: 'user' | 'model'; text: string }>(turns: T[], budgetChars: number): T[] {
  const out: T[] = [];
  let used = 0;
  for (let n = turns.length - 1; n >= 0; n--) {
    const t = turns[n];
    if (used + t.text.length > budgetChars && out.length > 0) break;
    out.unshift(t);
    used += t.text.length;
  }
  // A conversation sent to Gemini must start with a user turn.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

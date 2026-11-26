/**
 * The AI engine: every model call in Offline goes through here, on top of Firebase AI Logic's
 * hybrid inference (getGenerativeModel with an InferenceMode chosen by ./route.ts).
 *
 * What this layer adds on top of the SDK:
 * - One place that records where each call actually ran (response.inferenceSource) for History.
 * - A cloud retry when an on-device call fails after the SDK already chose the device.
 *   PREFER_ON_DEVICE checks availability up front only; a runtime failure such as a context
 *   overflow is thrown, not re-routed (see callCloudOrDevice in @firebase/ai 3.1.0).
 * - Audio transcription in chunks (audio is cloud-only in hybrid inference).
 * - Map-reduce summaries so a long note can still be summarized fully on-device.
 */
import {
  AIError,
  getGenerativeModel,
  type Content,
  type GenerativeModel,
  type LanguageModelCreateOptions as DeviceCreateOptions,
  type ModelParams,
} from 'firebase/ai';
import { getFirebase, getRuntimeConfig, isFirebaseConfigured } from '../firebase';
import { decodeToMono16k, encodeWav, sliceSamples } from '../audio/wav';
import { logRun } from '../db';
import type { DeviceModel, Destination, Mode, Route, TaskKind } from './route';
import {
  QUESTIONS_SCHEMA,
  SUGGESTIONS_SCHEMA,
  SYSTEM_PROMPT,
  TRANSCRIBE_PROMPT,
  TRANSCRIPT_SCHEMA,
  combineSummariesPrompt,
  parseQuestions,
  parseSuggestions,
  suggestionsPrompt,
  summarizePrompt,
} from './prompts';

type Kind = 'text' | 'questions' | 'suggest' | 'transcribe';

/** Structured-output kinds: one JSON schema, used as the cloud responseJsonSchema and the on-device responseConstraint. */
const JSON_SCHEMAS: Partial<Record<Kind, Record<string, unknown>>> = {
  questions: QUESTIONS_SCHEMA as unknown as Record<string, unknown>,
  suggest: SUGGESTIONS_SCHEMA as unknown as Record<string, unknown>,
};

export interface AIResult {
  text: string;
  source: Destination;
  model: string;
  ms: number;
  /** Set when the device was chosen, failed, and the cloud answered instead. */
  fellBackFrom?: Destination;
  fallbackReason?: string;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export const DEVICE_MODEL_LABEL = 'Gemini Nano in Chrome';

/** Fresh objects per model: the SDK's Chrome adapter fills defaults into the object it is given. */
function deviceCreateOptions(): DeviceCreateOptions {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [{ role: 'system', content: [{ type: 'text', value: SYSTEM_PROMPT }] }],
  };
}

const cache = new Map<string, GenerativeModel>();

function getModel(kind: Kind, mode: Mode): GenerativeModel {
  const fb = getFirebase();
  if (!fb) throw new AIUserError('Cloud AI is not set up in this build.', 'config');
  const rc = getRuntimeConfig();
  const cloudModel = kind === 'transcribe' ? rc.transcribeModel : rc.cloudModel;
  const key = `${kind}|${mode}|${cloudModel}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const inCloudParams: ModelParams = {
    model: cloudModel,
    systemInstruction: kind === 'transcribe' ? undefined : SYSTEM_PROMPT,
    generationConfig: JSON_SCHEMAS[kind]
      ? { responseMimeType: 'application/json', responseJsonSchema: JSON_SCHEMAS[kind], temperature: kind === 'suggest' ? 0.5 : 0.2 }
      : kind === 'transcribe'
          ? { responseMimeType: 'application/json', responseJsonSchema: TRANSCRIPT_SCHEMA as unknown as Record<string, unknown>, temperature: 0 }
          : { temperature: 0.6 },
  };
  const model = getGenerativeModel(fb.ai, {
    mode,
    inCloudParams,
    onDeviceParams: {
      createOptions: deviceCreateOptions(),
      promptOptions: JSON_SCHEMAS[kind] ? { responseConstraint: JSON_SCHEMAS[kind] } : undefined,
    },
  });
  cache.set(key, model);
  return model;
}

/** A failure with a sentence the interface can show as-is. */
export class AIUserError extends Error {
  constructor(
    message: string,
    public readonly code: 'offline' | 'quota' | 'blocked' | 'appcheck' | 'device' | 'too-long' | 'gesture' | 'config' | 'cancelled' | 'unknown',
  ) {
    super(message);
    this.name = 'AIUserError';
  }
}

export function toUserError(err: unknown): AIUserError {
  if (err instanceof AIUserError) return err;
  if (err instanceof DOMException) {
    if (err.name === 'AbortError') return new AIUserError('Stopped.', 'cancelled');
    if (err.name === 'QuotaExceededError') return new AIUserError('This is too long for the on-device model.', 'too-long');
    if (err.name === 'NotAllowedError') return new AIUserError('Chrome needs a tap before it can start the on-device model. Tap the button again.', 'gesture');
    return new AIUserError(`The on-device model stopped: ${err.message || err.name}.`, 'device');
  }
  if (err instanceof AIError) {
    const msg = String(err.message || '');
    const status = (err.customErrorData as { status?: number } | undefined)?.status;
    if (err.code === 'fetch-error' && !navigator.onLine) return new AIUserError("Couldn't reach the cloud. You seem to be offline.", 'offline');
    if (status === 429 || /429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return new AIUserError('The free cloud quota is busy right now. Try again in a minute.', 'quota');
    if (/app ?check/i.test(msg) || status === 401) return new AIUserError('The cloud rejected this browser (App Check). Reload the page and try again.', 'appcheck');
    if (err.code === 'response-error' || /blocked|SAFETY/i.test(msg)) return new AIUserError("Gemini didn't return an answer for this one. Try rewording it.", 'blocked');
    if (err.code === 'fetch-error') return new AIUserError("Couldn't reach the cloud. Check the connection and try again.", 'offline');
    if (err.code === 'unsupported' || err.code === 'api-not-enabled') return new AIUserError('The on-device model is not available right now.', 'device');
    return new AIUserError(`Something went wrong with the AI request: ${msg.replace(/^AI: /, '').slice(0, 160)}`, 'unknown');
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new AIUserError(`Something went wrong: ${msg.slice(0, 160)}`, 'unknown');
}

/** Errors thrown by Chrome's LanguageModel are DOMExceptions; cloud errors are AIErrors. */
function isDeviceRuntimeError(err: unknown): boolean {
  return err instanceof DOMException && err.name !== 'AbortError';
}

function sourceOf(inferenceSource: string | undefined): Destination {
  return inferenceSource === 'on_device' ? 'device' : 'cloud';
}

function modelLabel(source: Destination, kind: Kind): string {
  const rc = getRuntimeConfig();
  return source === 'device' ? DEVICE_MODEL_LABEL : kind === 'transcribe' ? rc.transcribeModel : rc.cloudModel;
}

interface RunOptions {
  task: TaskKind;
  route: Route;
  itemId?: string;
  kind?: Kind;
  signal?: AbortSignal;
}

function toContents(prompt: string | Content[]): Content[] {
  return typeof prompt === 'string' ? [{ role: 'user', parts: [{ type: 'text', text: prompt }] }] : prompt;
}

function charsOf(contents: Content[]): number {
  return contents.reduce((n, c) => n + c.parts.reduce((m, p) => m + ('text' in p && p.text ? p.text.length : 0), 0), 0);
}

/** Single-shot generation (clarify, questions, run, summarize). */
export async function runText(prompt: string | Content[], o: RunOptions): Promise<AIResult> {
  const kind = o.kind ?? 'text';
  const contents = toContents(prompt);
  const t0 = performance.now();
  const base = { kind: o.task, itemId: o.itemId, requestedMode: o.route.mode, expected: o.route.expect, inputChars: charsOf(contents) };
  try {
    const res = await getModel(kind, o.route.mode).generateContent({ contents }, { signal: o.signal });
    const source = sourceOf(res.response.inferenceSource);
    const result: AIResult = { text: res.response.text(), source, model: modelLabel(source, kind), ms: Math.round(performance.now() - t0) };
    void logRun({ ...base, source, model: result.model, ms: result.ms, ok: true });
    return result;
  } catch (err) {
    if (o.route.mode === 'prefer_on_device' && o.route.mayUse.includes('cloud') && isDeviceRuntimeError(err)) {
      const reason = toUserError(err).message;
      const res = await getModel(kind, 'only_in_cloud').generateContent({ contents }, { signal: o.signal });
      const result: AIResult = {
        text: res.response.text(),
        source: 'cloud',
        model: modelLabel('cloud', kind),
        ms: Math.round(performance.now() - t0),
        fellBackFrom: 'device',
        fallbackReason: reason,
      };
      void logRun({ ...base, source: 'cloud', model: result.model, ms: result.ms, ok: true, note: `Device failed (${reason}); cloud answered.` });
      return result;
    }
    const ue = toUserError(err);
    void logRun({ ...base, source: null, model: null, ms: Math.round(performance.now() - t0), ok: false, note: ue.message });
    throw ue;
  }
}

/** Streaming generation for chat. `onText` receives the full text so far. */
export async function streamText(contents: Content[], o: RunOptions & { onText: (full: string) => void }): Promise<AIResult> {
  const kind = o.kind ?? 'text';
  const t0 = performance.now();
  const base = { kind: o.task, itemId: o.itemId, requestedMode: o.route.mode, expected: o.route.expect, inputChars: charsOf(contents) };
  const attempt = async (mode: Mode) => {
    const result = await getModel(kind, mode).generateContentStream({ contents }, { signal: o.signal });
    let full = '';
    for await (const chunk of result.stream) {
      full += chunk.text();
      o.onText(full);
    }
    const response = await result.response;
    return { full: full || response.text(), source: sourceOf(response.inferenceSource) };
  };
  try {
    const { full, source } = await attempt(o.route.mode);
    const result: AIResult = { text: full, source, model: modelLabel(source, kind), ms: Math.round(performance.now() - t0) };
    void logRun({ ...base, source, model: result.model, ms: result.ms, ok: true });
    return result;
  } catch (err) {
    if (o.route.mode === 'prefer_on_device' && o.route.mayUse.includes('cloud') && isDeviceRuntimeError(err)) {
      const reason = toUserError(err).message;
      o.onText('');
      const { full } = await attempt('only_in_cloud');
      const result: AIResult = { text: full, source: 'cloud', model: modelLabel('cloud', kind), ms: Math.round(performance.now() - t0), fellBackFrom: 'device', fallbackReason: reason };
      void logRun({ ...base, source: 'cloud', model: result.model, ms: result.ms, ok: true, note: `Device failed (${reason}); cloud answered.` });
      return result;
    }
    const ue = toUserError(err);
    void logRun({ ...base, source: null, model: null, ms: Math.round(performance.now() - t0), ok: false, note: ue.message });
    throw ue;
  }
}

export async function findMissingDetails(prompt: string, o: Omit<RunOptions, 'kind' | 'task'>): Promise<{ questions: string[]; result: AIResult }> {
  const result = await runText(prompt, { ...o, task: 'questions', kind: 'questions' });
  return { questions: parseQuestions(result.text), result };
}

/** Two or three follow-ups the person might send next, from the last exchange only. */
export async function suggestFollowUps(question: string, answer: string, o: Omit<RunOptions, 'kind' | 'task'>): Promise<{ suggestions: string[]; result: AIResult }> {
  const result = await runText(suggestionsPrompt(question, answer), { ...o, task: 'suggest', kind: 'suggest' });
  return { suggestions: parseSuggestions(result.text), result };
}

/**
 * Summarize; when the text is longer than the on-device budget and the route is device-only,
 * summarize it in parts on-device and merge the part summaries (map-reduce).
 */
export async function summarize(text: string, o: Omit<RunOptions, 'task'>): Promise<AIResult & { parts: number }> {
  const budget = getRuntimeConfig().deviceCharBudget;
  if (o.route.expect !== 'device' || text.length <= budget) {
    return { ...(await runText(summarizePrompt(text), { ...o, task: 'summarize' })), parts: 1 };
  }
  const chunks = splitForBudget(text, Math.floor(budget * 0.8));
  const partials: AIResult[] = [];
  for (let n = 0; n < chunks.length; n++) {
    partials.push(await runText(summarizePrompt(chunks[n], `part ${n + 1} of ${chunks.length}`), { ...o, task: 'summarize' }));
  }
  const merged = await runText(combineSummariesPrompt(partials.map((p) => p.text)), { ...o, task: 'summarize' });
  const ms = partials.reduce((n, p) => n + p.ms, merged.ms);
  return { ...merged, ms, parts: chunks.length };
}

/** Splits on paragraph, then sentence, boundaries so no part exceeds `max` characters. */
export function splitForBudget(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  const pieces = text.split(/(\n\s*\n)/).flatMap((p) => (p.length > max ? p.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [p] : [p]));
  for (const piece of pieces) {
    if ((cur + piece).length > max && cur.trim()) {
      out.push(cur.trim());
      cur = '';
    }
    if (piece.length > max) {
      for (let i = 0; i < piece.length; i += max) out.push(piece.slice(i, i + max).trim());
      continue;
    }
    cur += piece;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Cloud transcription through Firebase AI Logic (ONLY_IN_CLOUD: audio is not an on-device input).
 * The recording is decoded, resampled to 16 kHz mono WAV and sent in chunks so long recordings
 * stay well under the inline request size limit. Segment times are offset back to the whole clip.
 */
export async function transcribe(
  blob: Blob,
  o: { route: Route; itemId?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<{ segments: Segment[]; model: string; ms: number }> {
  const t0 = performance.now();
  const chunkSeconds = getRuntimeConfig().transcribeChunkSeconds;
  const samples = await decodeToMono16k(blob);
  const rate = 16_000;
  const totalSec = samples.length / rate;
  const chunkCount = Math.max(1, Math.ceil(totalSec / chunkSeconds));
  const segments: Segment[] = [];
  const model = getModel('transcribe', 'only_in_cloud');
  o.onProgress?.(0, chunkCount);
  for (let n = 0; n < chunkCount; n++) {
    if (o.signal?.aborted) throw new AIUserError('Stopped.', 'cancelled');
    const from = n * chunkSeconds;
    const part = sliceSamples(samples, rate, from, Math.min(totalSec, from + chunkSeconds));
    const partSec = part.length / rate;
    const wav = await blobToBase64(encodeWav(part, rate));
    try {
      const res = await model.generateContent(
        { contents: [{ role: 'user', parts: [{ type: 'inlineData', inlineData: { mimeType: 'audio/wav', data: wav } }, { type: 'text', text: TRANSCRIBE_PROMPT }] }] },
        { signal: o.signal },
      );
      segments.push(...sanitizeSegments(parseSegments(res.response.text()), partSec).map((s) => ({ ...s, start: s.start + from, end: s.end + from })));
    } catch (err) {
      const ue = toUserError(err);
      void logRun({ kind: 'transcribe', itemId: o.itemId, requestedMode: 'only_in_cloud', expected: 'cloud', inputChars: 0, source: null, model: null, ms: Math.round(performance.now() - t0), ok: false, note: ue.message });
      throw ue;
    }
    o.onProgress?.(n + 1, chunkCount);
  }
  const ms = Math.round(performance.now() - t0);
  const modelName = getRuntimeConfig().transcribeModel;
  void logRun({ kind: 'transcribe', itemId: o.itemId, requestedMode: 'only_in_cloud', expected: 'cloud', inputChars: Math.round(totalSec), source: 'cloud', model: modelName, ms, ok: true, note: `${totalSec.toFixed(1)} s of audio in ${chunkCount} part${chunkCount > 1 ? 's' : ''}` });
  return { segments, model: modelName, ms };
}

function parseSegments(raw: string): Segment[] {
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')) as { segments?: Segment[] };
    return (parsed.segments ?? []).filter((s) => typeof s?.text === 'string' && s.text.trim());
  } catch {
    const text = raw.trim();
    return text ? [{ start: 0, end: 0, text }] : [];
  }
}

/**
 * Models sometimes return times out of range, overlapping, or all zero. Keep them inside the clip,
 * in order, and fall back to spreading sentences by length when timing is missing.
 */
export function sanitizeSegments(segs: Segment[], clipSec: number): Segment[] {
  if (!segs.length) return [];
  const timed = segs.some((s) => Number.isFinite(s.end) && s.end > 0);
  if (!timed) {
    const total = segs.reduce((n, s) => n + s.text.length, 0) || 1;
    let at = 0;
    return segs.map((s) => {
      const len = (s.text.length / total) * clipSec;
      const seg = { start: round2(at), end: round2(at + len), text: s.text.trim() };
      at += len;
      return seg;
    });
  }
  let last = 0;
  return segs.map((s) => {
    const start = clamp(Number.isFinite(s.start) ? s.start : last, last, clipSec);
    const end = clamp(Number.isFinite(s.end) && s.end > start ? s.end : start, start, clipSec);
    last = start;
    return { start: round2(start), end: round2(end), text: s.text.trim() };
  });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) bin += String.fromCharCode(...buf.subarray(i, i + step));
  return btoa(bin);
}

/** What Chrome reports for the same options the SDK will use, so status matches routing. */
export async function getDeviceModelStatus(): Promise<DeviceModel> {
  const LM = (globalThis as { LanguageModel?: typeof LanguageModel }).LanguageModel;
  if (!LM || typeof LM.availability !== 'function') return 'unsupported';
  try {
    // Same options object shape the SDK passes, so the answer matches what routing will see.
    return (await LM.availability(deviceCreateOptions() as unknown as LanguageModelCreateCoreOptions)) as DeviceModel;
  } catch {
    return 'unavailable';
  }
}

/**
 * Starts (or joins) the on-device model download through the SDK. Must be called from a tap:
 * Chrome requires user activation to start a download.
 */
export async function downloadDeviceModel(onProgress: (fraction: number) => void): Promise<DeviceModel> {
  if (!isFirebaseConfigured) throw new AIUserError('Cloud AI is not set up in this build.', 'config');
  await getModel('text', 'prefer_on_device').initializeDeviceModel(onProgress);
  return getDeviceModelStatus();
}

/**
 * Local storage (IndexedDB via Dexie). Everything the user creates lives here, on this device.
 * Nothing in this file talks to the network.
 */
import Dexie, { type Table } from 'dexie';
import type { Destination, Mode, Preference, TaskKind } from './ai/route';
import type { Length, Tone } from './ai/prompts';

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export type VersionKind = 'original' | 'edited' | 'clearer' | 'typed';

export interface Version {
  id: string;
  kind: VersionKind;
  label: string;
  text: string;
  source?: Destination;
  model?: string;
  createdAt: number;
}

export type TranscriptSource = 'device-speech' | 'cloud' | 'typed';

export interface Draft {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  hasAudio: boolean;
  audioMime?: string;
  durationMs?: number;
  audioBytes?: number;
  audioDeletedAt?: number;
  transcript?: { segments: Segment[]; source: TranscriptSource; model?: string; at: number };
  versions: Version[];
  activeVersionId: string | null;
  intentNote: string;
  templateId: string | null;
  tone: Tone;
  length: Length;
  answers: { question: string; answer: string }[];
  localOnly: boolean;
  chatId: string | null;
  lastRunAt: number | null;
  /** True while the microphone is still running for this draft (crash-safe checkpoints). */
  recordingActive?: boolean;
  /** Set when a recording was interrupted (tab closed, crash) and recovered on the next start. */
  recovered?: boolean;
}

export interface AudioRecord {
  id: string; // same id as the draft
  blob?: Blob;
  /** The same audio as raw bytes, where the browser won't store a Blob (Safari Private Browsing). */
  bytes?: ArrayBuffer;
  type?: string;
}

/** The recording as a Blob, however it was stored. */
export function audioBlob(rec: AudioRecord | undefined | null): Blob | null {
  if (!rec) return null;
  if (rec.blob) return rec.blob;
  if (rec.bytes) return new Blob([rec.bytes], { type: rec.type || 'audio/webm' });
  return null;
}

/**
 * Stores a recording. Safari's private mode refuses Blobs in IndexedDB ("Error preparing Blob/File
 * data"), so when that write fails the same audio is stored as bytes instead.
 */
async function storeAudio(draftId: string, blob: Blob, write: (rec: AudioRecord) => Promise<void>): Promise<void> {
  try {
    await write({ id: draftId, blob });
  } catch {
    // Safari reports this one without a useful error name, so any failure gets one retry as bytes.
    await write({ id: draftId, bytes: await blob.arrayBuffer(), type: blob.type });
  }
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  draftId: string | null;
  localOnly: boolean;
}

export interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'model';
  text: string;
  createdAt: number;
  source?: Destination;
  model?: string;
  ms?: number;
  status: 'done' | 'error';
  error?: string;
  fellBackFrom?: Destination;
  /** Follow-ups suggested after this answer (tap to fill the box). */
  suggestions?: string[];
}

export interface Note {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  localOnly: boolean;
  summary?: { text: string; source: Destination; model: string; at: number; parts: number };
}

export interface Run {
  id: string;
  at: number;
  kind: TaskKind;
  itemId?: string;
  requestedMode: Mode;
  expected: Destination;
  source: Destination | null;
  model: string | null;
  inputChars: number;
  ms: number;
  ok: boolean;
  note?: string;
}

export type AudioRetention = 'keep' | 'after-transcript' | '1d' | '7d' | '30d';

export interface LockConfig {
  method: 'none' | 'biometric' | 'pin';
  credentialId?: string;
  pinHash?: string;
  salt?: string;
  autoLockMinutes: number;
}

export interface Settings {
  preference: Preference;
  workOffline: boolean;
  liveCaptions: boolean;
  autoTranscribe: boolean;
  stopAfterSilence: 0 | 5 | 10 | 20;
  micDeviceId: string;
  speakerPlayback: boolean;
  outputDeviceId: string;
  audioRetention: AudioRetention;
  defaultLocalOnly: boolean;
  speechLang: string;
  lock: LockConfig;
  onboarded: boolean;
  /** Suggest what to ask next after each answer, with the same AI that answered. */
  suggestFollowUps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  preference: 'auto',
  workOffline: false,
  liveCaptions: true,
  autoTranscribe: false,
  stopAfterSilence: 0,
  micDeviceId: '',
  speakerPlayback: false,
  outputDeviceId: '',
  audioRetention: 'keep',
  defaultLocalOnly: false,
  speechLang: 'en-US',
  lock: { method: 'none', autoLockMinutes: 5 },
  onboarded: false,
  suggestFollowUps: true,
};

interface SettingRow {
  key: keyof Settings;
  value: Settings[keyof Settings];
}

class OfflineDB extends Dexie {
  drafts!: Table<Draft, string>;
  audio!: Table<AudioRecord, string>;
  chats!: Table<Chat, string>;
  messages!: Table<Message, string>;
  notes!: Table<Note, string>;
  runs!: Table<Run, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super('offline');
    this.version(1).stores({
      drafts: 'id, updatedAt, chatId',
      audio: 'id',
      chats: 'id, updatedAt, draftId',
      messages: 'id, chatId, createdAt',
      notes: 'id, updatedAt',
      runs: 'id, at, itemId',
      settings: 'key',
    });
  }
}

export const db = new OfflineDB();

export const uid = (): string => crypto.randomUUID();

export async function readSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const s = { ...DEFAULT_SETTINGS } as Settings;
  for (const r of rows) (s as unknown as Record<string, unknown>)[r.key] = r.value;
  return s;
}

export async function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value });
}

export async function logRun(r: Omit<Run, 'id' | 'at'>): Promise<void> {
  try {
    await db.runs.add({ ...r, id: uid(), at: Date.now() });
  } catch {
    /* history is best effort */
  }
}

/** A short title from the first words, for lists. */
const LEADING_FILLER = /^(?:(?:um+|uh+|erm+|hmm+|so|okay|ok|well|like|yeah|right|basically|actually|you know)[,.]?\s+)+/i;

export function titleFrom(text: string, fallback: string): string {
  let clean = text.replace(/\s+/g, ' ').trim().replace(LEADING_FILLER, '');
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (!clean) return fallback;
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0];
  const t = firstSentence.length <= 64 ? firstSentence : `${clean.slice(0, 60).replace(/\s+\S*$/, '')}…`;
  return t.replace(/[.!?]$/, '');
}

export function activeText(d: Draft): string {
  return d.versions.find((v) => v.id === d.activeVersionId)?.text ?? d.versions[0]?.text ?? '';
}

export async function createDraft(init: Partial<Draft> & { localOnly: boolean }): Promise<Draft> {
  const now = Date.now();
  const draft: Draft = {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    title: 'New recording',
    hasAudio: false,
    versions: [],
    activeVersionId: null,
    intentNote: '',
    templateId: null,
    tone: 'neutral',
    length: 'any',
    answers: [],
    chatId: null,
    lastRunAt: null,
    ...init,
  };
  await db.drafts.add(draft);
  return draft;
}

export async function saveRecording(draftId: string, blob: Blob, durationMs: number): Promise<void> {
  await storeAudio(draftId, blob, (rec) =>
    db.transaction('rw', db.drafts, db.audio, async () => {
      await db.audio.put(rec);
      await db.drafts.update(draftId, {
        hasAudio: true,
        audioMime: blob.type,
        durationMs,
        audioBytes: blob.size,
        audioDeletedAt: undefined,
        updatedAt: Date.now(),
      });
    }),
  );
}

/** Sets the transcript as the Original version; an existing original is never overwritten. */
export async function setTranscript(draftId: string, segments: Segment[], source: TranscriptSource, model?: string): Promise<void> {
  const d = await db.drafts.get(draftId);
  if (!d) return;
  const text = segments.map((s) => s.text.trim()).join(' ').trim();
  const now = Date.now();
  const versions = d.versions.some((v) => v.kind === 'original') ? d.versions : [{ id: uid(), kind: 'original' as const, label: 'Original', text, createdAt: now, source: source === 'cloud' ? ('cloud' as const) : ('device' as const), model }, ...d.versions];
  const original = versions.find((v) => v.kind === 'original')!;
  await db.drafts.update(draftId, {
    transcript: { segments, source, model, at: now },
    versions,
    activeVersionId: d.activeVersionId ?? original.id,
    title: titleFrom(original.text, d.title),
    updatedAt: now,
  });
}

/** Edits keep the original intact: editing the original creates an "Edited" version. */
export async function editActiveText(draftId: string, text: string): Promise<void> {
  const d = await db.drafts.get(draftId);
  if (!d) return;
  const now = Date.now();
  let versions = d.versions;
  let activeId = d.activeVersionId;
  const active = versions.find((v) => v.id === activeId);
  if (!active) {
    const v: Version = { id: uid(), kind: 'typed', label: 'Typed', text, createdAt: now };
    versions = [v];
    activeId = v.id;
  } else if (active.kind === 'original') {
    const existingEdit = versions.find((v) => v.kind === 'edited' && v.label === 'Edited');
    if (existingEdit) {
      versions = versions.map((v) => (v.id === existingEdit.id ? { ...v, text } : v));
      activeId = existingEdit.id;
    } else {
      const v: Version = { id: uid(), kind: 'edited', label: 'Edited', text, createdAt: now };
      versions = [...versions, v];
      activeId = v.id;
    }
  } else {
    versions = versions.map((v) => (v.id === active.id ? { ...v, text } : v));
  }
  await db.drafts.update(draftId, { versions, activeVersionId: activeId, title: titleFrom(text, d.title), updatedAt: now });
}

export async function addVersion(draftId: string, v: Omit<Version, 'id' | 'createdAt'>): Promise<Version> {
  const d = await db.drafts.get(draftId);
  if (!d) throw new Error('Draft not found');
  const version: Version = { ...v, id: uid(), createdAt: Date.now() };
  await db.drafts.update(draftId, { versions: [...d.versions, version], activeVersionId: version.id, title: titleFrom(version.text, d.title), updatedAt: Date.now() });
  return version;
}

export async function deleteAudio(draftId: string): Promise<void> {
  await db.transaction('rw', db.drafts, db.audio, async () => {
    await db.audio.delete(draftId);
    await db.drafts.update(draftId, { hasAudio: false, audioDeletedAt: Date.now(), audioBytes: 0, updatedAt: Date.now() });
  });
}

export async function deleteTranscript(draftId: string): Promise<void> {
  await db.drafts.update(draftId, { transcript: undefined, versions: [], activeVersionId: null, updatedAt: Date.now() });
}

export async function deleteChat(chatId: string): Promise<void> {
  await db.transaction('rw', db.chats, db.messages, db.drafts, async () => {
    await db.messages.where('chatId').equals(chatId).delete();
    await db.chats.delete(chatId);
    await db.drafts.where('chatId').equals(chatId).modify({ chatId: null });
  });
}

export async function deleteDraft(draftId: string, withChat: boolean): Promise<void> {
  const d = await db.drafts.get(draftId);
  if (withChat && d?.chatId) await deleteChat(d.chatId);
  await db.transaction('rw', db.drafts, db.audio, db.runs, async () => {
    await db.audio.delete(draftId);
    await db.drafts.delete(draftId);
    await db.runs.where('itemId').equals(draftId).delete();
  });
}

/** Saves what has been recorded so far, so closing the tab mid-recording loses at most a second. */
export async function checkpointRecording(draftId: string, blob: Blob, durationMs: number): Promise<void> {
  await storeAudio(draftId, blob, (rec) =>
    db.transaction('rw', db.drafts, db.audio, async () => {
      const d = await db.drafts.get(draftId);
      if (!d || !d.recordingActive) return;
      await db.audio.put(rec);
      await db.drafts.update(draftId, { hasAudio: true, audioMime: blob.type, durationMs, audioBytes: blob.size });
    }),
  );
}

/** On start-up: recordings that were still running when the app closed become normal drafts. */
export async function recoverInterruptedRecordings(): Promise<number> {
  const open = await db.drafts.filter((d) => Boolean(d.recordingActive)).toArray();
  for (const d of open) {
    const audio = audioBlob(await db.audio.get(d.id));
    if (audio && audio.size > 0) await db.drafts.update(d.id, { recordingActive: false, recovered: true, updatedAt: Date.now() });
    else await db.drafts.delete(d.id);
  }
  return open.length;
}

/** Applies the audio auto-delete setting. Returns how many recordings were removed. */
export async function applyAudioRetention(retention: AudioRetention): Promise<number> {
  if (retention === 'keep') return 0;
  const now = Date.now();
  const maxAge: Record<Exclude<AudioRetention, 'keep' | 'after-transcript'>, number> = { '1d': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
  const drafts = await db.drafts.filter((d) => d.hasAudio).toArray();
  let removed = 0;
  for (const d of drafts) {
    const expired = retention === 'after-transcript' ? Boolean(d.transcript?.segments.length) : now - d.createdAt > maxAge[retention];
    if (expired) {
      await deleteAudio(d.id);
      removed++;
    }
  }
  return removed;
}

export async function wipeEverything(): Promise<void> {
  await db.transaction('rw', [db.drafts, db.audio, db.chats, db.messages, db.notes, db.runs], async () => {
    await Promise.all([db.drafts.clear(), db.audio.clear(), db.chats.clear(), db.messages.clear(), db.notes.clear(), db.runs.clear()]);
  });
}

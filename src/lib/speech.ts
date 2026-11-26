/**
 * Live captions with Chrome's on-device speech recognition (Web Speech API, processLocally).
 *
 * Privacy rule: Offline only ever uses *on-device* recognition. The classic Web Speech API in
 * Chrome streams audio to a Google server; we never fall back to that, because a recording is
 * private until the user chooses to send it.
 *
 * The API surface changed across Chrome releases, so everything is feature-detected:
 *   new: SpeechRecognition.available({ langs, processLocally: true }) / .install(...) / rec.processLocally = true
 *   old: SpeechRecognition.availableOnDevice(lang) / .installOnDevice(lang) / rec.mode = 'ondevice-only'
 */

export type SpeechStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  mode?: string;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
interface RecognitionCtor {
  new (): RecognitionLike;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  availableOnDevice?: (lang: string) => Promise<string>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}

function ctor(): RecognitionCtor | null {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

function normalize(s: string): SpeechStatus {
  if (s === 'available' || s === 'downloadable' || s === 'downloading') return s;
  // Some builds report "readily"/"after-download" (older naming).
  if (s === 'readily') return 'available';
  if (s === 'after-download') return 'downloadable';
  return 'unavailable';
}

export async function onDeviceSpeechStatus(lang: string): Promise<SpeechStatus> {
  const SR = ctor();
  if (!SR) return 'unsupported';
  try {
    if (typeof SR.available === 'function') return normalize(await SR.available({ langs: [lang], processLocally: true }));
    if (typeof SR.availableOnDevice === 'function') return normalize(await SR.availableOnDevice(lang));
  } catch {
    return 'unavailable';
  }
  // Speech recognition exists but has no on-device mode: it would send audio to a server.
  return 'unsupported';
}

/** Downloads the on-device language pack. Call from a tap. */
export async function installOnDeviceSpeech(lang: string): Promise<boolean> {
  const SR = ctor();
  if (!SR) return false;
  try {
    if (typeof SR.install === 'function') return await SR.install({ langs: [lang], processLocally: true });
    if (typeof SR.installOnDevice === 'function') return await SR.installOnDevice(lang);
  } catch {
    return false;
  }
  return false;
}

export interface LiveCaption {
  /** Final sentences with their time in the recording (seconds, pauses excluded). */
  finals: { start: number; end: number; text: string }[];
  interim: string;
}

export interface CaptionSession {
  pause(): void;
  resume(): void;
  stop(): LiveCaption;
}

/**
 * Starts on-device captions. `clock()` returns recording time in ms (pauses excluded), so each
 * final result can be stamped with where it sits in the audio, for tap-to-play.
 * Returns null when on-device recognition is not available; it never uses the cloud service.
 */
export function startCaptions(opts: {
  lang: string;
  track: MediaStreamTrack | null;
  clock: () => number;
  onUpdate: (c: LiveCaption) => void;
  onError?: (message: string) => void;
}): CaptionSession | null {
  const SR = ctor();
  if (!SR) return null;
  const state: LiveCaption = { finals: [], interim: '' };
  let rec: RecognitionLike | null = null;
  let running = false;
  let segmentStart = 0;
  let stopped = false;

  const make = (): RecognitionLike | null => {
    const r = new SR();
    r.lang = opts.lang;
    r.continuous = true;
    r.interimResults = true;
    if ('processLocally' in r || typeof SR.available === 'function') r.processLocally = true;
    else if (typeof SR.availableOnDevice === 'function') r.mode = 'ondevice-only';
    else return null; // no on-device mode: refuse rather than stream audio to a server
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) {
          const end = opts.clock() / 1000;
          const clean = text.trim();
          if (clean) state.finals.push({ start: segmentStart, end, text: clean.charAt(0).toUpperCase() + clean.slice(1) });
          segmentStart = end;
        } else {
          interim += text;
        }
      }
      state.interim = interim.trim();
      opts.onUpdate({ finals: [...state.finals], interim: state.interim });
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      opts.onError?.(e.error === 'language-not-supported' ? 'Live captions are not available for this language on this device.' : `Live captions stopped (${e.error}).`);
    };
    r.onend = () => {
      // Chrome ends continuous sessions after silence; restart while we are still recording.
      if (running && !stopped) {
        try {
          r.start(opts.track ?? undefined);
        } catch {
          /* will retry on next resume */
        }
      }
    };
    return r;
  };

  const begin = () => {
    rec = make();
    if (!rec) return false;
    running = true;
    segmentStart = opts.clock() / 1000;
    try {
      // Newer Chrome accepts the MediaStreamTrack, so captions hear the same microphone we record.
      rec.start(opts.track ?? undefined);
    } catch {
      try {
        rec.start();
      } catch {
        running = false;
        return false;
      }
    }
    return true;
  };

  if (!begin()) return null;

  return {
    pause() {
      running = false;
      try {
        rec?.stop();
      } catch {
        /* noop */
      }
    },
    resume() {
      if (stopped) return;
      begin();
    },
    stop() {
      stopped = true;
      running = false;
      try {
        rec?.stop();
      } catch {
        /* noop */
      }
      const out = { finals: [...state.finals], interim: '' };
      // Keep a trailing interim phrase: it is usually the last words before Stop.
      if (state.interim) out.finals.push({ start: segmentStart, end: opts.clock() / 1000, text: state.interim });
      return out;
    },
  };
}

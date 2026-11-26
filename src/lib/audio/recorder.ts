/**
 * Microphone recording with MediaRecorder, plus a live level meter for the waveform and
 * silence detection. Elapsed time excludes pauses.
 */

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecordingResult {
  blob: Blob;
  durationMs: number;
}

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export class MicError extends Error {
  constructor(
    message: string,
    public readonly code: 'denied' | 'no-device' | 'busy' | 'unsupported' | 'unknown',
  ) {
    super(message);
  }
}

export class Recorder {
  state: RecorderState = 'idle';
  mimeType = '';
  private stream: MediaStream | null = null;
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private stopResolve: ((r: RecordingResult) => void) | null = null;

  /** Called with every chunk so far, roughly once a second, for crash-safe checkpoints. */
  onChunk: ((all: Blob[], elapsedMs: number) => void) | null = null;

  async start(deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new MicError("This browser can't record audio.", 'unsupported');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new MicError('Microphone access is blocked. Allow it in the address bar, then try again.', 'denied');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new MicError('No microphone found. Plug one in or pick another in Settings.', 'no-device');
      }
      if (name === 'NotReadableError') {
        throw new MicError('Another app is using the microphone. Close it and try again.', 'busy');
      }
      throw new MicError(`The microphone could not start (${name || 'unknown error'}).`, 'unknown');
    }
    this.mimeType = pickMimeType();
    this.mr = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 48_000 } : undefined);
    this.mimeType = this.mr.mimeType || this.mimeType || 'audio/webm';
    this.chunks = [];
    this.mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        this.onChunk?.(this.chunks, this.elapsedMs());
      }
    };
    this.mr.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType });
      const durationMs = this.elapsedMs();
      this.state = 'stopped';
      this.release();
      this.stopResolve?.({ blob, durationMs });
    };
    this.mr.start(1000);
    this.startedAt = performance.now();
    this.pausedTotal = 0;
    this.state = 'recording';

    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      src.connect(this.analyser);
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    } catch {
      // The meter is decoration; recording works without it.
    }
  }

  /** The live microphone track, for on-device speech recognition. */
  get track(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  get deviceLabel(): string {
    return this.track?.label ?? '';
  }

  /** RMS level from 0 to about 1. */
  level(): number {
    if (!this.analyser || !this.buf || this.state !== 'recording') return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  elapsedMs(): number {
    if (!this.startedAt) return 0;
    const now = this.state === 'paused' ? this.pausedAt : performance.now();
    return Math.max(0, Math.round(now - this.startedAt - this.pausedTotal));
  }

  pause(): void {
    if (this.state !== 'recording' || !this.mr) return;
    this.mr.pause();
    this.pausedAt = performance.now();
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused' || !this.mr) return;
    this.mr.resume();
    this.pausedTotal += performance.now() - this.pausedAt;
    this.state = 'recording';
  }

  stop(): Promise<RecordingResult> {
    return new Promise((resolve) => {
      if (!this.mr || this.mr.state === 'inactive') {
        resolve({ blob: new Blob(this.chunks, { type: this.mimeType }), durationMs: this.elapsedMs() });
        return;
      }
      if (this.state === 'paused') this.pausedTotal += performance.now() - this.pausedAt;
      this.state = 'recording';
      this.stopResolve = resolve;
      this.mr.stop();
    });
  }

  /** Stops and throws the audio away. */
  cancel(): void {
    this.onChunk = null;
    this.stopResolve = null;
    try {
      if (this.mr && this.mr.state !== 'inactive') this.mr.stop();
    } catch {
      /* already stopped */
    }
    this.chunks = [];
    this.state = 'stopped';
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }
}

/** Lists microphones and speakers. Labels are only filled in after mic permission is granted. */
export async function listAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return { inputs: all.filter((d) => d.kind === 'audioinput'), outputs: all.filter((d) => d.kind === 'audiooutput') };
}

const HEADPHONE_HINT = /head(phone|set)|earbud|airpods|buds|bluetooth|hands-free|bose|sony wh|jabra|beats/i;

/** Best guess, from device labels, whether private listening is available. */
export async function headphonesLikely(): Promise<boolean> {
  try {
    const { outputs, inputs } = await listAudioDevices();
    return [...outputs, ...inputs].some((d) => HEADPHONE_HINT.test(d.label));
  } catch {
    return false;
  }
}

/** Storage left for this site, and a warning when it is low. */
export async function storageStatus(): Promise<{ usage: number; quota: number; free: number; low: boolean; persisted: boolean | null }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const usage = est?.usage ?? 0;
    const quota = est?.quota ?? 0;
    const free = Math.max(0, quota - usage);
    // About 15 minutes of Opus audio is 5 MB; warn well before that is at risk.
    return { usage, quota, free, low: quota > 0 && free < 50 * 1024 * 1024, persisted };
  } catch {
    return { usage: 0, quota: 0, free: 0, low: false, persisted: null };
  }
}

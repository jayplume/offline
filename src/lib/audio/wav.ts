/**
 * Audio helpers for cloud transcription. Chrome's MediaRecorder writes WebM/Opus, which is not on
 * Gemini's documented audio list, so recordings are decoded and re-encoded as 16 kHz mono WAV.
 * 16 kHz is all speech recognition needs and keeps each request small (32 KB per second).
 */

export const TARGET_RATE = 16_000;

/** Decodes any browser-playable audio blob to mono Float32 samples at 16 kHz. */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  // decodeAudioData resamples to the context's rate, so an OfflineAudioContext at 16 kHz
  // gives us decoding and resampling in one step, off the main audio graph.
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  const buffer = await ctx.decodeAudioData(data);
  return mixToMono(buffer);
}

export function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
  }
  return out;
}

export function sliceSamples(samples: Float32Array, rate: number, fromSec: number, toSec: number): Float32Array {
  const a = Math.max(0, Math.floor(fromSec * rate));
  const b = Math.min(samples.length, Math.ceil(toSec * rate));
  return samples.subarray(a, Math.max(a, b));
}

/** 16-bit PCM WAV, little-endian, mono. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM format
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * bytesPerSample, true); // byte rate
  v.setUint16(32, bytesPerSample, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

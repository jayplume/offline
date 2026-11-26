import { describe, expect, it } from 'vitest';
import { decideRoute, type RouteInput } from '../ai/route';

const base: RouteInput = {
  task: 'run',
  online: true,
  workOffline: false,
  device: 'available',
  preference: 'auto',
  localOnly: false,
  inputChars: 400,
  deviceCharBudget: 14000,
  cloudConfigured: true,
};
const r = (o: Partial<RouteInput>) => decideRoute({ ...base, ...o });

describe('hybrid routing policy', () => {
  it('prefers the device when its model is ready (true hybrid call)', () => {
    const d = r({});
    expect(d.ok && d.mode).toBe('prefer_on_device');
    expect(d.ok && d.expect).toBe('device');
    expect(d.ok && d.mayUse).toEqual(['device', 'cloud']);
  });

  it('still asks the SDK for prefer_on_device when the device cannot, and says the cloud will answer', () => {
    for (const device of ['downloadable', 'downloading', 'unavailable', 'unsupported'] as const) {
      const d = r({ device });
      expect(d.ok && d.mode).toBe('prefer_on_device');
      expect(d.ok && d.expect).toBe('cloud');
      expect(d.ok && d.mayUse).toEqual(['cloud']);
    }
  });

  it('never uses the cloud for a local-only item', () => {
    const d = r({ localOnly: true });
    expect(d.ok && d.mode).toBe('only_on_device');
    const none = r({ localOnly: true, device: 'unsupported' });
    expect(none.ok).toBe(false);
    expect(!none.ok && none.fix).toBe('allow-cloud');
  });

  it('runs on the device when offline, and blocks with a reason when it cannot', () => {
    expect(r({ online: false }).ok && (r({ online: false }) as { mode: string }).mode).toBe('only_on_device');
    const blocked = r({ online: false, device: 'unavailable' });
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.fix).toBe('connect');
  });

  it('treats Work offline exactly like no connection', () => {
    const d = r({ workOffline: true, device: 'unsupported' });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.reason).toMatch(/Work offline/);
  });

  it('sends long inputs to the cloud in Automatic mode', () => {
    const d = r({ inputChars: 20000 });
    expect(d.ok && d.mode).toBe('only_in_cloud');
  });

  it('blocks long local-only prompts, but not summaries (they are chunked on-device)', () => {
    expect(r({ localOnly: true, inputChars: 20000 }).ok).toBe(false);
    const s = r({ localOnly: true, inputChars: 20000, task: 'summarize' });
    expect(s.ok && s.mode).toBe('only_on_device');
  });

  it('honours Cloud first, with the device as fallback when ready', () => {
    const d = r({ preference: 'cloud-first' });
    expect(d.ok && d.mode).toBe('prefer_in_cloud');
    expect(d.ok && d.mayUse).toEqual(['cloud', 'device']);
  });

  it('routes audio transcription to the cloud only (no on-device audio in hybrid inference)', () => {
    const d = r({ task: 'transcribe' });
    expect(d.ok && d.mode).toBe('only_in_cloud');
    expect(r({ task: 'transcribe', localOnly: true }).ok).toBe(false);
    expect(r({ task: 'transcribe', online: false }).ok).toBe(false);
    expect(r({ task: 'transcribe', preference: 'device-only' }).ok).toBe(false);
  });

  it('does not offer the cloud when the build has no Firebase config', () => {
    const d = r({ cloudConfigured: false, device: 'unsupported' });
    expect(d.ok).toBe(false);
    const dev = r({ cloudConfigured: false });
    expect(dev.ok && dev.mode).toBe('only_on_device');
  });
});

/**
 * The hybrid routing policy: decides, before anything is sent, where an AI task may run.
 *
 * Firebase AI Logic's InferenceMode decides *how* to fall back. This policy decides *which*
 * mode to ask for, from things the SDK cannot know: the user's privacy choice for this item,
 * whether we are actually reachable, the task's input type, and its size.
 *
 * It is pure (no SDK imports) so it is unit-tested and the preview sheet can show the user
 * exactly what will happen before they press Send.
 */

/** Same string values as firebase/ai InferenceMode. */
export type Mode = 'prefer_on_device' | 'only_on_device' | 'only_in_cloud' | 'prefer_in_cloud';

/** LanguageModel.availability() results, plus "unsupported" when the Prompt API is absent. */
export type DeviceModel = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

/** Settings: where AI runs by default. */
export type Preference = 'auto' | 'cloud-first' | 'device-only';

export type TaskKind = 'transcribe' | 'clarify' | 'questions' | 'run' | 'chat' | 'summarize';

export type Destination = 'device' | 'cloud';

export interface RouteInput {
  task: TaskKind;
  /** Reachability from the connectivity probe, not just navigator.onLine. */
  online: boolean;
  /** The user's "Work offline" switch: treat the network as absent even if it is there. */
  workOffline: boolean;
  device: DeviceModel;
  preference: Preference;
  /** Per-item "Never use the cloud for this". */
  localOnly: boolean;
  /** Characters of input the model will see (prompt plus any history). */
  inputChars: number;
  /** Above this, Automatic prefers the cloud (Remote Config: device_char_budget). */
  deviceCharBudget: number;
  /** False when the build has no Firebase config, so the cloud cannot be used at all. */
  cloudConfigured: boolean;
}

export interface Route {
  ok: true;
  mode: Mode;
  /** Where we expect it to run, shown in the send preview. */
  expect: Destination;
  /** Every place this mode is allowed to use, so the preview never under-states it. */
  mayUse: Destination[];
  reason: string;
}

export type Fix = 'connect' | 'download-model' | 'allow-cloud' | 'shorten' | 'configure';

export interface Blocked {
  ok: false;
  reason: string;
  fix?: Fix;
}

export type RouteDecision = Route | Blocked;

const route = (mode: Mode, expect: Destination, mayUse: Destination[], reason: string): Route => ({
  ok: true,
  mode,
  expect,
  mayUse,
  reason,
});

const blocked = (reason: string, fix?: Fix): Blocked => ({ ok: false, reason, fix });

function deviceWhyNot(device: DeviceModel): string {
  switch (device) {
    case 'downloadable':
      return "The on-device model isn't downloaded yet";
    case 'downloading':
      return 'The on-device model is still downloading';
    case 'unavailable':
      return "This device can't run Chrome's on-device model";
    case 'unsupported':
    default:
      return "This browser doesn't offer an on-device model";
  }
}

export function decideRoute(i: RouteInput): RouteDecision {
  const reachable = i.online && !i.workOffline;
  const cloudAllowed = !i.localOnly && i.preference !== 'device-only';
  const deviceReady = i.device === 'available';
  const deviceLater = i.device === 'downloadable' || i.device === 'downloading';
  const tooLong = i.inputChars > i.deviceCharBudget;
  // Summaries of long text are split into chunks on-device, so length never blocks them.
  const lengthBlocksDevice = tooLong && i.task !== 'summarize';

  if (i.task === 'transcribe') {
    // Chrome's on-device model takes text and images only through Firebase AI Logic,
    // so recorded audio can only be transcribed by Gemini in the cloud.
    if (!cloudAllowed) {
      return blocked(
        i.localOnly
          ? 'This draft is set to stay on this device, and transcribing audio needs Gemini in the cloud. You can type it out instead.'
          : 'AI is set to "This device only", and transcribing audio needs Gemini in the cloud. You can type it out instead.',
        'allow-cloud',
      );
    }
    if (!i.cloudConfigured) return blocked('Cloud AI is not set up in this build.', 'configure');
    if (!reachable) {
      return blocked(
        i.workOffline
          ? 'You turned on "Work offline". Your recording is saved; transcribe it when you turn that off.'
          : "You're offline. Your recording is saved; transcribe it when you're back online.",
        'connect',
      );
    }
    return route('only_in_cloud', 'cloud', ['cloud'], 'Gemini in the cloud transcribes audio. The on-device model only reads text.');
  }

  // Text tasks.
  if (!cloudAllowed || !i.cloudConfigured) {
    const why = i.localOnly ? 'Cloud is off for this item' : !i.cloudConfigured ? 'Cloud AI is not set up in this build' : 'AI is set to this device only';
    if (deviceReady) {
      if (lengthBlocksDevice) {
        return blocked(`This is too long for the on-device model. ${why}, so shorten it first.`, 'shorten');
      }
      return route('only_on_device', 'device', ['device'], `${why}, so this runs on this device.`);
    }
    if (deviceLater) return blocked(`${deviceWhyNot(i.device)}. ${why}, so AI is paused for now.`, 'download-model');
    return blocked(`${deviceWhyNot(i.device)}, and ${why.charAt(0).toLowerCase()}${why.slice(1)}.`, 'allow-cloud');
  }

  if (!reachable) {
    const where = i.workOffline ? 'You turned on "Work offline"' : "You're offline";
    if (deviceReady) {
      if (lengthBlocksDevice) return blocked(`${where}, and this is too long for the on-device model. It's saved; run it when you're connected.`, 'connect');
      return route('only_on_device', 'device', ['device'], `${where}, so this runs on this device.`);
    }
    if (deviceLater) return blocked(`${where}, and ${deviceWhyNot(i.device).toLowerCase()}. It's saved; run it when you're connected.`, 'connect');
    return blocked(`${where}. It's saved; run it when you're connected.`, 'connect');
  }

  // Online and the cloud is allowed: this is where hybrid inference does its work.
  if (i.preference === 'cloud-first') {
    return route(
      'prefer_in_cloud',
      'cloud',
      deviceReady ? ['cloud', 'device'] : ['cloud'],
      deviceReady ? 'Cloud first (your setting). Falls back to this device if the cloud fails.' : 'Cloud first (your setting).',
    );
  }
  if (tooLong) {
    return route('only_in_cloud', 'cloud', ['cloud'], 'This is long, so Gemini in the cloud handles it. The on-device model has a smaller context.');
  }
  if (deviceReady) {
    return route('prefer_on_device', 'device', ['device', 'cloud'], 'The on-device model is ready, so this stays on this device.');
  }
  return route('prefer_on_device', 'cloud', ['cloud'], `${deviceWhyNot(i.device)}, so Gemini in the cloud answers.`);
}

/** Rough token estimate for budgeting: Gemini averages about 4 characters per token in English. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

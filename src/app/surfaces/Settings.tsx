import { useEffect, useState, type ReactNode } from 'react';
import { SurfaceBar } from '../ui/Surface';
import { Confirm, Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { setSetting, useSettings } from '../settings';
import { applyAudioRetention, wipeEverything, type AudioRetention, type Settings } from '../../lib/db';
import { listAudioDevices } from '../../lib/audio/recorder';
import { biometricAvailable, enrollBiometric, hashPin } from '../../lib/lock';
import { refreshStatus, setSpeechLang, useStatus } from '../../lib/status';
import { formatBytes } from '../../lib/text';
import { firebaseConfig } from '../../lib/firebase';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <h2>{title}</h2>
      <div className="set-items">{children}</div>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`set-row toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="set-text">
        <span className="set-label">{label}</span>
        {hint ? <span className="set-hint">{hint}</span> : null}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Choice<T extends string | number>({ label, hint, value, options, onChange }: { label: string; hint?: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="set-row set-col">
      <span className="set-text">
        <span className="set-label">{label}</span>
        {hint ? <span className="set-hint">{hint}</span> : null}
      </span>
      <div className="choice-row" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={o.v === value} className={`choice${o.v === value ? ' is-on' : ''}`} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Select({ label, hint, value, options, onChange }: { label: string; hint?: string; value: string; options: { v: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="set-row set-col">
      <span className="set-text">
        <span className="set-label">{label}</span>
        {hint ? <span className="set-hint">{hint}</span> : null}
      </span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const PREFS: { v: Settings['preference']; label: string; hint: string }[] = [
  { v: 'auto', label: 'Automatic', hint: 'On this device when its model is ready; otherwise Gemini in the cloud. Uses Firebase AI Logic hybrid inference (prefer on-device).' },
  { v: 'cloud-first', label: 'Cloud first', hint: 'Gemini in the cloud for the best answers; this device takes over if the cloud fails.' },
  { v: 'device-only', label: 'This device only', hint: 'Never use the cloud. AI works only where an on-device model exists.' },
];

export function SettingsSurface() {
  const { settings } = useSettings();
  const status = useStatus();
  const toast = useToast();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([]);
  const [bio, setBio] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [wipe, setWipe] = useState(false);

  useEffect(() => {
    void listAudioDevices().then(({ inputs, outputs }) => {
      setMics(inputs);
      setOuts(outputs);
    });
    void biometricAvailable().then(setBio);
  }, []);

  const pref = PREFS.find((p) => p.v === settings.preference)!;
  const canSink = typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';

  const setLockMethod = async (method: Settings['lock']['method']) => {
    if (method === 'none') {
      await setSetting('lock', { method: 'none', autoLockMinutes: settings.lock.autoLockMinutes });
      toast('App lock off');
    } else if (method === 'biometric') {
      try {
        const credentialId = await enrollBiometric();
        await setSetting('lock', { method: 'biometric', credentialId, autoLockMinutes: settings.lock.autoLockMinutes });
        toast('App lock on: your device unlock opens Offline');
      } catch {
        toast("Device unlock wasn't set up");
      }
    } else {
      setPin('');
      setPin2('');
      setPinOpen(true);
    }
  };

  return (
    <div className="tool tool-settings">
      <SurfaceBar title="Settings" />
      <div className="tool-scroll settings">
        <Group title="AI">
          <Choice label="Where AI runs" hint={pref.hint} value={settings.preference} options={PREFS.map((p) => ({ v: p.v, label: p.label }))} onChange={(v) => void setSetting('preference', v)} />
          <Toggle label="New items stay on this device" hint="New recordings, notes and chats start with “Keep on this device only” turned on." checked={settings.defaultLocalOnly} onChange={(v) => void setSetting('defaultLocalOnly', v)} />
          <Toggle
            label="Transcribe right after saving"
            hint="Sends each new recording to Gemini in the cloud as soon as you save it, when you're online and the cloud is allowed. Off means you choose each time."
            checked={settings.autoTranscribe}
            onChange={(v) => void setSetting('autoTranscribe', v)}
          />
          <Toggle
            label="Suggest follow-ups"
            hint="After each answer, suggest what to ask next, using the same AI that answered (on this device when it can). Tap one to put it in the box."
            checked={settings.suggestFollowUps}
            onChange={(v) => void setSetting('suggestFollowUps', v)}
          />
          <Toggle label="Work offline" hint="Use no network at all, even when connected. Good for flights, or for testing." checked={settings.workOffline} onChange={(v) => void setSetting('workOffline', v)} />
        </Group>

        <Group title="Recording">
          <Select
            label="Microphone"
            hint={mics.some((m) => m.label) ? 'Headsets and external mics work well in noisy places.' : 'Names appear after you allow the microphone once.'}
            value={settings.micDeviceId}
            options={[{ v: '', label: 'System default' }, ...mics.filter((m) => m.deviceId && m.deviceId !== 'default').map((m, i) => ({ v: m.deviceId, label: m.label || `Microphone ${i + 1}` }))]}
            onChange={(v) => void setSetting('micDeviceId', v)}
          />
          <Toggle
            label="Live captions on this device"
            hint={status.speech === 'available' ? 'Your words appear as you speak. Audio never leaves the device for this.' : 'Not available in this browser yet. See “What works right now” on the home screen.'}
            checked={settings.liveCaptions && status.speech === 'available'}
            disabled={status.speech !== 'available'}
            onChange={(v) => void setSetting('liveCaptions', v)}
          />
          <Select
            label="Speech language"
            value={settings.speechLang}
            options={[
              { v: 'en-US', label: 'English (US)' },
              { v: 'en-GB', label: 'English (UK)' },
              { v: 'en-NG', label: 'English (Nigeria)' },
              { v: 'en-IN', label: 'English (India)' },
              { v: 'fr-FR', label: 'French' },
              { v: 'es-ES', label: 'Spanish' },
              { v: 'de-DE', label: 'German' },
              { v: 'ja-JP', label: 'Japanese' },
            ]}
            onChange={(v) => {
              setSpeechLang(v);
              void setSetting('speechLang', v).then(() => refreshStatus());
            }}
          />
          <Choice
            label="Stop after silence"
            hint="Ends the recording after a quiet stretch, with a three-second warning first."
            value={settings.stopAfterSilence}
            options={[
              { v: 0, label: 'Off' },
              { v: 5, label: '5 s' },
              { v: 10, label: '10 s' },
              { v: 20, label: '20 s' },
            ]}
            onChange={(v) => void setSetting('stopAfterSilence', v as Settings['stopAfterSilence'])}
          />
        </Group>

        <Group title="Listening">
          <Toggle label="Play on speaker without asking" hint="Off: Offline asks before playing a recording out loud when no headphones seem connected." checked={settings.speakerPlayback} onChange={(v) => void setSetting('speakerPlayback', v)} />
          {canSink && outs.length > 1 ? (
            <Select
              label="Play through"
              value={settings.outputDeviceId}
              options={[{ v: '', label: 'System default' }, ...outs.filter((o) => o.deviceId && o.deviceId !== 'default').map((o, i) => ({ v: o.deviceId, label: o.label || `Output ${i + 1}` }))]}
              onChange={(v) => void setSetting('outputDeviceId', v)}
            />
          ) : null}
        </Group>

        <Group title="Privacy">
          <Choice
            label="Delete recordings automatically"
            hint="Removes the audio and keeps the text."
            value={settings.audioRetention}
            options={[
              { v: 'keep', label: 'Never' },
              { v: 'after-transcript', label: 'After transcribing' },
              { v: '1d', label: '1 day' },
              { v: '7d', label: '7 days' },
              { v: '30d', label: '30 days' },
            ]}
            onChange={async (v: AudioRetention) => {
              await setSetting('audioRetention', v);
              const n = await applyAudioRetention(v);
              if (n) toast(`${n} recording${n > 1 ? 's' : ''} deleted`);
            }}
          />
          <Choice
            label="App lock"
            hint={
              settings.lock.method === 'none'
                ? 'Hide your drafts from anyone who picks up this device. It keeps casual eyes out; it does not encrypt the data.'
                : settings.lock.method === 'biometric'
                  ? 'Unlock with your device: Touch ID, Windows Hello or screen lock.'
                  : 'Unlock with your PIN.'
            }
            value={settings.lock.method}
            options={[{ v: 'none', label: 'Off' }, ...(bio ? [{ v: 'biometric' as const, label: 'Device unlock' }] : []), { v: 'pin', label: 'PIN' }]}
            onChange={(v) => void setLockMethod(v)}
          />
          {settings.lock.method !== 'none' ? (
            <Choice
              label="Lock after"
              value={settings.lock.autoLockMinutes}
              options={[
                { v: 1, label: '1 min' },
                { v: 5, label: '5 min' },
                { v: 15, label: '15 min' },
              ]}
              onChange={(v) => void setSetting('lock', { ...settings.lock, autoLockMinutes: v })}
            />
          ) : null}
        </Group>

        <Group title="Storage">
          <div className="set-row">
            <span className="set-text">
              <span className="set-label">On this device</span>
              <span className="set-hint">
                {status.storage.quota ? `${formatBytes(status.storage.usage)} used, ${formatBytes(status.storage.free)} free.` : 'Not reported by this browser.'}{' '}
                {status.storage.persisted ? 'Protected from automatic clean-up.' : 'Chrome may clear it if the disk gets full.'}
              </span>
            </span>
          </div>
          <div className="set-row">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setWipe(true)}>
              Delete everything on this device
            </button>
          </div>
        </Group>

        <Group title="About">
          <dl className="about">
            <div>
              <dt>Version</dt>
              <dd>
                {__APP_VERSION__} ({__COMMIT__})
              </dd>
            </div>
            <div>
              <dt>Cloud model</dt>
              <dd>
                {status.runtime.cloudModel} {status.runtime.source === 'defaults' ? '(built-in default)' : '(from Remote Config)'}
              </dd>
            </div>
            <div>
              <dt>Transcription model</dt>
              <dd>{status.runtime.transcribeModel}</dd>
            </div>
            <div>
              <dt>App Check</dt>
              <dd>{status.appCheck === 'recaptcha-enterprise' ? 'reCAPTCHA Enterprise' : status.appCheck === 'debug-token' ? 'Debug token (development)' : 'Not configured'}</dd>
            </div>
            <div>
              <dt>Firebase project</dt>
              <dd>{firebaseConfig.projectId ?? 'Not configured'}</dd>
            </div>
          </dl>
        </Group>
      </div>

      <Sheet
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title="Choose a PIN"
        footer={
          <div className="sheet-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setPinOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pin.length < 4 || pin !== pin2}
              onClick={async () => {
                const h = await hashPin(pin);
                await setSetting('lock', { method: 'pin', ...h, autoLockMinutes: settings.lock.autoLockMinutes });
                setPinOpen(false);
                toast('App lock on');
              }}
            >
              Turn on lock
            </button>
          </div>
        }
      >
        <div className="pin-form">
          <label>
            <span>PIN (4 to 8 digits)</span>
            <input inputMode="numeric" autoComplete="new-password" type="password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-autofocus />
          </label>
          <label>
            <span>Type it again</span>
            <input inputMode="numeric" autoComplete="new-password" type="password" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
          </label>
          {pin2 && pin !== pin2 ? <p className="fine">The PINs don't match yet.</p> : null}
          <p className="fine">If you forget it, clear this site's data in Chrome to reset Offline. That also deletes your drafts.</p>
        </div>
      </Sheet>

      <Confirm
        open={wipe}
        title="Delete everything?"
        body={<p>All recordings, drafts, chats, notes and history on this device will be deleted. Settings are kept. This can't be undone.</p>}
        confirmLabel="Delete everything"
        onCancel={() => setWipe(false)}
        onConfirm={async () => {
          setWipe(false);
          await wipeEverything();
          toast('Everything deleted from this device');
        }}
      />
    </div>
  );
}

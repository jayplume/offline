/**
 * "What works right now": an honest, live list of what Offline can do on this device at this
 * moment, with the one action that fixes each missing piece.
 */
import { useState, type ReactNode } from 'react';
import { Check, Minus, Download, Loader } from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { refreshStatus, setStatus, useStatus } from '../lib/status';
import { downloadDeviceModel, toUserError } from '../lib/ai/engine';
import { installOnDeviceSpeech } from '../lib/speech';
import { setSetting, useSettings } from './settings';
import { formatBytes } from '../lib/text';
import { useToast } from './ui/Toast';

type Tone = 'yes' | 'no' | 'wait';

function Line({ tone, title, children, action }: { tone: Tone; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className={`cap cap-${tone}`}>
      <span className="cap-icon" aria-hidden>
        {tone === 'yes' ? <Check /> : tone === 'wait' ? <Loader /> : <Minus />}
      </span>
      <div className="cap-text">
        <div className="cap-title">{title}</div>
        <div className="cap-body">{children}</div>
        {action ? <div className="cap-action">{action}</div> : null}
      </div>
    </li>
  );
}

export function StatusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStatus();
  const { settings } = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState<'model' | 'speech' | 'persist' | null>(null);
  const reachable = s.online && !settings.workOffline;
  const canRecord = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const getModel = async () => {
    setBusy('model');
    setStatus({ deviceProgress: 0, device: 'downloading' });
    try {
      const result = await downloadDeviceModel((f) => setStatus({ deviceProgress: f }));
      setStatus({ device: result, deviceProgress: null });
      if (result === 'available') toast('On-device model ready');
    } catch (err) {
      setStatus({ deviceProgress: null });
      toast(toUserError(err).message);
      void refreshStatus();
    } finally {
      setBusy(null);
    }
  };

  const getSpeech = async () => {
    setBusy('speech');
    const ok = await installOnDeviceSpeech(settings.speechLang);
    await refreshStatus();
    setBusy(null);
    toast(ok ? 'On-device speech is installing' : "Chrome couldn't install on-device speech here");
  };

  const persist = async () => {
    setBusy('persist');
    const granted = (await navigator.storage?.persist?.()) ?? false;
    await refreshStatus();
    setBusy(null);
    toast(granted ? 'Chrome will keep your drafts even when space is tight' : 'Chrome decides this on its own; installing the app usually helps');
  };

  const model = s.device;
  const pct = s.deviceProgress !== null ? Math.round(s.deviceProgress * 100) : null;

  return (
    <Sheet open={open} onClose={onClose} title="What works right now">
      <ul className="caps">
        <Line tone={canRecord && s.mic !== 'denied' ? 'yes' : 'no'} title="Recording">
          {!canRecord
            ? "This browser can't record audio. Try Chrome or Edge."
            : s.mic === 'denied'
              ? 'The microphone is blocked for this site. Allow it from the icon in the address bar, then reload.'
              : 'Works anywhere, with or without a connection. Saved on this device as you speak.'}
        </Line>

        <Line
          tone={reachable ? 'yes' : 'no'}
          title="Internet"
          action={
            settings.workOffline ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void setSetting('workOffline', false)}>
                Turn off Work offline
              </button>
            ) : undefined
          }
        >
          {settings.workOffline ? 'Work offline is on, so Offline uses no network at all.' : s.online ? 'Connected.' : 'No connection. Everything you capture is still saved here.'}
        </Line>

        <Line
          tone={model === 'available' ? 'yes' : model === 'downloading' ? 'wait' : 'no'}
          title="On-device AI (Gemini Nano in Chrome)"
          action={
            model === 'downloadable' ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={getModel} disabled={busy !== null || !reachable}>
                <Download aria-hidden />
                Download model
              </button>
            ) : undefined
          }
        >
          {model === 'available' && 'Ready. Prompts can run privately on this device, even offline.'}
          {model === 'downloading' && (
            <>
              Downloading{pct !== null ? ` (${pct}%)` : ''}. Until it finishes, AI uses the cloud when you allow it.
              {pct !== null ? (
                <span className="progress" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </span>
              ) : null}
            </>
          )}
          {model === 'downloadable' && `Chrome can download it once (a few GB, needs ${reachable ? 'about 22 GB free disk' : 'a connection'}). After that it works offline.`}
          {model === 'unavailable' && (
            <>
              This device doesn't meet Chrome's requirements for the built-in model (16 GB of RAM, or a GPU with more than 4 GB). Chrome shows the details at{' '}
              <code className="flag">chrome://on-device-internals</code>.
            </>
          )}
          {model === 'unsupported' && (
            <>
              This browser has no built-in model turned on. In desktop Chrome 139 or later, open <code className="flag">chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, set it to
              Enabled (and “Gemma 4 for built-in AI” too, if listed), then restart Chrome. Elsewhere, AI runs in the cloud when you allow it.
            </>
          )}
        </Line>

        <Line
          tone={s.speech === 'available' ? 'yes' : s.speech === 'downloading' ? 'wait' : 'no'}
          title="Live captions on this device"
          action={
            s.speech === 'downloadable' ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={getSpeech} disabled={busy !== null || !reachable}>
                <Download aria-hidden />
                Install speech pack
              </button>
            ) : undefined
          }
        >
          {s.speech === 'available' && 'Your words appear as you speak, without sending audio anywhere.'}
          {s.speech === 'downloading' && 'Chrome is installing the speech pack.'}
          {s.speech === 'downloadable' && 'Chrome can install a small speech pack so captions work offline.'}
          {(s.speech === 'unavailable' || s.speech === 'unsupported') &&
            "Not available in this browser. Recordings are still saved; transcribe them with the cloud when you're ready, or type them out."}
        </Line>

        <Line tone={s.configured && reachable ? 'yes' : 'no'} title="Cloud AI (Gemini through Firebase AI Logic)">
          {!s.configured && 'Not set up in this build.'}
          {s.configured && settings.workOffline && 'Off while Work offline is on.'}
          {s.configured && !settings.workOffline && !s.online && 'Needs a connection. Drafts wait here until you send them.'}
          {s.configured && reachable && (
            <>
              Ready. Uses {s.runtime.cloudModel}
              {s.runtime.source !== 'defaults' ? ' (set by Remote Config)' : ''}, only when you send. Protected by App Check
              {s.appCheck === 'debug-token' ? ' (debug token)' : s.appCheck === 'recaptcha-enterprise' ? ' (reCAPTCHA Enterprise)' : ''}.
            </>
          )}
        </Line>

        <Line
          tone={s.storage.low ? 'no' : 'yes'}
          title="Storage on this device"
          action={
            s.storage.persisted === false ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={persist} disabled={busy !== null}>
                Keep my drafts safe
              </button>
            ) : undefined
          }
        >
          {s.storage.quota
            ? `${formatBytes(s.storage.usage)} used, about ${formatBytes(s.storage.free)} free.${s.storage.low ? ' Space is low: delete old recordings soon.' : ''}`
            : 'Storage size is not reported by this browser.'}
          {s.storage.persisted ? ' Chrome will not clear it to save space.' : ''}
        </Line>
      </ul>
    </Sheet>
  );
}

/** History: every AI request, where it was meant to run, where it actually ran, and how long it took. */
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SurfaceBar } from '../ui/Surface';
import { Confirm } from '../ui/Sheet';
import { SourceBadge } from '../ui/Badge';
import { db, type Run } from '../../lib/db';
import { clockTime } from '../../lib/text';

const TASK: Record<Run['kind'], string> = {
  transcribe: 'Transcribed a recording',
  clarify: 'Made a prompt clearer',
  questions: 'Checked for missing details',
  run: 'Ran a prompt',
  chat: 'Answered in a chat',
  summarize: 'Summarized a note',
};

const MODE: Record<Run['requestedMode'], string> = {
  prefer_on_device: 'Prefer on-device',
  only_on_device: 'On-device only',
  only_in_cloud: 'Cloud only',
  prefer_in_cloud: 'Prefer cloud',
};

export function HistorySurface() {
  const runs = useLiveQuery(() => db.runs.orderBy('at').reverse().limit(300).toArray(), []);
  const [askClear, setAskClear] = useState(false);
  const total = runs?.length ?? 0;
  const device = runs?.filter((r) => r.ok && r.source === 'device').length ?? 0;
  const cloud = runs?.filter((r) => r.ok && r.source === 'cloud').length ?? 0;

  return (
    <div className="tool tool-history">
      <SurfaceBar
        title="History"
        sub={<span className="bar-status">Stored only on this device</span>}
        menu={[{ key: 'clear', label: 'Clear history', icon: <Trash2 />, disabled: !total, onSelect: () => setAskClear(true) }]}
      />
      <div className="tool-scroll">
        {total ? (
          <p className="history-summary">
            {device} on this device, {cloud} in the cloud{total - device - cloud ? `, ${total - device - cloud} failed` : ''}.
          </p>
        ) : null}
        {!total ? (
          <p className="empty-tool">Nothing has been sent to AI yet. Each request you make will be listed here with where it ran.</p>
        ) : (
          <ol className="runs">
            {runs!.map((r) => (
              <li key={r.id} className={`run${r.ok ? '' : ' is-failed'}`}>
                <div className="run-top">
                  <span className="run-task">{TASK[r.kind]}</span>
                  {r.ok && r.source ? <SourceBadge source={r.source} model={r.model ?? undefined} fellBack={Boolean(r.note?.startsWith('Device failed'))} /> : <span className="badge badge-failed">Failed</span>}
                </div>
                <div className="run-meta">
                  <span>{clockTime(r.at)}</span>
                  <span>{MODE[r.requestedMode]}</span>
                  {r.model ? <span>{r.model}</span> : null}
                  {r.ms ? <span className="tabular">{(r.ms / 1000).toFixed(1)} s</span> : null}
                  {r.kind !== 'transcribe' && r.inputChars ? <span className="tabular">{r.inputChars.toLocaleString()} characters</span> : null}
                </div>
                {r.note ? <p className="run-note">{r.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <Confirm
        open={askClear}
        title="Clear history?"
        body={<p>This removes the log of AI requests from this device. Your drafts, chats and notes stay.</p>}
        confirmLabel="Clear history"
        onCancel={() => setAskClear(false)}
        onConfirm={async () => {
          setAskClear(false);
          await db.runs.clear();
        }}
      />
    </div>
  );
}

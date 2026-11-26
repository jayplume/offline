/** Where an AI step ran (or will run): on this device, or in the cloud. */
import { Cloud, Smartphone, Lock } from 'lucide-react';
import type { Destination } from '../../lib/ai/route';

export function SourceBadge({ source, model, fellBack }: { source: Destination; model?: string; fellBack?: boolean }) {
  return (
    <span className={`badge badge-${source}`} title={model ? `${source === 'device' ? 'On this device' : 'Cloud'}: ${model}` : undefined}>
      {source === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden />}
      {source === 'device' ? 'On this device' : fellBack ? 'Cloud (device failed)' : 'Cloud'}
    </span>
  );
}

export function LocalOnlyBadge() {
  return (
    <span className="badge badge-local">
      <Lock aria-hidden />
      Device only
    </span>
  );
}

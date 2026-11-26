import { useMemo } from 'react';
import { decideRoute, type RouteDecision, type TaskKind } from '../lib/ai/route';
import { useStatus } from '../lib/status';
import { useSettings } from './settings';

/** The routing decision for a task, recomputed live as connectivity and settings change. */
export function useRoute(task: TaskKind, localOnly: boolean, inputChars: number): RouteDecision {
  const s = useStatus();
  const { settings } = useSettings();
  return useMemo(
    () =>
      decideRoute({
        task,
        online: s.online,
        workOffline: settings.workOffline,
        device: s.device,
        preference: settings.preference,
        localOnly,
        inputChars,
        deviceCharBudget: s.runtime.deviceCharBudget,
        cloudConfigured: s.configured,
      }),
    [task, s.online, settings.workOffline, s.device, settings.preference, localOnly, inputChars, s.runtime.deviceCharBudget, s.configured],
  );
}

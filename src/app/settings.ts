import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS, writeSetting, type Settings } from '../lib/db';

/** Settings from IndexedDB merged over defaults. `ready` is false until the first read. */
export function useSettings(): { settings: Settings; ready: boolean } {
  const rows = useLiveQuery(() => db.settings.toArray(), []);
  return useMemo(() => {
    const s = { ...DEFAULT_SETTINGS } as Settings;
    for (const r of rows ?? []) (s as unknown as Record<string, unknown>)[r.key] = r.value;
    return { settings: s, ready: rows !== undefined };
  }, [rows]);
}

export const setSetting = writeSetting;

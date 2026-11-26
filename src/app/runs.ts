/**
 * A confirmed AI request handed from the place it was confirmed (the send preview) to the chat
 * that runs it. Kept in memory only: a reload never re-sends anything by itself.
 */
import type { Route } from '../lib/ai/route';

export interface PendingRun {
  chatId: string;
  route: Route;
  draftId?: string;
}

const pending = new Map<string, PendingRun>();

export function queueRun(run: PendingRun): void {
  pending.set(run.chatId, run);
}

export function takeRun(chatId: string): PendingRun | undefined {
  const run = pending.get(chatId);
  pending.delete(chatId);
  return run;
}

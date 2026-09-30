/**
 * Module-level "a bulk publish is still running" flag.
 *
 * The runner outlives the modal (closing mid-run lets the current site
 * finish), and the Sites table can remount while it runs, so this lives
 * outside React state. Components read it with `useBulkPublishBusy`.
 */

import { useSyncExternalStore } from "react";

let busy = false;
const listeners = new Set<() => void>();

export function isBulkPublishBusy(): boolean {
  return busy;
}

export function setBulkPublishBusy(next: boolean): void {
  if (busy === next) return;
  busy = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function useBulkPublishBusy(): boolean {
  return useSyncExternalStore(subscribe, isBulkPublishBusy, () => false);
}

export const BULK_PUBLISH_BUSY_MESSAGE = "A bulk publish is still finishing…";

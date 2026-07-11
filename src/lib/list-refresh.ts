// Coalesced list refresh (perceived-speed polish). Many row-level mutations —
// completing task after task in a triage session, adding several tasks — used to
// each fire their own router.refresh(), queuing a full server refetch per click.
// This debounces them into ONE refresh after the burst settles: the UI updates
// locally/optimistically in the meantime, and the server round-trip happens
// once, on idle.
//
// Module-level (not per-component) so a burst spread across many row components
// shares a single pending refresh. There is one router per app, so the latest
// bound refresh callback is the right one to run.
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

let timer: ReturnType<typeof setTimeout> | null = null;
let latestRefresh: (() => void) | null = null;
const flushSubs = new Set<() => void>();

function runFlush() {
  timer = null;
  const refresh = latestRefresh;
  latestRefresh = null;
  refresh?.();
  // The refresh re-renders the server tree with the real rows. Give it a beat to
  // commit, then let optimistic hosts (InlineAddTask) drop their provisional
  // rows — a touch late (a brief, muted overlap) rather than early (a gap where
  // neither the provisional nor the real row shows).
  const subs = [...flushSubs];
  setTimeout(() => subs.forEach((fn) => fn()), 400);
}

// Schedule a debounced refresh. Each call resets the timer, so a rapid burst
// collapses to a single refresh once it stops.
export function scheduleListRefresh(refresh: () => void, delayMs = 500): void {
  latestRefresh = refresh;
  if (timer) clearTimeout(timer);
  timer = setTimeout(runFlush, delayMs);
}

// Hook form: binds the current router and returns a stable callback that
// schedules the coalesced refresh.
export function useListRefresh(delayMs = 500): () => void {
  const router = useRouter();
  return useCallback(
    () => scheduleListRefresh(() => router.refresh(), delayMs),
    [router, delayMs]
  );
}

// Subscribe to "a coalesced refresh just flushed" (fires shortly after the
// refresh dispatches). Optimistic hosts use it to clear provisional rows once
// the real ones are in the server tree. Returns an unsubscribe.
export function onListRefreshFlush(cb: () => void): () => void {
  flushSubs.add(cb);
  return () => {
    flushSubs.delete(cb);
  };
}

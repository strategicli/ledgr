// Per-item UI preference for the Linked here panel: whether completed (done)
// rows are shown. Done rows are hidden by default everywhere (a related list
// should read as live work — same stance as the dashboard tree widget's
// hideCompletedChildren), with a per-item toggle to reveal them.
//
// Persistence is per host item, not global: flipping "show completed" on one
// item that you habitually review completed-and-all sticks for that item, while
// every other panel stays clean by default (Brandon, 2026-06-28). localStorage,
// not a server setting — it's a tiny view preference, single user, and wants to
// be instant.
//
// Exposed as a useSyncExternalStore hook (mirrors save-status.ts): the server
// snapshot is the default (off), so SSR and the first client paint agree and
// there's no hydration mismatch; the persisted value takes over after mount.
import { useSyncExternalStore } from "react";

const KEY = "ledgr.related.show-completed.v1";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function read(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? (obj as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota or privacy mode: a lost view preference is harmless */
  }
}

export function setShowCompleted(hostId: string, value: boolean): void {
  const map = read();
  // Default is off, so only persist the exceptions (on); drop the key when
  // turned back off to keep the map from accreting every visited item.
  if (value) map[hostId] = true;
  else delete map[hostId];
  write(map);
  emit();
}

export function useShowCompleted(hostId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => read()[hostId] === true,
    () => false
  );
}

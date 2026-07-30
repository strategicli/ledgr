// The item canvas word count. Server-rendered from the stored body (so it's
// right the moment the page loads), then kept current by the body editor
// publishing its markdown as you type. Same module-singleton +
// useSyncExternalStore shape as save-status.ts, and for the same reason: the
// chrome that shows the count is server-rendered while the editor that knows the
// live text is a client island, with no common provider above them.
//
// Client-only (the hook): the counting function itself lives in body.ts so server
// components can render the at-load count without pulling React state in here.
import { useSyncExternalStore } from "react";
import { wordCountOf } from "@/lib/body";

// Trailing recount delay. The editor publishes on every keystroke; scanning a
// sermon-length body per character would be wasted work, and the count doesn't
// need to be instantaneous (Brandon, 2026-07-30).
const RECOUNT_MS = 800;

// Scoped by item id: a canvas modal open over an item page mounts a second
// chrome, and neither should show the other item's count.
let current: { itemId: string; count: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function publishBodyMarkdown(itemId: string, markdown: string) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    current = { itemId, count: wordCountOf(markdown) };
    for (const l of listeners) l();
  }, RECOUNT_MS);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// The snapshot is the published object (stable between publishes), not a derived
// value, so useSyncExternalStore stays happy.
function getSnapshot() {
  return current;
}

// The published count for an item, or null if nothing has been published for it
// yet (so the server-rendered count still stands). The hook reads the store
// directly; this is the same read for non-React callers and the verify script.
export function peekWordCount(itemId: string): number | null {
  return current && current.itemId === itemId ? current.count : null;
}

// `initial` is the server-rendered count; it stands until this item's editor has
// published something newer.
export function useWordCount(itemId: string, initial: number): number {
  const live = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return live && live.itemId === itemId ? live.count : initial;
}

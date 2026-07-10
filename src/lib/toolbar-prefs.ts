// Per-item UI preference for the body editor's formatting toolbar: whether the
// bar is expanded (open) or collapsed. The collapse toggle lives in the body's
// mode-row (BodyEditor); this remembers its last state so reopening an item
// restores how the owner left it.
//
// Persistence is per host item, not global (mirrors related-prefs.ts): a task
// you habitually keep collapsed stays collapsed for that item, while a note you
// keep open stays open, and every other item keeps its own default. localStorage,
// not a server setting — a tiny view preference, single user, wants to be instant.
//
// The DEFAULT differs by surface (notes open, task/compact bodies collapsed), so
// unlike related-prefs (default always off, store only the "on" exceptions) this
// stores the explicit boolean for any item the owner has toggled. Exposed as a
// useSyncExternalStore hook: the server/first-paint snapshot is the passed-in
// default, so SSR and the first client paint agree; the persisted value (if any)
// takes over after mount.
import { useSyncExternalStore } from "react";

const KEY = "ledgr.editor.toolbar-open.v1";
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

export function setToolbarOpenPref(itemId: string, value: boolean): void {
  const map = read();
  map[itemId] = value;
  write(map);
  emit();
}

// The stored open/closed state for this item, or `fallback` (the surface's
// default) when the owner has never toggled it. `fallback` also seeds the
// server/first-paint snapshot so there's no hydration flash.
export function useToolbarOpenPref(itemId: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const v = read()[itemId];
      return typeof v === "boolean" ? v : fallback;
    },
    () => fallback
  );
}

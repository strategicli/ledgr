// A tiny app-wide save-status signal (Brandon feedback, 2026-06-17). The item
// canvas autosaves from many independent surfaces — the title, the body editor,
// each field strip, each custom property, each relation field — and with the
// field-level grid (ADR-069) those surfaces are scattered across the layout, so
// a per-component "Saved" badge is easy to lose track of. This module is the one
// place they all report into, so a single floating SaveStatusIndicator can always
// show the current state.
//
// A module-level singleton (not React context) on purpose: it has to span both
// the classic stacked canvas (where the panels are server-rendered straight into
// the page) and the grid (where they're nodes inside the client grid), with no
// common client provider above them. Components import beginSave/endSave; the
// indicator subscribes via useSaveStatus.
import { useSyncExternalStore } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

let inFlight = 0;
let state: SaveState = "idle";
let savedTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
// Editors register a flush here so the indicator's "Retry" can force an
// immediate re-save after a failure, instead of the user waiting on the
// debounce timer (or having to type again).
const retryListeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Call around every autosave request. endSave(false) latches an error until the
// next successful save clears it; a quiet period after the last save fades the
// "Saved" pill back to idle.
export function beginSave() {
  inFlight += 1;
  if (state !== "saving") {
    state = "saving";
    emit();
  }
}

export function endSave(ok: boolean) {
  inFlight = Math.max(0, inFlight - 1);
  if (!ok) {
    state = "error";
    emit();
    return;
  }
  if (inFlight === 0 && state !== "error") {
    state = "saved";
    emit();
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      if (inFlight === 0 && state === "saved") {
        state = "idle";
        emit();
      }
    }, 1600);
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// An editor registers its flush; the returned fn unregisters on unmount.
export function registerSaveRetry(fn: () => void): () => void {
  retryListeners.add(fn);
  return () => {
    retryListeners.delete(fn);
  };
}

// Fire every registered flush (the "Retry" affordance). Each editor flushes
// only its own pending patch, so this is safe with several editors mounted.
export function requestSaveRetry() {
  for (const fn of retryListeners) fn();
}

function getSnapshot() {
  return state;
}

export function useSaveStatus(): SaveState {
  return useSyncExternalStore(subscribe, getSnapshot, () => "idle");
}

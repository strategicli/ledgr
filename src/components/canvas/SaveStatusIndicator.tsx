// The one always-visible autosave indicator for the item canvas (Brandon
// feedback, 2026-06-17). A fixed-position pill in the corner, so it stays put no
// matter where the title / body / a field card sits in the arranged layout
// (ADR-069). Subscribes to the app-wide save-status signal; renders nothing while
// idle, so it's invisible until something is actually saving or has just saved.
"use client";

import { requestSaveRetry, useSaveStatus } from "@/lib/save-status";

export default function SaveStatusIndicator() {
  const state = useSaveStatus();
  if (state === "idle") return null;
  // A failed save latches here; make it a button so the user can force an
  // immediate retry instead of waiting on the debounce (or typing again).
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={() => requestSaveRetry()}
        aria-label="Save failed. Retry now."
        className="fixed bottom-4 right-4 z-[60] rounded-full border border-red-500 bg-red-950/90 px-3 py-1 text-xs text-red-200 shadow-lg backdrop-blur transition-colors hover:bg-red-900"
      >
        Save failed · Retry
      </button>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] rounded-full border border-neutral-700 bg-neutral-900/90 px-3 py-1 text-xs text-neutral-300 shadow-lg backdrop-blur transition-opacity"
    >
      {state === "saving" ? "Saving…" : "Saved"}
    </div>
  );
}

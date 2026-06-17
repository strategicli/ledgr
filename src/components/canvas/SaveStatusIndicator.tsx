// The one always-visible autosave indicator for the item canvas (Brandon
// feedback, 2026-06-17). A fixed-position pill in the corner, so it stays put no
// matter where the title / body / a field card sits in the arranged layout
// (ADR-069). Subscribes to the app-wide save-status signal; renders nothing while
// idle, so it's invisible until something is actually saving or has just saved.
"use client";

import { useSaveStatus } from "@/lib/save-status";

export default function SaveStatusIndicator() {
  const state = useSaveStatus();
  if (state === "idle") return null;
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-4 right-4 z-[60] rounded-full border px-3 py-1 text-xs shadow-lg backdrop-blur transition-opacity ${
        state === "error"
          ? "border-red-500 bg-red-950/80 text-red-200"
          : "border-neutral-700 bg-neutral-900/90 text-neutral-300"
      }`}
    >
      {label}
    </div>
  );
}

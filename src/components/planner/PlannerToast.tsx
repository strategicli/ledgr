// A single lightweight toast for the Planner (no dependency, Principle 5). The
// planner shell owns one `toast` state and calls `notify(text, undo?)`; this
// renders it fixed at the bottom with an optional Undo button and auto-dismisses
// after a few seconds. Used by complete-in-place (undo a completion) and by drag
// drops (undo a re-plan) — the undo payload is captured at action time, so it
// survives the router.refresh() that removes a completed/moved task from the
// active-filtered list.
"use client";

import { useEffect } from "react";

export type PlannerToastMsg = {
  // A monotonic id so a new action replaces the previous toast and restarts the
  // dismiss timer even when the text is identical.
  id: number;
  text: string;
  undo?: () => void;
};

const DISMISS_MS = 6000;

export default function PlannerToast({
  toast,
  onDismiss,
}: {
  toast: PlannerToastMsg | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 shadow-xl shadow-black/50">
        <span className="truncate">{toast.text}</span>
        {toast.undo && (
          <button
            onClick={() => {
              toast.undo?.();
              onDismiss();
            }}
            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[color:var(--accent)] hover:bg-neutral-800"
          >
            Undo
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded px-1 text-neutral-500 hover:text-neutral-300"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

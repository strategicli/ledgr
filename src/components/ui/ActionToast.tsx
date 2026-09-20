// A single global toast, mounted once in the root layout (ui-refresh S4). Row
// actions (and swipe actions, S5) fire a `showToast(text, undo?)` which dispatches
// a window event; this component — living OUTSIDE any list subtree — catches it
// and renders, so it survives the router.refresh() that removes the acted-on row
// (the same "parent owns the toast" trick PlannerToast uses, generalized). No
// dependency (Principle 5). The undo closure is carried on the event detail; both
// ends share one JS context, so passing a function is fine.
"use client";

import { useEffect, useState } from "react";

export type ToastPayload = {
  text: string;
  undo?: () => void;
  // An optional follow-up link ("Open the copy" after Duplicate): a hard nav so
  // it escapes any intercept modal, like the ⋯ menu's own links.
  link?: { label: string; href: string };
  // How long the toast stays up; defaults to DISMISS_MS. The ✕ closes it sooner.
  durationMs?: number;
};

const EVENT = "ledgr:toast";
const DISMISS_MS = 6000;

// Fire a toast from anywhere on the client. `undo` runs when the user taps Undo.
export function showToast(
  text: string,
  undo?: () => void,
  opts: Pick<ToastPayload, "link" | "durationMs"> = {}
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastPayload>(EVENT, { detail: { text, undo, ...opts } })
  );
}

export default function ActionToast() {
  const [toast, setToast] = useState<(ToastPayload & { id: number }) | null>(null);

  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastPayload>).detail;
      setToast({ ...detail, id: ++n });
    };
    window.addEventListener(EVENT, onToast as EventListener);
    return () => window.removeEventListener(EVENT, onToast as EventListener);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.durationMs ?? DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-card border border-line-strong bg-surface-3 px-3 py-2 text-xs text-ink shadow-xl shadow-black/50">
        <span className="truncate">{toast.text}</span>
        {toast.undo && (
          <button
            onClick={() => {
              toast.undo?.();
              setToast(null);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[color:var(--accent)] hover:bg-surface-2"
          >
            Undo
          </button>
        )}
        {toast.link && (
          <a
            href={toast.link.href}
            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[color:var(--accent)] hover:bg-surface-2"
          >
            {toast.link.label}
          </a>
        )}
        <button
          onClick={() => setToast(null)}
          aria-label="Dismiss"
          className="shrink-0 rounded px-1 text-ink-subtle hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

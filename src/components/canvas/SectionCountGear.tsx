// The per-card "how many to show" gear (Tyler, 2026-07-01): a small gear that
// appears on card hover, beside the remove ×. It opens a tiny popover to set how
// many rows this collection card previews before the "Showing N of M →" link
// takes over. The choice persists to the widget instance's options.limit in the
// record's composition (PATCH), same mechanism as RemoveSection. Default is 5
// (see widgetLimit); this only changes the PREVIEW size — the backing items are
// untouched, and the full set is always one click away on the collection page.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WIDGET_LIMIT_MAX, type Composition } from "@/lib/composition";

const PRESETS = [3, 5, 10, 20, 50];

export default function SectionCountGear({
  itemId,
  composition,
  instanceId,
  current,
  label,
}: {
  itemId: string;
  composition: Composition;
  instanceId: string;
  current: number;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setLimit(value: number) {
    const clamped = Math.min(Math.max(Math.round(value), 1), WIDGET_LIMIT_MAX);
    if (busy || clamped === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const next: Composition = {
      ...composition,
      widgets: composition.widgets.map((w) =>
        w.instanceId === instanceId ? { ...w, options: { ...w.options, limit: clamped } } : w
      ),
    };
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label={`How many ${label} to show`}
        title={`How many to show (now ${current})`}
        className="rounded p-0.5 text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 group-hover/card:opacity-100 disabled:opacity-40 aria-expanded:opacity-100"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <>
          {/* click-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-32 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-lg"
          >
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500">Show on card</p>
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitemradio"
                aria-checked={n === current}
                onClick={() => void setLimit(n)}
                disabled={busy}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-neutral-800 ${
                  n === current ? "text-neutral-100" : "text-neutral-300"
                }`}
              >
                <span>{n}</span>
                {n === current && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

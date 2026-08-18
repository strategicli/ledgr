// Click-to-edit date on a task row (tasks-row-redesign, ADR-202). The row's
// date text is now a button: clicking it opens a small draft-commit DateInput
// (ADR-169 — never write on the picker's first change) that edits the field the
// row DISPLAYS — scheduled if set, else due (Tyler: "edit what's shown"). An
// undated row gets a ghost "＋ date" affordance on hover that sets scheduled.
// A repeating task shows the loop glyph beside the date — a read-only signal;
// the rule itself is edited on the canvas (and the engine keeps advancing the
// scheduled date on complete regardless of a manual nudge here).
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DateInput from "@/components/ui/DateInput";
import { showToast } from "@/components/ui/ActionToast";

function ymdToIso(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

function RepeatIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export default function TaskDateEdit({
  id,
  ymd,
  label,
  field,
  overdue,
  recurring,
}: {
  id: string;
  ymd: string | null; // the displayed date as YYYY-MM-DD, or null when undated
  label: string | null; // preformatted server-side ("Aug 18") so SSR and tabs agree
  field: "scheduledDate" | "dueDate"; // which column the click edits (what's shown)
  overdue: boolean;
  recurring: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function commit(next: string | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next ? ymdToIso(next) : null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      router.refresh();
    } catch {
      showToast("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span ref={wrap} className="relative inline-flex shrink-0 items-center gap-1">
      {recurring && (
        <span title="Repeats" className={overdue ? "text-red-400" : "text-neutral-500"}>
          <RepeatIcon />
        </span>
      )}
      <button
        type="button"
        title={ymd ? `Change ${field === "dueDate" ? "due" : "scheduled"} date` : "Set date"}
        onClick={(e) => {
          // The row link/gestures must not see this click.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`rounded px-1 text-xs hover:bg-neutral-800 ${
          ymd
            ? overdue
              ? "text-red-400"
              : "text-neutral-600 hover:text-neutral-300"
            : "text-neutral-600 opacity-0 hover:text-neutral-300 focus-visible:opacity-100 group-hover:opacity-100"
        }`}
      >
        {label ?? "＋ date"}
      </button>
      {open && (
        <span
          className="absolute right-0 top-full z-30 mt-1 flex items-center gap-1 rounded-card border border-line-strong bg-surface-3 p-1.5 shadow-xl shadow-black/40"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="px-0.5 text-xs text-ink-subtle">
            {field === "dueDate" ? "Due" : "Scheduled"}
          </span>
          <DateInput
            value={ymd}
            onCommit={(next) => void commit(next)}
            autoFocus
            ariaLabel={field === "dueDate" ? "Due date" : "Scheduled date"}
            className="rounded border border-line bg-surface-1 px-1 py-0.5 text-xs text-ink [color-scheme:dark]"
          />
          {ymd && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void commit(null)}
              className="rounded px-1.5 py-0.5 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              Clear
            </button>
          )}
        </span>
      )}
    </span>
  );
}

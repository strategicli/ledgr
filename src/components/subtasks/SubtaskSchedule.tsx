// A subtask's scheduled-date control (Tasks Polish S5, ADR-085). The user picks
// a date; if the parent has a scheduled date, Ledgr back-calculates a RELATIVE
// offset (N days from the parent) and stores it, so the subtask shifts whenever
// the parent moves or a recurring occurrence is materialized. With no parent
// date, the pick is just an absolute scheduled date.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { beginSave, endSave } from "@/lib/save-status";
import { describeOffset, offsetBetween } from "@/lib/relative-subtask";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC", // dates are UTC-midnight calendar days (ADR-008)
});

export default function SubtaskSchedule({
  id,
  scheduledIso,
  offsetDays,
  parentScheduledIso,
}: {
  id: string;
  scheduledIso: string | null;
  offsetDays: number | null;
  parentScheduledIso: string | null;
}) {
  const router = useRouter();
  const [sched, setSched] = useState(scheduledIso);
  const [offset, setOffset] = useState(offsetDays);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const parentYmd = parentScheduledIso ? parentScheduledIso.slice(0, 10) : null;

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    beginSave();
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
      return true;
    } catch {
      endSave(false);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(ymd: string) {
    // With a parent date, store the back-calculated offset (relative); without,
    // a plain absolute date (clear any stale offset).
    const newOffset = parentYmd ? offsetBetween(parentYmd, ymd) : null;
    const ok = await patch({
      scheduledDate: `${ymd}T00:00:00.000Z`,
      propertyPatch: { relativeSchedule: parentYmd ? { offsetDays: newOffset } : null },
    });
    if (ok) {
      setSched(`${ymd}T00:00:00.000Z`);
      setOffset(newOffset);
      setEditing(false);
    }
  }

  async function clear() {
    const ok = await patch({ scheduledDate: null, propertyPatch: { relativeSchedule: null } });
    if (ok) {
      setSched(null);
      setOffset(null);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <input
          type="date"
          autoFocus
          disabled={busy}
          defaultValue={sched ? sched.slice(0, 10) : ""}
          onChange={(e) => {
            if (e.target.value) void save(e.target.value);
          }}
          onBlur={() => setEditing(false)}
          aria-label="Subtask scheduled date"
          className="rounded border border-neutral-700 bg-neutral-900 px-1 text-xs text-neutral-200 [color-scheme:dark]"
        />
        {sched && (
          <button
            type="button"
            onClick={() => void clear()}
            aria-label="Clear scheduled date"
            className="text-neutral-500 hover:text-neutral-200"
          >
            ✕
          </button>
        )}
      </span>
    );
  }

  if (!sched) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={parentYmd ? "Schedule (relative to the parent's date)" : "Schedule"}
        // Hover-reveal on desktop, always visible on phones (no hover on touch).
        className="shrink-0 rounded px-1 text-xs text-neutral-600 opacity-0 transition-opacity hover:bg-neutral-800 hover:text-neutral-300 group-hover/row:opacity-100 max-sm:opacity-100"
      >
        ＋ when
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={offset != null ? `${describeOffset(offset)} from the parent's date` : "Scheduled"}
      className="shrink-0 rounded px-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
    >
      {fmt.format(new Date(sched))}
      {offset != null && (
        <span className="ml-1 text-[var(--accent)]">{describeOffset(offset)}</span>
      )}
    </button>
  );
}

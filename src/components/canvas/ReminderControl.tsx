// Per-task reminder picker (Tasks Polish S6, ADR-086). Sets how far before the
// task's day the published ICS feed (ADR-079) fires its alarm — written to
// properties.reminder.minutesBefore, which the feed already honors. Tasks are
// all-day events, so the lead time is measured from midnight of the day; the
// default (unset) is a 9 AM same-day nudge.
//
// Optimistic + propertyPatch (the FieldStrip/RecurrenceControl pattern), so it
// never clobbers the task's other properties.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { beginSave, endSave } from "@/lib/save-status";

// value "" = default (unset → the feed's 9 AM alarm); otherwise minutes before
// the all-day midnight start.
const OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "9 AM (default)" },
  { value: "0", label: "Midnight (start of day)" },
  { value: "1440", label: "1 day before" },
  { value: "2880", label: "2 days before" },
  { value: "10080", label: "1 week before" },
];

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";

export default function ReminderControl({
  itemId,
  initialMinutes,
}: {
  itemId: string;
  initialMinutes: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialMinutes == null ? "" : String(initialMinutes));
  const [error, setError] = useState(false);

  async function change(next: string) {
    const before = value;
    setValue(next);
    setError(false);
    beginSave();
    try {
      const reminder = next === "" ? null : { minutesBefore: Number(next) };
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyPatch: { reminder } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
    } catch {
      setValue(before);
      setError(true);
      endSave(false);
    }
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      <span
        className="cursor-help underline decoration-dotted decoration-neutral-600 underline-offset-2"
        title="When your subscribed calendar reminds you (via the ICS feed)"
      >
        Reminder
      </span>
      <select className={selectClass} value={value} onChange={(e) => void change(e.target.value)}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-red-400">Save failed</span>}
    </label>
  );
}

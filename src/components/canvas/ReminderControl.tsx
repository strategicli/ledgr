// Per-task reminder picker (Tasks Polish S6, ADR-086). Sets how far before the
// task's start the published ICS feed (ADR-079) fires its alarm — written to
// properties.reminder.minutesBefore, which the feed already honors. The offset
// is measured from the event start: midnight for an all-day task, or the timed
// block's start when one is set. The options + labels follow that mode (a
// "before" lead reads against the event time once a time exists), and the
// default (unset) is a 9 AM nudge for all-day, or "at the start" for a timed
// block. value "" = that default; "0" = at the start; N = N minutes before.
//
// Optimistic + propertyPatch (the FieldStrip/RecurrenceControl pattern), so it
// never clobbers the task's other properties.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { beginSave, endSave } from "@/lib/save-status";

// All-day tasks: lead times read off midnight (the default nudges at 9 AM).
const ALL_DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "9 AM (default)" },
  { value: "0", label: "At start of day" },
  { value: "1440", label: "1 day before" },
  { value: "2880", label: "2 days before" },
  { value: "10080", label: "1 week before" },
];

// Timed tasks: the default already fires at the block start, so the rest read as
// short leads against the event time.
const TIMED_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "At time of event (default)" },
  { value: "10", label: "10 min before" },
  { value: "30", label: "30 min before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
  { value: "10080", label: "1 week before" },
];

// Label for a stored value that isn't one of the presets above (e.g. a lead set
// while the task was timed, then switched to all-day), so the <select> always
// has a matching option to show.
function describeMinutes(minutes: number, hasTime: boolean): string {
  if (minutes <= 0) return hasTime ? "At time of event" : "At start of day";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d > 1 ? "s" : ""} before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h > 1 ? "s" : ""} before`;
  }
  return `${minutes} min before`;
}

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";

export default function ReminderControl({
  itemId,
  initialMinutes,
  hasTime = false,
}: {
  itemId: string;
  initialMinutes: number | null;
  // Whether the task has a scheduled time-of-day — picks the option set + labels.
  hasTime?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialMinutes == null ? "" : String(initialMinutes));
  const [error, setError] = useState(false);

  const base = hasTime ? TIMED_OPTIONS : ALL_DAY_OPTIONS;
  // Guarantee the current value is representable so the controlled select never
  // shows a mismatched option (value "" — the default — is always in `base`).
  const options = base.some((o) => o.value === value)
    ? base
    : [{ value, label: describeMinutes(Number(value), hasTime) }, ...base];

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
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-red-400">Save failed</span>}
    </label>
  );
}

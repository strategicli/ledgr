// A small "+ {label}" add control (Tyler, 2026-07-01) for a project's dated
// collections — Milestones (date only) and Meetings (date + time). Collapsed
// it's a plus button; expanded it's a compact box: a title, an icon-only date
// picker (a calendar glyph that opens the native picker — no mm/dd/yyyy field)
// and, for meetings, an icon-only time picker (a clock glyph), then Cancel / Add
// on their own row below. Enter in the title adds. Files a contained item via
// /api/records/[id]/contain (date → due_date for milestones, date+time →
// meeting_at for meetings, handled server-side).
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TimePicker from "@/components/canvas/widgets/TimePicker";

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const CalendarIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="5" width="16" height="15" rx="1.5" />
    <path d="M4 9h16M8 3v3M16 3v3" />
  </svg>
);

export default function InlineContainAdd({
  recordId,
  type,
  label,
  withTime = false,
}: {
  recordId: string;
  type: string;
  label: string;
  withTime?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle("");
    setDate("");
    setTime("");
    setOpen(false);
  }

  function openPicker(ref: React.RefObject<HTMLInputElement | null>) {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.focus();
  }

  async function add() {
    const t = title.trim();
    if (!t || busy) return;
    // A meeting combines date + time into one datetime; a milestone is date-only.
    const dateValue = date ? (withTime && time ? `${date}T${time}` : date) : undefined;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/contain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, title: t, date: dateValue }),
      });
      if (res.ok) {
        reset();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded px-1 py-1 text-sm text-neutral-500 hover:text-neutral-300"
      >
        <span className="text-base leading-none text-[var(--accent)]">+</span> {label}
      </button>
    );
  }

  const chip = "inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-sm hover:border-neutral-500";

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-2.5">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          } else if (e.key === "Escape") {
            reset();
          }
        }}
        placeholder={`${label} name`}
        aria-label={`${label} name`}
        disabled={busy}
        className="w-full bg-transparent text-sm font-medium text-neutral-100 outline-none placeholder:text-neutral-500"
      />

      {/* Date (+ time) as icon-triggered native pickers — no raw mm/dd/yyyy field. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => openPicker(dateRef)} className={`${chip} ${date ? "text-[var(--accent)]" : "text-neutral-400"}`}>
          {CalendarIcon}
          {date ? fmtDate(date) : "Date"}
        </button>
        <input
          ref={dateRef}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          className="sr-only"
          tabIndex={-1}
        />
        {withTime && <TimePicker value={time} onChange={setTime} />}
      </div>

      {/* Actions below, inside the box. */}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button type="button" onClick={reset} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700">
          Cancel
        </button>
        <button
          type="button"
          disabled={!title.trim() || busy}
          onClick={() => void add()}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

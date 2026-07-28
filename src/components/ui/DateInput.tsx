// A native date input that commits on confirm, not on the first change.
//
// Why (bug, 2026-07-28): the browser's own calendar popup updates the input's
// value while the user is still *navigating* it — scroll/step to another month
// and the field fires a change carrying a date nobody picked. Every surface that
// wrote on the first change therefore scheduled a wrong date the instant you
// left the current month, and the popup around it closed on the write, so the
// mis-pick wasn't even correctable in place. Draft here, commit on "Set" (or
// Enter) — the shape BulkActionBar's date field already used.
//
// Keep the draft. Don't "simplify" this back to onChange → save.
"use client";

import { useState } from "react";

export default function DateInput({
  value,
  onCommit,
  className,
  autoFocus = false,
  ariaLabel,
}: {
  value: string | null; // stored YYYY-MM-DD (or null)
  onCommit: (ymd: string) => void;
  className?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // Re-adopt the stored value when it changes under us (a sibling shortcut chip
  // set the date) — the adjust-during-render pattern SchedulePopover uses.
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value ?? "");
  }
  const dirty = draft !== "" && draft !== (value ?? "");

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        className={className}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) {
            e.preventDefault();
            onCommit(draft);
          }
        }}
      />
      {dirty && (
        <button
          type="button"
          title="Set this date"
          // preventDefault keeps focus on the input, so a surface that closes on
          // the input's blur (SubtaskSchedule) doesn't unmount before the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit(draft)}
          className="rounded border border-line-strong px-1.5 py-0.5 text-xs text-[var(--accent)] hover:bg-surface-2"
        >
          Set
        </button>
      )}
    </span>
  );
}

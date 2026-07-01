// An on-brand time picker (Tyler, 2026-07-01): a clock-icon chip that opens the
// app's standard Popover with (1) a direct text-entry field on top ("2:30pm",
// "14:30", "9am") and (2) a scrollable list of times in 5-minute increments.
// Matches the rest of the UI (Popover + dark menu) instead of the native
// browser time control. Value is 24h "HH:MM"; empty string = unset.
"use client";

import { useEffect, useRef, useState } from "react";
import Popover from "@/components/ui/Popover";

const pad = (n: number) => String(n).padStart(2, "0");

function fmt12(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h)) return hm;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

// Parse a typed time into "HH:MM" (24h), or null. Accepts "2:30pm", "2pm",
// "14:30", "9", "9:05 am".
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3];
    if (min > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "pm" && h !== 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    if (h > 23) return null;
    return `${pad(h)}:${pad(min)}`;
  }
  m = s.match(/^(\d{1,2})(am|pm)$/);
  if (m) {
    let h = Number(m[1]);
    const ap = m[2];
    if (h < 1 || h > 12) return null;
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${pad(h)}:00`;
  }
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const h = Number(m[1]);
    if (h > 23) return null;
    return `${pad(h)}:00`;
  }
  return null;
}

// Every 5 minutes across the day.
const OPTIONS: string[] = [];
for (let h = 0; h < 24; h += 1) for (let m = 0; m < 60; m += 5) OPTIONS.push(`${pad(h)}:${pad(m)}`);

function TimeList({ value, onPick }: { value: string; onPick: (hm: string) => void }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const selectedRef = useRef<HTMLLIElement>(null);

  // Open scrolled to the current selection (or noon-ish) so the list is useful.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const typed = parseTimeInput(text);

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (typed) onPick(typed);
          }
        }}
        placeholder="Enter time (e.g. 2:30pm)"
        aria-label="Enter time"
        className="w-full rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-500"
      />
      <ul ref={listRef} className="-mr-1 max-h-56 overflow-y-auto pr-1">
        {OPTIONS.map((hm) => {
          const active = hm === value;
          return (
            <li key={hm} ref={active ? selectedRef : undefined}>
              <button
                type="button"
                onClick={() => onPick(hm)}
                className={`flex w-full items-center rounded px-2 py-1 text-left text-sm ${
                  active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60"
                }`}
              >
                {fmt12(hm)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ClockIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export default function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hm: string) => void;
}) {
  return (
    <Popover
      ariaLabel="Time"
      align="left"
      width={200}
      triggerClassName={`inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-sm hover:border-neutral-500 ${
        value ? "text-[var(--accent)]" : "text-neutral-400"
      }`}
      trigger={
        <>
          {ClockIcon}
          {value ? fmt12(value) : "Time"}
        </>
      }
    >
      {(close) => (
        <TimeList
          value={value}
          onPick={(hm) => {
            onChange(hm);
            close();
          }}
        />
      )}
    </Popover>
  );
}

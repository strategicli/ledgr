// A calendar-day picker for the rail popovers (Schedule, Due): a native date
// input, the Today/Tomorrow/+1wk reschedule shortcuts, a Clear, and a free-text
// natural-language box ("next fri"). Presentational — it reports a picked
// YYYY-MM-DD (or null to clear) via onPick; the owning row does the PATCH. The
// same quick-entry affordances FieldStrip offers, factored for reuse here.
"use client";

import { addDaysYmd } from "@/lib/recurrence";
import { parseNaturalDate, parseNaturalWhen } from "@/lib/nl-date";

const inputClass =
  "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-500 [color-scheme:dark]";
const chipClass =
  "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200";

export default function DayField({
  valueYmd,
  today,
  onPick,
  parseTime = false,
  autoFocus = false,
}: {
  valueYmd: string | null; // YYYY-MM-DD or null
  today: string; // app-timezone YYYY-MM-DD
  // The picked day, plus an optional "HH:MM" time when `parseTime` is on and the
  // free-text box carried one ("5am today"). The owning row does the PATCH.
  onPick: (ymd: string | null, time?: string) => void;
  // Schedule uses this so the free-text box also reads a time-of-day; Due leaves
  // it off (a deadline has no clock time in this model).
  parseTime?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <input
        type="date"
        autoFocus={autoFocus}
        className={`${inputClass} w-full`}
        value={valueYmd ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
      />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chipClass} onClick={() => onPick(today)}>
          Today
        </button>
        <button type="button" className={chipClass} onClick={() => onPick(addDaysYmd(today, 1))}>
          Tomorrow
        </button>
        <button type="button" className={chipClass} onClick={() => onPick(addDaysYmd(today, 7))}>
          +1 wk
        </button>
        {valueYmd && (
          <button type="button" className={chipClass} onClick={() => onPick(null)}>
            Clear
          </button>
        )}
      </div>
      <input
        type="text"
        className={`${inputClass} w-full`}
        placeholder={parseTime ? "e.g. next fri 9am" : "e.g. next fri"}
        // Parse on Enter/blur; a phrase we don't understand is ignored (the box
        // clears), never guessed.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (!v) return;
          if (parseTime) {
            // parseNaturalWhen defaults the day to today whenever a time is
            // present, so a truthy ymd covers both "5am today" and bare "5am".
            const { ymd, time } = parseNaturalWhen(v, today);
            if (ymd) onPick(ymd, time ?? undefined);
          } else {
            const ymd = parseNaturalDate(v, today);
            if (ymd) onPick(ymd);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

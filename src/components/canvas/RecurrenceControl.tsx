// The repeat control on a task canvas (T1, ADR-073/076). Sets the task's
// recurrence rule — stored in properties.recurrence and read by the deterministic
// engine (src/lib/recurrence.ts). This is the engine's editor; reschedule
// shortcuts + natural-language dates layer on in T2.
//
// Writes are optimistic per the FieldStrip pattern: build the rule, PATCH a
// propertyPatch (so it can't clobber other properties), refresh. Enabling a
// repeat seeds scheduled_date from the chosen anchor; switching to "separate note
// each time" makes updateItem create the first occurrence (idempotent server
// side).
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { beginSave, endSave } from "@/lib/save-status";
import HoverTip from "@/components/ui/HoverTip";
import {
  describeRule,
  makeRecurrence,
  parseRecurrence,
  parseRRule,
  weekdayOf,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type AnchorMode,
  type ByDayOrdinal,
  type OccurrenceMode,
  type Weekday,
} from "@/lib/recurrence";

type Preset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
const WEEKDAY_SET: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

// How a Monthly rule repeats: the same calendar day (plain, clamped), an explicit
// day-of-month (BYMONTHDAY — skips short months, supports the last day), or an
// ordinal weekday (BYDAY like 3MO — "the third Monday").
type MonthlyMode = "day" | "dom" | "weekday";
const MONTHLY_ORDINALS: { value: number; label: string }[] = [
  { value: 1, label: "first" },
  { value: 2, label: "second" },
  { value: 3, label: "third" },
  { value: 4, label: "fourth" },
  { value: 5, label: "fifth" },
  { value: -1, label: "last" },
];
const WEEKDAY_FULL: Record<Weekday, string> = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday",
  FR: "Friday", SA: "Saturday", SU: "Sunday",
};
// 1 → "1st", 21 → "21st", -1 → "last day".
function dayOrdinalLabel(n: number): string {
  if (n === -1) return "last day";
  const s = n % 100;
  const suffix = s >= 11 && s <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
const DAY_OF_MONTH_OPTIONS: { value: number; label: string }[] = [
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: dayOrdinalLabel(i + 1) })),
  { value: -1, label: "last day" },
];

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";

function ymdToIso(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

function presetOf(rule: ReturnType<typeof parseRecurrence>): Preset {
  if (!rule) return "none";
  if (rule.rrule.includes("FREQ=DAILY")) return "daily";
  if (rule.rrule.includes("FREQ=MONTHLY")) return "monthly";
  if (rule.rrule.includes("FREQ=YEARLY")) return "yearly";
  if (rule.rrule.includes("FREQ=WEEKLY")) {
    // Mon-Fri only ⇒ "weekdays" preset; otherwise plain weekly.
    const m = rule.rrule.match(/BYDAY=([A-Z,]+)/);
    if (m && m[1] === "MO,TU,WE,TH,FR") return "weekdays";
    return "weekly";
  }
  return "none";
}

export default function RecurrenceControl({
  itemId,
  initial,
  scheduledDate,
  dueDate,
  today,
  bare = false,
}: {
  itemId: string;
  initial: ReturnType<typeof parseRecurrence>;
  scheduledDate: string | null; // ISO or null
  dueDate: string | null;
  today: string; // YYYY-MM-DD in the app timezone
  // Drop the wide centered-column padding for a narrow rail (task canvas).
  bare?: boolean;
}) {
  const router = useRouter();
  const [rule, setRule] = useState(initial);
  const [error, setError] = useState(false);

  const rruleParts = rule ? rule.rrule : "";
  const preset = presetOf(rule);
  const interval = Number(rruleParts.match(/INTERVAL=(\d+)/)?.[1] ?? "1");
  const byDay: Weekday[] =
    (rruleParts.match(/BYDAY=([A-Z,]+)/)?.[1].split(",") as Weekday[]) ?? [];
  const count = rruleParts.match(/COUNT=(\d+)/)?.[1];
  // UNTIL is stored compact (YYYYMMDD); re-hydrate to YYYY-MM-DD for makeRecurrence.
  const untilCompact = rruleParts.match(/UNTIL=(\d{8})/)?.[1];
  const until = untilCompact
    ? `${untilCompact.slice(0, 4)}-${untilCompact.slice(4, 6)}-${untilCompact.slice(6, 8)}`
    : null;

  // The first occurrence anchor: the planned day, else the deadline, else today.
  const dtstart = (scheduledDate ?? dueDate)?.slice(0, 10) || today;

  // Monthly picker state. Derive the mode + current selection from the stored
  // rule; fall back to the anchor day (its day-of-month / its nth weekday) so
  // switching modes starts from a sensible default rather than blank.
  const curParts = rule ? parseRRule(rule.rrule) : null;
  const monthlyOrdinalEntry = curParts?.byDayOrdinal?.[0] ?? null;
  const monthlyDomValue = curParts?.byMonthDay?.[0] ?? null;
  const dtDay = Number(dtstart.slice(8, 10));
  const dtWeekday = weekdayOf(dtstart);
  const dtOrdinal = Math.min(5, Math.ceil(dtDay / 7)); // dtstart's nth weekday (1–5)
  const monthlyMode: MonthlyMode = monthlyOrdinalEntry
    ? "weekday"
    : monthlyDomValue != null
      ? "dom"
      : "day";
  const effOrdinal = monthlyOrdinalEntry?.ordinal ?? dtOrdinal;
  const effOrdWeekday = monthlyOrdinalEntry?.weekday ?? dtWeekday;
  const effDom = monthlyDomValue ?? dtDay;

  async function persist(next: ReturnType<typeof parseRecurrence>) {
    const before = rule;
    setRule(next);
    setError(false);
    beginSave();
    try {
      const body: Record<string, unknown> = { propertyPatch: { recurrence: next } };
      // Enabling a repeat with no planned date yet: seed scheduled from dtstart.
      if (next && !scheduledDate) body.scheduledDate = ymdToIso(next.dtstart);
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
    } catch {
      setRule(before);
      setError(true);
      endSave(false);
    }
  }

  // Rebuild the rule from the current control state with one field changed.
  function rebuild(
    overrides: Partial<{
      preset: Preset;
      interval: number;
      byDay: Weekday[];
      byMonthDay: number[];
      byDayOrdinal: ByDayOrdinal[];
      count: number | null;
      until: string | null;
      anchorMode: AnchorMode;
      occurrenceMode: OccurrenceMode;
    }>
  ) {
    const p = overrides.preset ?? preset;
    if (p === "none") {
      void persist(null);
      return;
    }
    const freq =
      p === "daily"
        ? "daily"
        : p === "monthly"
          ? "monthly"
          : p === "yearly"
            ? "yearly"
            : "weekly";
    const days =
      p === "weekdays"
        ? WEEKDAY_SET
        : p === "weekly"
          ? overrides.byDay ?? (byDay.length ? byDay : [])
          : [];
    // Monthly positional rules (nth-weekday / day-of-month). When the monthly
    // picker sets one explicitly we take it (empty array ⇒ clear back to plain
    // monthly); otherwise carry the current values through unchanged so editing
    // interval/anchor doesn't silently drop them. Dropped when the preset leaves
    // monthly. The two are mutually exclusive in the picker.
    const cur = parseRRule(rruleParts);
    let monthlyExtras: { byDayOrdinal?: ByDayOrdinal[]; byMonthDay?: number[] } = {};
    if (freq === "monthly") {
      if (overrides.byMonthDay !== undefined || overrides.byDayOrdinal !== undefined) {
        const bmd = overrides.byMonthDay ?? [];
        const bdo = overrides.byDayOrdinal ?? [];
        monthlyExtras = {
          byMonthDay: bmd.length ? bmd : undefined,
          byDayOrdinal: bdo.length ? bdo : undefined,
        };
      } else {
        monthlyExtras = { byDayOrdinal: cur?.byDayOrdinal, byMonthDay: cur?.byMonthDay };
      }
    }
    const next = makeRecurrence({
      freq,
      interval: overrides.interval ?? interval,
      byDay: days,
      ...monthlyExtras,
      count: overrides.count !== undefined ? overrides.count ?? undefined : count ? Number(count) : undefined,
      until: overrides.until !== undefined ? overrides.until ?? undefined : until ?? undefined,
      dtstart,
      anchorMode: overrides.anchorMode ?? rule?.anchorMode ?? "fixed",
      occurrenceMode: overrides.occurrenceMode ?? rule?.occurrenceMode ?? "virtual",
      maintainDueOffset: rule?.maintainDueOffset,
    });
    void persist(next);
  }

  function toggleDay(d: Weekday) {
    const set = new Set(byDay);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    const ordered = WEEKDAYS.filter((w) => set.has(w));
    rebuild({ preset: "weekly", byDay: ordered });
  }

  return (
    <section className={bare ? "" : "mx-auto w-full max-w-3xl px-2 pb-2 pt-2 sm:px-8 md:px-12"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
        <label className="flex items-center gap-1.5">
          Repeat
          <select
            className={selectClass}
            value={preset}
            onChange={(e) => rebuild({ preset: e.target.value as Preset })}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday (Mon–Fri)</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>

        {preset !== "none" && preset !== "weekdays" && (
          <label className="flex items-center gap-1.5">
            every
            <input
              type="number"
              min={1}
              max={365}
              value={interval}
              onChange={(e) => rebuild({ interval: Math.max(1, Number(e.target.value) || 1) })}
              className={`${selectClass} w-14`}
            />
            {preset === "daily" ? "day(s)" : preset === "weekly" ? "week(s)" : preset === "monthly" ? "month(s)" : "year(s)"}
          </label>
        )}

        {preset === "weekly" && (
          <div className="flex items-center gap-1">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`h-6 w-7 rounded text-[11px] ${
                  byDay.includes(d)
                    ? "bg-[var(--accent)] text-black"
                    : "border border-neutral-800 text-neutral-400 hover:border-neutral-600"
                }`}
              >
                {WEEKDAY_LABELS[d].slice(0, 1)}
              </button>
            ))}
          </div>
        )}

        {preset === "monthly" && (
          <label className="flex items-center gap-1.5">
            on
            <select
              className={selectClass}
              aria-label="Monthly repeat pattern"
              value={monthlyMode}
              onChange={(e) => {
                const m = e.target.value as MonthlyMode;
                if (m === "day") rebuild({ preset: "monthly", byMonthDay: [], byDayOrdinal: [] });
                else if (m === "dom")
                  rebuild({ preset: "monthly", byMonthDay: [effDom], byDayOrdinal: [] });
                else
                  rebuild({
                    preset: "monthly",
                    byDayOrdinal: [{ ordinal: effOrdinal, weekday: effOrdWeekday }],
                    byMonthDay: [],
                  });
              }}
            >
              <option value="day">the {dayOrdinalLabel(dtDay)} (same as start)</option>
              <option value="dom">a day of the month</option>
              <option value="weekday">a day of the week</option>
            </select>

            {monthlyMode === "dom" && (
              <select
                className={selectClass}
                aria-label="Day of the month"
                value={effDom}
                onChange={(e) =>
                  rebuild({ preset: "monthly", byMonthDay: [Number(e.target.value)], byDayOrdinal: [] })
                }
              >
                {DAY_OF_MONTH_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            )}

            {monthlyMode === "weekday" && (
              <>
                <select
                  className={selectClass}
                  aria-label="Which week of the month"
                  value={effOrdinal}
                  onChange={(e) =>
                    rebuild({
                      preset: "monthly",
                      byDayOrdinal: [{ ordinal: Number(e.target.value), weekday: effOrdWeekday }],
                      byMonthDay: [],
                    })
                  }
                >
                  {MONTHLY_ORDINALS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  aria-label="Weekday"
                  value={effOrdWeekday}
                  onChange={(e) =>
                    rebuild({
                      preset: "monthly",
                      byDayOrdinal: [{ ordinal: effOrdinal, weekday: e.target.value as Weekday }],
                      byMonthDay: [],
                    })
                  }
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w} value={w}>{WEEKDAY_FULL[w]}</option>
                  ))}
                </select>
              </>
            )}
          </label>
        )}

        {preset !== "none" && (
          <>
            {/* These two used to be bare selects; the audit flagged them as the
                most opaque control on the canvas (one of them materializes a new
                item per occurrence). Visible labels + a HoverTip explain each. */}
            <span className="flex items-center gap-1.5 text-neutral-400">
              <HoverTip
                align="left"
                tip={
                  <>
                    <span className="font-medium text-neutral-100">
                      On schedule
                    </span>{" "}
                    keeps each repeat on the rule&rsquo;s calendar.{" "}
                    <span className="font-medium text-neutral-100">
                      After completion
                    </span>{" "}
                    counts the gap from the day you check it off, so the next one
                    moves with you.
                  </>
                }
              >
                Next date
              </HoverTip>
              <select
                className={selectClass}
                aria-label="When the next occurrence is scheduled"
                value={rule?.anchorMode ?? "fixed"}
                onChange={(e) => rebuild({ anchorMode: e.target.value as AnchorMode })}
              >
                <option value="fixed">On schedule</option>
                <option value="completion">After completion</option>
              </select>
            </span>
            <span className="flex items-center gap-1.5 text-neutral-400">
              <HoverTip
                align="left"
                tip={
                  <>
                    <span className="font-medium text-neutral-100">
                      One repeating task
                    </span>{" "}
                    moves a single task forward to its next date as you finish it.{" "}
                    <span className="font-medium text-neutral-100">
                      Separate note each time
                    </span>{" "}
                    creates a fresh item for each occurrence, so each can hold its
                    own notes and subtasks.
                  </>
                }
              >
                Stored as
              </HoverTip>
              <select
                className={selectClass}
                aria-label="How recurring occurrences are stored"
                value={rule?.occurrenceMode ?? "virtual"}
                onChange={(e) => rebuild({ occurrenceMode: e.target.value as OccurrenceMode })}
              >
                <option value="virtual">One repeating task</option>
                <option value="materialized">Separate note each time</option>
              </select>
            </span>
          </>
        )}

        {rule && (
          <span className="text-neutral-400">{describeRule(rule)}</span>
        )}
        {error && <span className="text-red-400">Save failed, change reverted</span>}
      </div>
    </section>
  );
}

// Relative subtask scheduling (Tasks Polish S5, ADR-085). A subtask can carry a
// RELATIVE schedule — N calendar days from its parent's scheduled date — instead
// of an absolute one. The offset is the source of truth; the subtask's
// `scheduled_date` column holds the DERIVED concrete date (so every existing
// scheduled query / sort / Today / ICS / overdue-roll keeps working unchanged).
// The user sets it by picking a date; Ledgr back-calculates the offset (= picked
// − parent's scheduled). It's recomputed when the parent's scheduled date changes
// and when a recurring occurrence is materialized (clone.ts).
//
// PURE + client-safe: calendar-day (YYYY-MM-DD, UTC) math only, the recurrence.ts
// convention (ADR-008). Stored under items.properties.relativeSchedule (jsonb, no
// column — light owner data, like properties.recurrence/focus).
import { addDaysYmd, isYmd, ymdToUtcDate } from "@/lib/recurrence";

export type RelativeSchedule = { offsetDays: number };

// Tolerant parse of properties.relativeSchedule (the views.ts/recurrence.ts
// discipline): a non-integer / missing offset reads as "no relative schedule".
export function parseRelativeSchedule(raw: unknown): RelativeSchedule | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).offsetDays;
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return { offsetDays: v };
}

// The offset stored on an item's properties, or null if it isn't relative.
export function relativeOffsetOf(
  properties: Record<string, unknown> | null | undefined
): number | null {
  return parseRelativeSchedule(properties?.relativeSchedule)?.offsetDays ?? null;
}

// Days from parent's scheduled day to the child's day (childYmd − parentYmd).
// Negative = the child is before the parent ("prep 2 days before").
export function offsetBetween(parentYmd: string, childYmd: string): number {
  if (!isYmd(parentYmd) || !isYmd(childYmd)) return 0;
  return Math.round(
    (ymdToUtcDate(childYmd).getTime() - ymdToUtcDate(parentYmd).getTime()) / 86_400_000
  );
}

// The concrete child day for a parent day + offset.
export function applyOffset(parentYmd: string, offsetDays: number): string {
  return addDaysYmd(parentYmd, offsetDays);
}

// A short human label for the offset chip ("same day", "+2d", "−1d").
export function describeOffset(offsetDays: number): string {
  if (offsetDays === 0) return "same day";
  return offsetDays > 0 ? `+${offsetDays}d` : `−${Math.abs(offsetDays)}d`;
}

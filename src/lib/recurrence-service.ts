// Recurrence completion + materialization (T1, ADR-076). The server half that
// turns the pure transitions in recurrence.ts into DB writes. Called by
// updateItem when a task is completed, so EVERY completion path — the canvas
// checkbox, the MCP update_item tool, the REST API — advances recurrence
// identically, with no caller needing to know the rules.
//
// Two modes (explorations/recurrence-model.md):
// - VIRTUAL (default): one series item + a completion log. Completing stamps the
//   date and advances scheduled_date to the next uncompleted occurrence; the item
//   stays open (the occurrence is done, the series is not) until the rule ends.
// - MATERIALIZED: each occurrence is its own item (a deep clone of the series
//   PROTOTYPE — fresh subtasks/body, carried relations) linked to the series by a
//   `occurrence` relation. Completing an occurrence advances the series and clones
//   the NEXT one (create-next-after-completion): exactly one live occurrence at a
//   time, completed ones persist as history, so materialized never stacks either.
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { cloneItemSubtree } from "@/lib/clone";
import { getItem, ItemError } from "@/lib/items";
import {
  addDaysYmd,
  addSkippedInstance,
  completeOccurrence,
  dateToYmdUtc,
  isOccurrence,
  nextUncompletedOnOrAfter,
  parseRecurrence,
  toggleCompleteInstance,
  ymdToUtcDate,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { appTimezoneSync, ymdInZone } from "@/lib/today";
import { defaultStatusKey } from "@/lib/status";
import { statusSchemaForType } from "@/lib/status-schema";
import { recomputeRelativeChildren } from "@/lib/relative-subtask-service";

// The relation role that links a materialized occurrence (source) to its series
// (target). A role, not parent_id, so the series' own canvas subtasks stay its
// only children and the occurrence is a first-class item (ADR-061: relations are
// the organizing principle).
export const OCCURRENCE_ROLE = "occurrence";

type ItemRow = Awaited<ReturnType<typeof getItem>>;

// Today as a calendar day in the owner's timezone (the day Brandon is actually
// in), matching how the rest of the app computes "today" (today.ts). tz defaults
// to the process-cached owner zone; pass an explicit tz when one is resolved.
export function appTodayYmd(now = new Date(), tz = appTimezoneSync()): string {
  const { y, m, d } = ymdInZone(now, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function recurrenceOf(item: ItemRow): RecurrenceRule | null {
  const props = item.properties as Record<string, unknown> | null;
  return parseRecurrence(props?.recurrence);
}

// The seriesId an item points at if it IS a materialized occurrence, else null.
export function occurrenceSeriesId(item: ItemRow): string | null {
  const props = item.properties as Record<string, unknown> | null;
  const occ = props?.occurrence as Record<string, unknown> | undefined;
  return typeof occ?.seriesId === "string" ? occ.seriesId : null;
}

// The occurrence date this item represents: its scheduled day, else its due day,
// else today (a recurring task should always have one of the first two).
function occurrenceDateOf(item: ItemRow, today: string): string {
  if (item.scheduledDate) return dateToYmdUtc(item.scheduledDate);
  if (item.dueDate) return dateToYmdUtc(item.dueDate);
  return today;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (ymdToUtcDate(b).getTime() - ymdToUtcDate(a).getTime()) / 86_400_000
  );
}

// Apply a completion's advance to a series row: write the new log, advance
// scheduled_date (+ shift due_date when maintainDueOffset is set), and set
// status — open while the series continues, done when the rule is exhausted.
async function advanceSeriesRow(
  ownerId: string,
  series: ItemRow,
  rule: RecurrenceRule,
  occurrenceDate: string,
  completedOn: string
) {
  const res = completeOccurrence(rule, occurrenceDate, completedOn);
  const props = {
    ...((series.properties as Record<string, unknown> | null) ?? {}),
    recurrence: res.rule,
  };

  let dueDate = series.dueDate;
  if (res.next && rule.maintainDueOffset && series.dueDate && series.scheduledDate) {
    const delta = daysBetween(dateToYmdUtc(series.scheduledDate), res.next);
    dueDate = ymdToUtcDate(addDaysYmd(dateToYmdUtc(series.dueDate), delta));
  }

  // Pick the type's default statuses (S2): a continuing series resets to its
  // "not started" status for the next occurrence; an ended series goes "done".
  const schema = await statusSchemaForType(series.type);
  const status = res.ended
    ? defaultStatusKey(schema, "done") ?? "done"
    : defaultStatusKey(schema, "not_started") ?? "open";

  const [updated] = await getDb()
    .update(items)
    .set({
      properties: props,
      scheduledDate: res.next ? ymdToUtcDate(res.next) : null,
      dueDate,
      // The series row stays active while occurrences remain; the occurrence is
      // what got completed, not the definition. When the rule ends, the series
      // itself is done.
      status,
      statusCategory: res.ended ? "done" : "not_started",
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, series.id), eq(items.ownerId, ownerId)))
    .returning();
  // Relative subtasks shift with the series' scheduled date (S5, ADR-085).
  await recomputeRelativeChildren(
    ownerId,
    series.id,
    updated.scheduledDate ? dateToYmdUtc(updated.scheduledDate) : null
  );
  return { updated, result: res };
}

// VIRTUAL completion: the series item is the task. Stamp + advance; keep it open
// (or done at series end). Returns the advanced series row.
export async function completeVirtualSeries(
  ownerId: string,
  series: ItemRow,
  now = new Date()
): Promise<ItemRow> {
  const rule = recurrenceOf(series);
  if (!rule) throw new ItemError("bad_request", "item is not recurring");
  const today = appTodayYmd(now);
  const occurrenceDate = occurrenceDateOf(series, today);
  const { updated } = await advanceSeriesRow(ownerId, series, rule, occurrenceDate, today);
  return updated as ItemRow;
}

// Is there a live (not-done, not-trashed) materialized occurrence for this
// series already? Guards create-next-after-completion against duplicates.
async function liveOccurrenceCount(ownerId: string, seriesId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: items.id })
    .from(relations)
    .innerJoin(items, eq(items.id, relations.sourceId))
    .where(
      and(
        eq(relations.targetId, seriesId),
        eq(relations.role, OCCURRENCE_ROLE),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        sql`${items.statusCategory} <> 'done'`
      )
    );
  return rows.length;
}

// Clone the series PROTOTYPE into a fresh occurrence item for `date`: fresh
// unchecked subtasks, fresh body, carried relations (recurrence-model.md), linked
// back to the series by an `occurrence` edge and stamped with the date. The
// shared cloneItemSubtree primitive does the deep copy + reset.
async function materializeOccurrence(
  ownerId: string,
  series: ItemRow,
  date: string,
  rule: RecurrenceRule
): Promise<string> {
  const { rootId } = await cloneItemSubtree(
    ownerId,
    series.id,
    {
      scheduledDate: ymdToUtcDate(date),
      // Carry the deadline offset onto the occurrence so a per-occurrence due
      // makes sense; default to the series' own due day.
      dueDate: series.dueDate,
      properties: { occurrence: { seriesId: series.id, date } },
      inbox: false,
    },
    { stripPropertyKeys: ["recurrence", "occurrence"] }
  );
  // Link occurrence -> series. Direct insert (not relateItems) keeps the role and
  // skips the live-check; the pair is freshly created and owner-verified.
  await getDb()
    .insert(relations)
    .values({ sourceId: rootId, targetId: series.id, role: OCCURRENCE_ROLE })
    .onConflictDoNothing();
  // Ignore the parsed rule beyond confirming it is set (clone strips it anyway).
  void rule;
  return rootId;
}

// Create the first live occurrence for a materialized series if none exists.
// Called when a task is switched to materialized recurrence (and idempotent, so
// calling it twice is a no-op). Returns the occurrence id, or null when one
// already exists / the series isn't materialized.
export async function ensureFirstOccurrence(
  ownerId: string,
  seriesId: string
): Promise<string | null> {
  const series = await getItem(ownerId, seriesId);
  const rule = recurrenceOf(series);
  if (!rule || rule.occurrenceMode !== "materialized") return null;
  if ((await liveOccurrenceCount(ownerId, seriesId)) > 0) return null;
  const date = series.scheduledDate ? dateToYmdUtc(series.scheduledDate) : rule.dtstart;
  return materializeOccurrence(ownerId, series, date, rule);
}

// MATERIALIZED completion: the caller has marked the occurrence child done. Now
// advance the parent series log + scheduled, and clone the next occurrence
// (unless the series ended). Idempotent on the live-occurrence guard.
export async function completeMaterializedOccurrence(
  ownerId: string,
  occurrence: ItemRow,
  now = new Date()
): Promise<void> {
  const seriesId = occurrenceSeriesId(occurrence);
  if (!seriesId) return;
  let series: ItemRow;
  try {
    series = await getItem(ownerId, seriesId);
  } catch {
    return; // series was deleted; the completed occurrence stands alone
  }
  const rule = recurrenceOf(series);
  if (!rule) return;

  const today = appTodayYmd(now);
  const occProps = occurrence.properties as Record<string, unknown> | null;
  const occMeta = occProps?.occurrence as Record<string, unknown> | undefined;
  const occurrenceDate =
    typeof occMeta?.date === "string" ? occMeta.date : occurrenceDateOf(occurrence, today);

  const { result } = await advanceSeriesRow(ownerId, series, rule, occurrenceDate, today);

  // create-next-after-completion: exactly one live occurrence at a time.
  if (result.next && (await liveOccurrenceCount(ownerId, seriesId)) === 0) {
    await materializeOccurrence(ownerId, series, result.next, result.rule);
  }
}

// ---------------------------------------------------------------------------
// The completions calendar (S3, ADR-083). The month-grid lets the user tick or
// untick ARBITRARY occurrence dates in any order — a direct edit of the per-date
// log (recurrence.ts pure helpers), distinct from the checkbox "I did the current
// occurrence" gesture. After any log edit, `scheduled_date` is recomputed to the
// next uncompleted occurrence on/after TODAY (forward-looking — missed past dates
// stay absent from the log, never resurrected as scheduled, ADR-076 §1/§8), and
// the status follows (done when nothing remains forward, else not-started).
//
// Calendar editing is a VIRTUAL-series concept: a materialized series' occurrences
// are their own items with their own checkboxes, so editing the series log there
// would desync. The caller (canvas) only shows the calendar for virtual series;
// these functions guard it too.

// Write a series row's recurrence log + recomputed scheduled/status. Shared by the
// toggle and carve paths. maintainDueOffset is intentionally NOT applied here — it
// shifts the deadline by a completion *advance* delta (advanceSeriesRow), whereas a
// calendar edit is a direct log change with no single "advance" to measure from.
async function writeSeriesLogState(
  ownerId: string,
  series: ItemRow,
  rule: RecurrenceRule,
  now: Date
): Promise<ItemRow> {
  const today = appTodayYmd(now);
  const next = nextUncompletedOnOrAfter(rule, today);
  const props = {
    ...((series.properties as Record<string, unknown> | null) ?? {}),
    recurrence: rule,
  };
  const schema = await statusSchemaForType(series.type);
  const status = next
    ? defaultStatusKey(schema, "not_started") ?? "open"
    : defaultStatusKey(schema, "done") ?? "done";
  const [updated] = await getDb()
    .update(items)
    .set({
      properties: props,
      scheduledDate: next ? ymdToUtcDate(next) : null,
      status,
      statusCategory: next ? "not_started" : "done",
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, series.id), eq(items.ownerId, ownerId)))
    .returning();
  await recomputeRelativeChildren(
    ownerId,
    series.id,
    updated.scheduledDate ? dateToYmdUtc(updated.scheduledDate) : null
  );
  return updated as ItemRow;
}

// Toggle a single occurrence date's completion from the calendar. Returns the
// advanced series row.
export async function toggleOccurrenceCompletion(
  ownerId: string,
  seriesId: string,
  date: string,
  now = new Date()
): Promise<ItemRow> {
  const series = await getItem(ownerId, seriesId);
  const rule = recurrenceOf(series);
  if (!rule) throw new ItemError("bad_request", "item is not recurring");
  if (rule.occurrenceMode !== "virtual") {
    throw new ItemError("bad_request", "calendar applies to virtual recurrence only");
  }
  if (!isOccurrence(rule, date)) {
    throw new ItemError("bad_request", "not an occurrence date");
  }
  return writeSeriesLogState(ownerId, series, toggleCompleteInstance(rule, date), now);
}

// Carve one occurrence out of the series into a fresh DETACHED one-off item (the
// inverted occurrence edit, ADR-083). The clone is the pristine series prototype —
// fresh unchecked subtasks, fresh body, carried relations, NO recurrence, and NOT
// linked by the `occurrence` role (so the materialized machinery never fires on
// it). The series SKIPS the date and advances past it. Editing the clone never
// touches the series. Returns the new item id + the advanced series row.
export async function carveOccurrence(
  ownerId: string,
  seriesId: string,
  date: string,
  now = new Date()
): Promise<{ itemId: string; series: ItemRow }> {
  const series = await getItem(ownerId, seriesId);
  const rule = recurrenceOf(series);
  if (!rule) throw new ItemError("bad_request", "item is not recurring");
  if (rule.occurrenceMode !== "virtual") {
    throw new ItemError("bad_request", "calendar applies to virtual recurrence only");
  }
  if (!isOccurrence(rule, date)) {
    throw new ItemError("bad_request", "not an occurrence date");
  }
  const { rootId } = await cloneItemSubtree(
    ownerId,
    seriesId,
    {
      scheduledDate: ymdToUtcDate(date),
      dueDate: series.dueDate,
      inbox: false,
    },
    { stripPropertyKeys: ["recurrence", "occurrence"] }
  );
  const updated = await writeSeriesLogState(
    ownerId,
    series,
    addSkippedInstance(rule, date),
    now
  );
  return { itemId: rootId, series: updated };
}

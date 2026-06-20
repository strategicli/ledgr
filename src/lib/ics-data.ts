// Server side of the ICS task feed (T4, ADR-079): resolve the owner from the
// feed token and assemble the body-free task list the pure builder (ics.ts)
// turns into a VCALENDAR. Owner-scoped; reads no body.
import { and, eq, inArray, isNull, or, isNotNull, sql } from "drizzle-orm";
import { ACTIVE_CATEGORIES } from "@/lib/status";
import { getDb } from "@/db";
import { items, users } from "@/db/schema";
import { dateToYmdUtc, parseRecurrence } from "@/lib/recurrence";
import { parseScheduledTime } from "@/lib/scheduled-time";
import type { IcsTask } from "@/lib/ics";

// Resolve the single owner whose published feed token matches, or null. The
// token (in users.settings.icsToken) is the credential — same posture as a
// share link, no Clerk on the feed path.
export async function resolveIcsOwner(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.settings} ->> 'icsToken' = ${token}`);
  return rows[0]?.id ?? null;
}

function reminderMinutesOf(properties: unknown): number | null {
  if (typeof properties !== "object" || properties === null) return null;
  const r = (properties as Record<string, unknown>).reminder;
  if (typeof r !== "object" || r === null) return null;
  const m = (r as Record<string, unknown>).minutesBefore;
  return typeof m === "number" && Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
}

// Every open, live task the feed should show: those with a scheduled or due
// date, plus recurring series (which carry the rule). origin is the absolute
// base (e.g. https://ledgr.app) so each event links back.
export async function listIcsTasks(ownerId: string, origin: string): Promise<IcsTask[]> {
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      scheduledDate: items.scheduledDate,
      dueDate: items.dueDate,
      properties: items.properties,
    })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "task"),
        inArray(items.statusCategory, ACTIVE_CATEGORIES),
        isNull(items.deletedAt),
        // A template task emits no calendar event (ADR-093).
        eq(items.isTemplate, false),
        or(
          isNotNull(items.scheduledDate),
          isNotNull(items.dueDate),
          sql`(${items.properties} -> 'recurrence') is not null`
        )
      )
    )
    .limit(1000);

  const out: IcsTask[] = [];
  for (const row of rows) {
    const rule = parseRecurrence(
      (row.properties as Record<string, unknown> | null)?.recurrence
    );
    // A recurring task anchors at its rule dtstart + emits the RRULE so the
    // calendar expands occurrences; a one-off uses its scheduled (else due) day.
    const date = rule
      ? rule.dtstart
      : row.scheduledDate
        ? dateToYmdUtc(row.scheduledDate)
        : row.dueDate
          ? dateToYmdUtc(row.dueDate)
          : null;
    if (!date) continue;
    // Drop completed + skipped/carved occurrences from a recurring feed (S6):
    // the calendar shouldn't keep reminding for a day already done or carved out.
    const exdates = rule
      ? [...new Set([...rule.completeInstances, ...rule.skippedInstances])].sort()
      : undefined;
    // A scheduled start time (Stage A time-blocking) turns the event into a timed
    // block. It refines the *scheduled* day, so it only applies when the date came
    // from the scheduled column or the recurrence anchor — not a due-date-only
    // event (a deadline has no time, by design).
    const scheduledTime =
      rule || row.scheduledDate ? parseScheduledTime(row.properties) : null;
    out.push({
      id: row.id,
      title: row.title,
      date,
      startTime: scheduledTime?.start ?? null,
      durationMinutes: scheduledTime?.durationMinutes ?? null,
      rrule: rule?.rrule ?? null,
      exdates,
      url: `${origin}/items/${row.id}`,
      reminderMinutes: reminderMinutesOf(row.properties),
    });
  }
  return out;
}

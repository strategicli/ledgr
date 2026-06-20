// Today view data (PRD §4.2, §4.11 Phase 1: fixed layout). The whole screen
// loads from one batched fetch (rule 8: no per-section round trips); every
// query selects the shared body-free listColumns and is owner-scoped.
//
// Two different day boundaries on purpose:
// - meeting_at is a real instant (FieldStrip round-trips local↔UTC), so
//   "today's meetings" uses the timezone's actual midnights.
// - due_date is a calendar day stored as UTC midnight (FieldStrip slices the
//   ISO date), so due comparisons use plain UTC midnights; shifting them by
//   the timezone would misfile evening saves.
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, types } from "@/db/schema";
import { listColumns } from "@/lib/items";
import { ACTIVE_CATEGORIES } from "@/lib/status";

// Single-user Phase 1 stand-in for a per-user timezone setting. The server
// runs in UTC (Vercel), so "today" must be computed, never assumed.
export const APP_TIMEZONE = process.env.LEDGR_TIMEZONE || "America/New_York";

type Ymd = { y: number; m: number; d: number };

function partsInZone(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(instant)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return p as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

export function ymdInZone(instant: Date, tz: string): Ymd {
  const p = partsInZone(instant, tz);
  return { y: p.year, m: p.month, d: p.day };
}

// The UTC instant of 00:00 on the given calendar date in tz. Guess UTC
// midnight, then correct by the zone's displayed offset; the second pass
// converges across DST transitions (no date math library, rule 5).
export function zonedMidnightUtc({ y, m, d }: Ymd, tz: string): Date {
  const target = Date.UTC(y, m - 1, d);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(new Date(ts), tz);
    const shown = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
    ts += target - shown;
  }
  return new Date(ts);
}

export function todayBounds(now = new Date(), tz = APP_TIMEZONE) {
  const today = ymdInZone(now, tz);
  return {
    today,
    // Meeting window: real midnights in the timezone.
    dayStart: zonedMidnightUtc(today, tz),
    dayEnd: zonedMidnightUtc({ ...today, d: today.d + 1 }, tz),
    // Due-date window: UTC-midnight calendar encoding (see header comment).
    dueToday: new Date(Date.UTC(today.y, today.m - 1, today.d)),
    dueCutoff: new Date(Date.UTC(today.y, today.m - 1, today.d + 1)),
  };
}

export type TodayData = Awaited<ReturnType<typeof getTodayData>>;

export async function getTodayData(ownerId: string, now = new Date()) {
  const bounds = todayBounds(now);
  const db = getDb();
  // Excludes template prototypes (ADR-093) from all four Today queries below.
  const live = and(
    eq(items.ownerId, ownerId),
    isNull(items.deletedAt),
    eq(items.isTemplate, false)
  );
  // Today as a calendar day string, for the day-stamped focus marker (T3).
  const todayYmd = `${bounds.today.y}-${String(bounds.today.m).padStart(2, "0")}-${String(bounds.today.d).padStart(2, "0")}`;

  const [meetings, dueTasks, recent, focusTasks, typeRows] = await Promise.all([
    db
      .select(listColumns)
      .from(items)
      .where(
        and(
          live,
          eq(items.type, "meeting"),
          gte(items.meetingAt, bounds.dayStart),
          lt(items.meetingAt, bounds.dayEnd)
        )
      )
      .orderBy(asc(items.meetingAt))
      .limit(50),
    db
      .select(listColumns)
      .from(items)
      .where(
        and(
          live,
          eq(items.type, "task"),
          // Active = not yet complete (any not_started/in_progress status), S2.
          inArray(items.statusCategory, ACTIVE_CATEGORIES),
          // On my plate today = due by today OR planned (scheduled) by today.
          // A future scheduled date is deferred — it stays off Today until then
          // (the defer/start-date behavior, native tasks T2/ADR-073).
          or(
            lt(items.dueDate, bounds.dueCutoff),
            lt(items.scheduledDate, bounds.dueCutoff)
          )
        )
      )
      // Order by the soonest of the planned/deadline dates.
      .orderBy(asc(sql`least(coalesce(${items.scheduledDate}, ${items.dueDate}), coalesce(${items.dueDate}, ${items.scheduledDate}))`))
      .limit(100),
    db
      .select(listColumns)
      .from(items)
      .where(live)
      .orderBy(desc(items.updatedAt))
      .limit(8),
    // Today's Focus (T3): tasks day-stamped for today (properties.focus.date ==
    // today). Index-backed by items_properties_gin (the @> containment ignores
    // the optional `order` key). Open tasks only — a focused task done today
    // drops out, like the due list.
    db
      .select(listColumns)
      .from(items)
      .where(
        and(
          live,
          eq(items.type, "task"),
          inArray(items.statusCategory, ACTIVE_CATEGORIES),
          sql`${items.properties} @> ${JSON.stringify({ focus: { date: todayYmd } })}::jsonb`
        )
      )
      .limit(50),
    // Type key → label, so Recent can show "Note", not the raw "note" key (and
    // a custom type its real name). The types table is tiny; folded into the
    // one batched fetch rather than a separate round trip.
    db.select({ key: types.key, label: types.label }).from(types),
  ]);

  const typeLabels: Record<string, string> = {};
  for (const t of typeRows) typeLabels[t.key] = t.label;

  return { bounds, meetings, dueTasks, recent, focusTasks, todayYmd, typeLabels };
}

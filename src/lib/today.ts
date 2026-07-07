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
import { cache } from "react";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, types } from "@/db/schema";
import { listColumns } from "@/lib/items";
import { getSettings } from "@/lib/settings";
import { ACTIVE_CATEGORIES } from "@/lib/status";

// The fallback timezone, used before an owner is known and whenever the owner
// hasn't chosen one: the LEDGR_TIMEZONE env var, else America/New_York. The
// server runs in UTC (Vercel), so "today" must be computed, never assumed.
export const DEFAULT_TIMEZONE = process.env.LEDGR_TIMEZONE || "America/New_York";

// Back-compat alias for the fallback. The timezone is now a per-owner setting
// (settings.timezone); prefer getAppTimezone(ownerId) at any site that has an
// owner. This constant stays the safe default for pure code and the parameter
// default of the helpers below, so an un-resolved caller behaves as before.
export const APP_TIMEZONE = DEFAULT_TIMEZONE;

// Process-cached last-resolved owner timezone. Single-user invariant: there is
// exactly one owner per instance, so this global always holds that one owner's
// zone once any request has resolved it. It exists only to give SYNChronous,
// owner-less helpers (appTimezoneSync → appTodayYmd, module-level formatters) the
// owner's zone without threading an id through every call. Correctness bounds:
// it only lags in the tiny window before the first getAppTimezone of a cold
// server (falls back to DEFAULT_TIMEZONE then, self-healing), and never races
// meaningfully because every writer stores the same single owner's value. This
// is server-only state; on the client appTimezoneSync returns DEFAULT_TIMEZONE.
let cachedOwnerTimezone: string | null = null;

// The owner's effective timezone: their chosen setting if valid, else the
// server default. Memoized per server request (react cache) so the many date
// formatters on one page share a single settings read. Never throws — any
// lookup failure falls back to DEFAULT_TIMEZONE rather than breaking dates.
export const getAppTimezone = cache(async (ownerId: string): Promise<string> => {
  try {
    const { timezone } = await getSettings(ownerId);
    const resolved = timezone ?? DEFAULT_TIMEZONE;
    cachedOwnerTimezone = resolved;
    return resolved;
  } catch {
    return cachedOwnerTimezone ?? DEFAULT_TIMEZONE;
  }
});

// Synchronous best-effort owner timezone for helpers that have no ownerId in
// scope (pure day-math, module-level formatters). Returns the last zone
// getAppTimezone resolved (single-user → this owner's), else DEFAULT_TIMEZONE.
// Prefer getAppTimezone(ownerId) wherever an owner and `await` are available.
export function appTimezoneSync(): string {
  return cachedOwnerTimezone ?? DEFAULT_TIMEZONE;
}

// Seed the sync cache from an already-resolved zone. The root layout calls this
// once per request from the settings it already loads, so appTimezoneSync()
// reflects the owner app-wide without a second settings read.
export function primeAppTimezone(tz: string): void {
  cachedOwnerTimezone = tz;
}

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
  const tz = await getAppTimezone(ownerId);
  const bounds = todayBounds(now, tz);
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
          eq(items.type, "event"),
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

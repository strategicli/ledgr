// The Year Map's server half (ADR-287). The view page or a dashboard widget hands
// it the view's rows (owner-scoped, body-free); this resolves each row to a day
// span and the values it can be colored or styled by, and returns the plain
// props the client grid takes (YearMapClient, wired in
// module-calendar-modes-client.tsx). Batched reads: the rows' tags, the type
// registry (labels, statuses, select fields), and, when switched on, the
// Outlook cache.
import { listCalendarEventsForRange } from "@/lib/calendar/feed";
import { moduleOnFor } from "@/lib/modules/enabled";
import { deriveSpec, endPropKey, resolvePlacement, type PlacementSpec } from "@/lib/placement";
import { outgoingRelationsBySource } from "@/lib/relations";
import { appTodayYmd } from "@/lib/recurrence-service";
import { resolveStatusSchema } from "@/lib/status";
import { TAGS_ROLE } from "@/lib/tags";
import { listTypes } from "@/lib/types";
import type { CalendarModeProps } from "@/lib/module-calendar-modes";
import type { YearEntry, YearField, YearMapProps } from "./YearMapClient";
import { YEAR_MODE, addMonths, outlookSpans, parseYearSettings, type Ym } from "./lib";

export async function prepareYearMap({ ownerId, view, items, today, tz, month, navHref }: CalendarModeProps): Promise<YearMapProps> {
  const [tagsBy, types] = await Promise.all([
    outgoingRelationsBySource(ownerId, items.map((i) => i.id), TAGS_ROLE),
    listTypes({ ownerId: null }),
  ]);
  const typeBy = new Map(types.map((t) => [t.key, t]));

  // The view's placement. A custom date field with an end (withEnd) pairs its
  // "__end" sibling, so a "Footprint" range draws as a bar.
  const spec = deriveSpec(view.dateProperty, view.display);
  if (!spec.end && "prop" in spec.start) spec.end = { prop: endPropKey(spec.start.prop) };
  // ponytail: a view of every type has one date field, but a meeting has no
  // plan date. When the view names no type or custom field, a row the spec
  // misses falls back to its meeting time, then its note date.
  const fallbacks: PlacementSpec[] =
    view.filter.type || view.display?.startField
      ? []
      : [{ start: { field: "meetingAt" }, end: { field: "endAt" } }, { start: { field: "noteDate" } }];

  const specs = [spec, ...fallbacks];
  const entries: YearEntry[] = [];
  for (const it of items) {
    let specIdx = 0;
    let p = resolvePlacement(it, spec, tz);
    for (let i = 1; i < specs.length && !p.start; i++) {
      p = resolvePlacement(it, specs[i], tz);
      specIdx = i;
    }
    if (!p.start) continue;
    const t = typeBy.get(it.type);
    const status = resolveStatusSchema(t?.statusSchema ?? null).find((s) => s.key === it.status);
    const vals: Record<string, string[]> = {
      tag: (tagsBy.get(it.id) ?? []).map((x) => x.title || "Untitled"),
      type: [t?.label ?? it.type],
      status: [status?.label ?? it.status],
    };
    const props = (it.properties ?? {}) as Record<string, unknown>;
    for (const pd of t?.propertySchema ?? []) {
      if (pd.kind !== "select" && pd.kind !== "multi_select") continue;
      const v = props[pd.key];
      const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
      if (list.length) vals[`prop:${pd.key}`] = list;
    }
    entries.push({
      id: it.id,
      title: it.title || "Untitled",
      start: p.start.ymd,
      end: p.end && p.end.ymd > p.start.ymd ? p.end.ymd : p.start.ymd,
      vals,
      // What a drag needs to write the item back through buildPatch (slice 2).
      edit: {
        item: {
          type: it.type,
          scheduledDate: it.scheduledDate,
          dueDate: it.dueDate,
          meetingAt: it.meetingAt,
          endAt: it.endAt,
          noteDate: it.noteDate,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
          properties: it.properties,
        },
        specIdx,
        startMin: p.start.minutes,
        endMin: p.end?.minutes ?? null,
        hasEnd: p.end != null,
        can: p.can,
        // The spec names an end field, so a one-day chip can be stretched into a bar.
        stretch: p.can.move && specs[specIdx].end != null,
      },
    });
  }

  // Color/style-by choices: the built-ins, then every select field of a type
  // present in the rows (hidden ones too, tagged so).
  const fields: YearField[] = [
    { key: "tag", label: "Tag" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
  ];
  const seen = new Set<string>();
  for (const key of new Set(items.map((i) => i.type))) {
    for (const pd of typeBy.get(key)?.propertySchema ?? []) {
      if ((pd.kind !== "select" && pd.kind !== "multi_select") || seen.has(pd.key)) continue;
      seen.add(pd.key);
      fields.push({ key: `prop:${pd.key}`, label: pd.label, hidden: pd.hidden === true });
    }
  }

  const settingsRaw = view.display?.modes?.[YEAR_MODE];
  const todayYmd = today ?? appTodayYmd(new Date(), tz);
  // Outlook all-day and multi-day events, only when the owner turned them on and
  // calendar sync is running (the cache is empty otherwise).
  const calendarAvailable = await moduleOnFor(ownerId, "calendar-sync");
  let events: YearMapProps["events"] = [];
  if (calendarAvailable && parseYearSettings(settingsRaw).showCalendar) {
    const a = month ? { y: Number(month.slice(0, 4)), m: Number(month.slice(5, 7)) } : { y: Number(todayYmd.slice(0, 4)), m: Number(todayYmd.slice(5, 7)) };
    // ponytail: one wide fetch (12 months back, 24 ahead of the anchor) so the
    // window control works without a refetch; a longer window or a far-off
    // ?month= shows no events past that band.
    const at = (ym: Ym) => new Date(Date.UTC(ym.y, ym.m - 1, 1));
    events = outlookSpans(await listCalendarEventsForRange(ownerId, at(addMonths(a, -12)), at(addMonths(a, 24))));
  }

  return {
    view,
    settingsRaw,
    entries,
    fields,
    today: todayYmd,
    tz,
    specs,
    createType: view.filter.type ?? "task",
    month,
    navHref,
    events,
    calendarAvailable,
  };
}

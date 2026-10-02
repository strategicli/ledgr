// The Year Map's server half (ADR-287). ViewRenderer hands it the view's rows
// (owner-scoped, body-free); this resolves each row to a day span and the
// values it can be colored or styled by, then passes plain data to the client
// grid. Two batched reads: the rows' tags, and the type registry (labels,
// statuses, select fields).
import { deriveSpec, endPropKey, resolvePlacement, type PlacementSpec } from "@/lib/placement";
import { outgoingRelationsBySource } from "@/lib/relations";
import { appTodayYmd } from "@/lib/recurrence-service";
import { resolveStatusSchema } from "@/lib/status";
import { TAGS_ROLE } from "@/lib/tags";
import { listTypes } from "@/lib/types";
import type { CalendarModeProps } from "@/lib/module-calendar-modes";
import YearMapClient, { type YearEntry, type YearField } from "./YearMapClient";
import { YEAR_MODE } from "./lib";

export default async function YearMap({ ownerId, view, items, today, tz, month, navHref }: CalendarModeProps) {
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

  const entries: YearEntry[] = [];
  for (const it of items) {
    let p = resolvePlacement(it, spec, tz);
    for (const f of fallbacks) {
      if (p.start) break;
      p = resolvePlacement(it, f, tz);
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

  return (
    <YearMapClient
      view={view}
      settingsRaw={view.display?.modes?.[YEAR_MODE]}
      entries={entries}
      fields={fields}
      today={today ?? appTodayYmd(new Date(), tz)}
      month={month}
      navHref={navHref}
    />
  );
}

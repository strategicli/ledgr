// View renderer (slice 27, PRD §4.2/§4.9): one server component that takes a
// stored View Definition's items (already owner-scoped, body-free, filtered,
// and sorted by queryViewItems) and renders them in the view's layout. The
// five layouts are different presentations of the same row set; none of them
// re-queries or reaches for a body. Task rows carry the shared check-off
// control so a view of tasks behaves like the Tasks list.
import type { ReactNode } from "react";
import Link from "next/link";
import BoardDnd, { type BoardCard } from "@/components/views/BoardDnd";
import PlannerCalendar from "@/components/planner/PlannerCalendar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import { SelectBodyCell, SelectHeaderCell } from "@/components/selection/SelectTableCell";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import SubtaskExpandableRow from "@/components/subtasks/SubtaskExpandableRow";
import type { Progress } from "@/lib/subtasks";
import { APP_TIMEZONE } from "@/lib/today";
import { groupValueFor, orderedGroups } from "@/lib/view-grouping";
import { DISPLAY_DEFAULTS } from "@/lib/views";
import type { ColumnField, ViewColumn, ViewDefinition } from "@/lib/views";
import type { OverlayEvent } from "@/lib/calendar/overlay";
import type { StatusDef } from "@/lib/status";

// Structural shape of a listColumns row, narrowed to what the layouts use.
// properties rides along so a board can group by a custom select field (the
// query already selects it; ADR-046).
export type ViewItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  statusCategory: string;
  dueDate: Date | null;
  scheduledDate: Date | null;
  urgency: number | null;
  meetingAt: Date | null;
  url: string | null;
  properties: unknown;
  createdAt: Date;
  updatedAt: Date;
};

// Due dates are UTC-midnight calendar days (ADR-008); format in UTC. The
// timestamp columns are real instants; format in the app's timezone.
const utcDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const tzDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});
const tzDayLong = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});
const utcDayLong = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
// en-CA renders YYYY-MM-DD, a sortable day key.
const utcKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });
const tzKey = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE });

function dateOf(item: ViewItem, prop: ViewDefinition["dateProperty"]): Date | null {
  switch (prop) {
    case "plan":
      // Effective plan date: scheduled if set, else the due deadline (ADR-109).
      return item.scheduledDate ?? item.dueDate;
    case "dueDate":
      return item.dueDate;
    case "scheduledDate":
      return item.scheduledDate;
    case "meetingAt":
      return item.meetingAt;
    case "createdAt":
      return item.createdAt;
    case "updatedAt":
      return item.updatedAt;
    default:
      return item.scheduledDate ?? item.dueDate ?? item.meetingAt;
  }
}

const usesUtc = (prop: ViewDefinition["dateProperty"]) =>
  prop === "plan" || prop === "dueDate" || prop === "scheduledDate";

function dayKey(date: Date, prop: ViewDefinition["dateProperty"]): string {
  return (usesUtc(prop) ? utcKey : tzKey).format(date);
}

// A status chip showing the type's label + color (S2). The resting "not started"
// status renders no chip (matches the old "hide open"); everything else shows.
function StatusChip({ status, statuses }: { status: string; statuses?: StatusDef[] }) {
  const def = statuses?.find((s) => s.key === status);
  if (def?.category === "not_started") return null;
  if (!def && status === "open") return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 text-xs text-neutral-300">
      {def?.color && (
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: def.color }}
        />
      )}
      {def?.label ?? status}
    </span>
  );
}

function UrgencyChip({ urgency }: { urgency: number | null }) {
  if (urgency == null || urgency > 2) return null;
  return (
    <span className="shrink-0 rounded bg-amber-950 px-1.5 text-xs text-amber-400">
      {`P${urgency}`}
    </span>
  );
}

// A row's headline date, picked for the layout's date property.
function rowDate(item: ViewItem, prop: ViewDefinition["dateProperty"]) {
  const d = dateOf(item, prop);
  if (!d) return "";
  return (usesUtc(prop) ? utcDay : tzDay).format(d);
}

// --- configurable columns (Brandon feedback, 2026-06-14) ------------------
// A view can choose which fields/properties the list + table show; null falls
// back to each layout's default. propertyLabels maps a custom property key to
// its label (resolved from the type's schema by the page); missing → the key.

const FIELD_COLUMN_LABELS: Record<ColumnField, string> = {
  type: "Type",
  status: "Status",
  urgency: "Urgency",
  plan: "Plan",
  dueDate: "Due",
  scheduledDate: "Scheduled",
  meetingAt: "When",
  createdAt: "Created",
  updatedAt: "Updated",
  url: "URL",
};

function columnLabel(col: ViewColumn, labels: Record<string, string>): string {
  return col.source === "property"
    ? labels[col.key] ?? col.key
    : FIELD_COLUMN_LABELS[col.key];
}

function formatPropValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

// The display text for a column on a row. Dates format in the same calendars
// as everywhere else (due is a UTC calendar day; the rest are real instants).
function columnText(item: ViewItem, col: ViewColumn): string {
  if (col.source === "property") {
    const props =
      item.properties && typeof item.properties === "object"
        ? (item.properties as Record<string, unknown>)
        : null;
    return formatPropValue(props?.[col.key]);
  }
  switch (col.key) {
    case "type":
      return item.type;
    case "status":
      return item.status;
    case "urgency":
      return item.urgency != null ? `P${item.urgency}` : "";
    case "url":
      return item.url ?? "";
    case "plan": {
      const d = item.scheduledDate ?? item.dueDate;
      return d ? utcDay.format(d) : "";
    }
    case "dueDate":
      return item.dueDate ? utcDay.format(item.dueDate) : "";
    case "scheduledDate":
      return item.scheduledDate ? utcDay.format(item.scheduledDate) : "";
    case "meetingAt":
      return item.meetingAt ? tzDay.format(item.meetingAt) : "";
    case "createdAt":
      return tzDay.format(item.createdAt);
    case "updatedAt":
      return tzDay.format(item.updatedAt);
  }
}

const ITEM_ROW_CLASS = "group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60";

function ItemRow({
  item,
  prop,
  columns,
  propertyLabels = {},
  statuses,
  selectable,
  rowAction,
  rollup,
}: {
  item: ViewItem;
  prop: ViewDefinition["dateProperty"];
  columns?: ViewColumn[] | null;
  propertyLabels?: Record<string, string>;
  statuses?: StatusDef[];
  selectable?: boolean;
  // Optional trailing slot for this row (the related panel passes relation
  // controls — confirm/reject/un-relate + mention/suggested markers). Other
  // callers leave it undefined, so their rows are unchanged.
  rowAction?: ReactNode;
  // Subtask rollup for this row; when present with task children, the row grows
  // the expandable "n/m" pill. Undefined → a plain row (defer by hiding).
  rollup?: Progress;
}) {
  const isTask = item.type === "task";
  const done = item.statusCategory === "done";
  const inner = (
    <>
      {selectable && <SelectCheckbox id={item.id} />}
      {isTask ? (
        <SubtaskCheckbox id={item.id} done={done} />
      ) : (
        <span className="w-14 shrink-0 truncate text-xs text-neutral-600">
          {item.type}
        </span>
      )}
      <Link
        href={`/items/${item.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
          item.title ? "text-neutral-200" : "text-neutral-500"
        } ${done ? "line-through opacity-60" : ""}`}
      >
        {item.title || "Untitled"}
      </Link>
      {columns && columns.length > 0 ? (
        // Configured columns: status/urgency keep their chips (the established
        // look); everything else is a labelled value. A blank value renders
        // nothing so the row doesn't fill with empty labels.
        columns.map((col) => {
          if (col.source === "field" && col.key === "status") {
            return <StatusChip key="status" status={item.status} statuses={statuses} />;
          }
          if (col.source === "field" && col.key === "urgency") {
            return <UrgencyChip key="urgency" urgency={item.urgency} />;
          }
          const text = columnText(item, col);
          if (!text) return null;
          return (
            <span
              key={`${col.source}:${col.key}`}
              className="shrink-0 text-xs text-neutral-500"
              title={columnLabel(col, propertyLabels)}
            >
              {text}
            </span>
          );
        })
      ) : (
        <>
          <StatusChip status={item.status} statuses={statuses} />
          <UrgencyChip urgency={item.urgency} />
          <span className="shrink-0 text-xs text-neutral-600">
            {rowDate(item, prop)}
          </span>
        </>
      )}
      {rowAction}
    </>
  );
  if (isTask && rollup && rollup.total > 0) {
    return (
      <SubtaskExpandableRow id={item.id} done={rollup.done} total={rollup.total} liClassName={ITEM_ROW_CLASS}>
        {inner}
      </SubtaskExpandableRow>
    );
  }
  return <li className={ITEM_ROW_CLASS}>{inner}</li>;
}

// --- layouts --------------------------------------------------------------
// (board/agenda grouping lives in src/lib/view-grouping.ts — pure + testable)

function ListLayout({
  items,
  view,
  propertyLabels,
  statuses,
  selectable,
  rowActions,
  rollups,
}: {
  items: ViewItem[];
  view: ViewDefinition;
  propertyLabels: Record<string, string>;
  statuses?: StatusDef[];
  selectable?: boolean;
  rowActions?: Record<string, ReactNode>;
  rollups?: Map<string, Progress>;
}) {
  return (
    <ul className="mt-4">
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          prop={view.dateProperty}
          columns={view.columns}
          propertyLabels={propertyLabels}
          statuses={statuses}
          selectable={selectable}
          rowAction={rowActions?.[item.id]}
          rollup={rollups?.get(item.id)}
        />
      ))}
    </ul>
  );
}

function TableLayout({
  items,
  view,
  propertyLabels,
  selectable,
}: {
  items: ViewItem[];
  view: ViewDefinition;
  propertyLabels: Record<string, string>;
  selectable?: boolean;
}) {
  // The view's chosen columns, or the default four (Type/Status/Urgency/Date)
  // expressed as field columns so one rendering path serves both. "Date" maps
  // to the view's date property so the default keeps its old meaning.
  const defaultDateKey: ColumnField =
    view.dateProperty === "meetingAt"
      ? "meetingAt"
      : view.dateProperty === "createdAt"
        ? "createdAt"
        : view.dateProperty === "updatedAt"
          ? "updatedAt"
          : view.dateProperty === "scheduledDate"
            ? "scheduledDate"
            : view.dateProperty === "dueDate"
              ? "dueDate"
              : "plan";
  const columns: ViewColumn[] =
    view.columns && view.columns.length > 0
      ? view.columns
      : [
          { source: "field", key: "type" },
          { source: "field", key: "status" },
          { source: "field", key: "urgency" },
          { source: "field", key: defaultDateKey },
        ];
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            {selectable && <SelectHeaderCell />}
            <th className="py-1.5 pr-3 font-medium">Title</th>
            {columns.map((col) => (
              <th key={`${col.source}:${col.key}`} className="py-1.5 pr-3 font-medium">
                {columnLabel(col, propertyLabels)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="group border-b border-neutral-900 hover:bg-neutral-800/40"
            >
              {selectable && <SelectBodyCell id={item.id} />}
              <td className="max-w-xs truncate py-1.5 pr-3">
                <Link
                  href={`/items/${item.id}`}
                  className={`hover:text-neutral-100 ${
                    item.title ? "text-neutral-200" : "text-neutral-500"
                  } ${item.statusCategory === "done" ? "line-through opacity-60" : ""}`}
                >
                  {item.title || "Untitled"}
                </Link>
              </td>
              {columns.map((col) => (
                <td
                  key={`${col.source}:${col.key}`}
                  className="py-1.5 pr-3 text-neutral-400"
                >
                  {columnText(item, col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardLayout({
  items,
  view,
  groupOrder,
  draggable,
  statuses,
}: {
  items: ViewItem[];
  view: ViewDefinition;
  groupOrder?: string[];
  draggable?: boolean;
  statuses?: StatusDef[];
}) {
  const now = new Date();
  // A status board colors its column headers with the status colors (S2).
  const statusBoard =
    !view.grouping || ("field" in view.grouping && view.grouping.field === "status");
  // When the page deems the grouping safe to set by a drop (status, urgency, or
  // a single-select property), hand off to the client DnD board; the cards
  // carry a precomputed date label so the client needn't reimplement the
  // calendars. Otherwise the board stays the read-only server render.
  if (draggable) {
    const cards: BoardCard[] = items.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      urgency: i.urgency,
      type: i.type,
      dueDate: i.dueDate,
      scheduledDate: i.scheduledDate,
      properties: i.properties,
      dateLabel: rowDate(i, view.dateProperty),
    }));
    return <BoardDnd cards={cards} grouping={view.grouping} groupOrder={groupOrder} statuses={statuses} />;
  }
  const present = new Set(items.map((i) => groupValueFor(i, view.grouping, now)));
  const columns = orderedGroups(view.grouping, present, groupOrder);
  return (
    <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const colItems = items.filter(
          (i) => groupValueFor(i, view.grouping, now) === col
        );
        return (
          <div
            key={col}
            className="flex w-60 shrink-0 flex-col rounded-lg border border-neutral-800 bg-neutral-900/40"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {(() => {
                const sdef = statusBoard ? statuses?.find((s) => s.key === col) : undefined;
                return (
                  <span className="flex items-center gap-1.5 truncate">
                    {sdef?.color && (
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: sdef.color }}
                      />
                    )}
                    {sdef?.label ?? col}
                  </span>
                );
              })()}
              <span className="text-neutral-600">{colItems.length}</span>
            </div>
            <ul className="flex flex-col gap-1.5 p-2">
              {colItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/items/${item.id}`}
                    className={`block rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm hover:border-neutral-700 ${
                      item.title ? "text-neutral-200" : "text-neutral-500"
                    } ${item.statusCategory === "done" ? "line-through opacity-60" : ""}`}
                  >
                    <span className="block truncate">
                      {item.title || "Untitled"}
                    </span>
                    {rowDate(item, view.dateProperty) && (
                      <span className="mt-0.5 block text-xs text-neutral-600">
                        {rowDate(item, view.dateProperty)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AgendaLayout({
  items,
  view,
  propertyLabels,
  statuses,
  selectable,
  rollups,
}: {
  items: ViewItem[];
  view: ViewDefinition;
  propertyLabels: Record<string, string>;
  statuses?: StatusDef[];
  selectable?: boolean;
  rollups?: Map<string, Progress>;
}) {
  const prop = view.dateProperty;
  const longFmt = usesUtc(prop) ? utcDayLong : tzDayLong;
  // Bucket by day; sort buckets chronologically; undated last.
  const buckets = new Map<string, { label: string; items: ViewItem[] }>();
  const undated: ViewItem[] = [];
  for (const item of items) {
    const d = dateOf(item, prop);
    if (!d) {
      undated.push(item);
      continue;
    }
    const key = dayKey(d, prop);
    if (!buckets.has(key)) buckets.set(key, { label: longFmt.format(d), items: [] });
    buckets.get(key)!.items.push(item);
  }
  const days = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="mt-4 flex flex-col gap-5">
      {days.map(([key, { label, items: dayItems }]) => (
        <section key={key}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {label}
          </h3>
          <ul className="mt-1">
            {dayItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                prop={prop}
                columns={view.columns}
                propertyLabels={propertyLabels}
                statuses={statuses}
                selectable={selectable}
                rollup={rollups?.get(item.id)}
              />
            ))}
          </ul>
        </section>
      ))}
      {undated.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            No date
          </h3>
          <ul className="mt-1">
            {undated.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                prop={prop}
                columns={view.columns}
                propertyLabels={propertyLabels}
                statuses={statuses}
                selectable={selectable}
                rollup={rollups?.get(item.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CalendarLayout({
  items,
  view,
  month,
  navHref,
}: {
  items: ViewItem[];
  view: ViewDefinition;
  // Which month to show, "YYYY-MM" (validated by the caller); defaults to the
  // current month. Items aren't month-bounded by the query, so navigating just
  // re-buckets the same rows into the chosen month — no re-fetch.
  month?: string;
  // Base path for the prev/next/today links (e.g. "/views/<id>"). When set, the
  // month nav renders; widgets leave it unset (no URL context) and stay locked
  // to the current month.
  navHref?: string;
}) {
  const prop = view.dateProperty;
  const pad = (n: number) => String(n).padStart(2, "0");
  // The month to show: the provided YYYY-MM or the current month (app TZ).
  const nowParts = tzKey.format(new Date()).split("-"); // YYYY-MM-DD
  const shown = month && /^\d{4}-\d{2}$/.test(month) ? month : `${nowParts[0]}-${nowParts[1]}`;
  const [ys, ms] = shown.split("-");
  const year = Number(ys);
  const monthNum = Number(ms); // 1-12
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNum - 1, 1)));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
  const todayKey = tzKey.format(new Date());
  const onCurrentMonth = shown === `${nowParts[0]}-${nowParts[1]}`;
  // Prev/next month params (first-of-month math, DST-safe in UTC).
  const toParam = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  const prevMonth = toParam(new Date(Date.UTC(year, monthNum - 2, 1)));
  const nextMonth = toParam(new Date(Date.UTC(year, monthNum, 1)));

  // Bucket items by day key; count any that fall outside the shown month.
  const byDay = new Map<string, ViewItem[]>();
  let outside = 0;
  for (const item of items) {
    const d = dateOf(item, prop);
    if (!d) {
      outside += 1;
      continue;
    }
    const key = dayKey(d, prop);
    if (!key.startsWith(shown)) {
      outside += 1;
      continue;
    }
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  const cells: ({ day: number; key: string } | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ day: d, key: `${shown}-${pad(d)}` });
  }

  const navLink =
    "rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200";

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-300">{monthLabel}</p>
        {navHref && (
          <div className="flex items-center gap-1 text-xs">
            <Link href={`${navHref}?month=${prevMonth}`} aria-label="Previous month" className={navLink}>
              ‹
            </Link>
            {!onCurrentMonth && (
              <Link href={navHref} className={navLink}>
                Today
              </Link>
            )}
            <Link href={`${navHref}?month=${nextMonth}`} aria-label="Next month" className={navLink}>
              ›
            </Link>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-neutral-900 px-2 py-1 text-center font-medium uppercase tracking-wide text-neutral-500"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} className="min-h-20 bg-neutral-950" />;
          const dayItems = byDay.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          return (
            <div key={cell.key} className="min-h-20 bg-neutral-900 p-1">
              <div
                className={`mb-1 text-right text-[11px] ${
                  isToday ? "font-bold text-neutral-100" : "text-neutral-600"
                }`}
              >
                {cell.day}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayItems.slice(0, 4).map((item) => (
                  <Link
                    key={item.id}
                    href={`/items/${item.id}`}
                    title={item.title || "Untitled"}
                    className={`block truncate rounded bg-neutral-800 px-1 py-0.5 text-[11px] hover:bg-neutral-700 ${
                      item.statusCategory === "done"
                        ? "text-neutral-500 line-through"
                        : "text-neutral-300"
                    }`}
                  >
                    {item.title || "Untitled"}
                  </Link>
                ))}
                {dayItems.length > 4 && (
                  <span className="px-1 text-[11px] text-neutral-600">
                    +{dayItems.length - 4} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {outside > 0 && (
        <p className="mt-2 text-xs text-neutral-600">
          {outside} item{outside === 1 ? "" : "s"} outside {monthLabel} (no
          date or another month).
        </p>
      )}
    </div>
  );
}

export default function ViewRenderer({
  view,
  items,
  groupOrder,
  propertyLabels = {},
  boardDraggable = false,
  statuses,
  month,
  calendarNavHref,
  calendarEvents,
  selectable = false,
  rowActions,
  rollups,
}: {
  view: ViewDefinition;
  items: ViewItem[];
  // The view type's resolved statuses (S2): status chips + board column labels/
  // colors render from these. Resolved by the page from the type's schema.
  statuses?: StatusDef[];
  // Column order for a board grouped by a custom property (the property's
  // option order); resolved by the page from the type's schema (ADR-046).
  groupOrder?: string[];
  // Labels for the type's custom properties, so a property column shows its
  // label rather than its key. Resolved by the page from the type's schema.
  propertyLabels?: Record<string, string>;
  // Whether a board's cards can be dragged between columns to set their group
  // value. The page decides (only safe for status/urgency/single-select);
  // dashboards leave it false, so a board widget stays read-only.
  boardDraggable?: boolean;
  // Calendar month to show, "YYYY-MM" (from the page's ?month= param); defaults
  // to the current month.
  month?: string;
  // Base path for the calendar's month-nav links (e.g. "/views/<id>"). Set by
  // the view page; widgets leave it unset so a calendar widget shows the current
  // month with no nav.
  calendarNavHref?: string;
  // Read-only synced calendar events for the writable calendar overlay (plan
  // tasks around what's already scheduled). Passed straight to PlannerCalendar,
  // which gates them behind its "Show calendar" toggle.
  calendarEvents?: OverlayEvent[];
  // Render per-row selection checkboxes (the multi-select layer, ADR-118). The
  // caller wraps this renderer in a SelectionProvider + BulkActionBar; here it
  // only toggles the row affordance. Off for dashboard widgets (read-only) and
  // the board/calendar layouts (selection there is deferred — defer-by-hiding).
  selectable?: boolean;
  // Optional per-row trailing slot, keyed by item id (the related panel passes
  // relation controls). Honored by the list layout; other layouts ignore it for
  // now (defer-by-hiding). Undefined for every other caller.
  rowActions?: Record<string, ReactNode>;
  // Subtask "n/m" rollups keyed by item id, so list/agenda rows can grow the
  // expandable indicator. The list-surface callers compute it (childRollups);
  // dashboards, the board/table/calendar layouts, and the related panel leave
  // it undefined, so those rows are unchanged (defer by hiding).
  rollups?: Map<string, Progress>;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-6 px-2 text-sm text-neutral-600">
        No items match this view.
      </p>
    );
  }
  switch (view.layout) {
    case "table":
      return (
        <TableLayout
          items={items}
          view={view}
          propertyLabels={propertyLabels}
          selectable={selectable}
        />
      );
    case "board":
      return (
        <BoardLayout
          items={items}
          view={view}
          groupOrder={groupOrder}
          draggable={boardDraggable}
          statuses={statuses}
        />
      );
    case "calendar": {
      // The Planner (ADR-131): when the calendar places items on a WRITABLE
      // calendar-day field (scheduled/due/plan, or unset → defaults to plan),
      // mount the interactive month grid so chips can be dragged to re-plan.
      // Read-only calendars (events by meeting_at, created/updated) keep the
      // static grid (desktop) + agenda (mobile) — dragging those isn't meaningful.
      const prop = view.dateProperty;
      const writable =
        prop == null || prop === "plan" || prop === "scheduledDate" || prop === "dueDate";
      if (writable) {
        return (
          <PlannerCalendar
            items={items}
            prop={prop}
            placeBy={view.display?.placeBy ?? DISPLAY_DEFAULTS.placeBy}
            display={view.display}
            month={month}
            navHref={calendarNavHref}
            calendarEvents={calendarEvents}
            statuses={statuses}
          />
        );
      }
      return (
        <>
          <div className="hidden sm:block">
            <CalendarLayout
              items={items}
              view={view}
              month={month}
              navHref={calendarNavHref}
            />
          </div>
          <div className="sm:hidden">
            <AgendaLayout
              items={items}
              view={view}
              propertyLabels={propertyLabels}
              statuses={statuses}
              selectable={selectable}
              rollups={rollups}
            />
          </div>
        </>
      );
    }
    case "agenda":
      return (
        <AgendaLayout
          items={items}
          view={view}
          propertyLabels={propertyLabels}
          statuses={statuses}
          selectable={selectable}
          rollups={rollups}
        />
      );
    default:
      return (
        <ListLayout
          items={items}
          view={view}
          propertyLabels={propertyLabels}
          statuses={statuses}
          selectable={selectable}
          rowActions={rowActions}
          rollups={rollups}
        />
      );
  }
}

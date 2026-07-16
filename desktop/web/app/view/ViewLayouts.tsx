"use client";

// Lightweight desktop renderers for a saved view's non-list layouts (table /
// board / calendar). The cloud ViewRenderer is a heavy interactive subsystem
// (BoardDnd + PlannerCalendar + selection + subtasks, all Date-typed and driven
// by router.refresh writes), which doesn't fit the static-export/IPC runtime.
// These are read/browse renderers in the desktop's lightweight idiom (ItemRows
// et al.); drag/resize and inline edits stay in the cloud app (defer-by-hiding).
// Dates arrive from the seam as ISO strings, so we slice for display and revive
// to Date only where the pure grouping helpers need it. ADR-139.
import { useState } from "react";
import ItemRows, { type ItemRow } from "@/components/ItemRows";
import {
  groupValueFor,
  orderedGroups,
  NONE_GROUP,
  type GroupableItem,
} from "@/lib/view-grouping";
import type { ViewColumn, ViewDefinition } from "@/lib/views";

// The view's items as they cross the IPC seam. Note: the direct
// window.__ledgrDesktop bridge uses structured clone, which PRESERVES Date
// objects (unlike a JSON fetch, which would stringify them) — so the date
// fields arrive as Date, not string. The helpers below tolerate both.
type Dateish = Date | string | null;
export type WireItem = {
  id: string;
  type: string;
  title: string | null;
  status: string;
  statusCategory: string | null;
  urgency: number | null;
  url: string | null;
  properties: unknown;
  dueDate: Dateish;
  scheduledDate: Dateish;
  meetingAt: Dateish;
  createdAt: Dateish;
  updatedAt: Dateish;
};

// A YYYY-MM-DD day key from a Date or an ISO string. Due/scheduled dates are
// UTC-midnight calendar days (ADR-008), so the UTC day is the right key.
const day = (v: Dateish): string => {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const toDate = (v: Dateish): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function toRow(it: WireItem): ItemRow {
  return {
    id: it.id,
    title: it.title,
    type: it.type,
    statusCategory: it.statusCategory,
    dueDate: day(it.dueDate) || null,
    scheduledDate: day(it.scheduledDate) || null,
  };
}

function groupable(it: WireItem): GroupableItem {
  return {
    status: it.status,
    urgency: it.urgency,
    type: it.type,
    dueDate: toDate(it.dueDate),
    scheduledDate: toDate(it.scheduledDate),
    properties: it.properties,
  };
}

// --- table ---------------------------------------------------------------

const DEFAULT_COLUMNS: ViewColumn[] = [
  { source: "field", key: "status" },
  { source: "field", key: "plan" },
];

function columnLabel(col: ViewColumn): string {
  if (col.source === "property") return col.key;
  const map: Record<string, string> = {
    type: "Type",
    status: "Status",
    urgency: "Priority",
    plan: "Plan",
    dueDate: "Due",
    scheduledDate: "Scheduled",
    meetingAt: "When",
    createdAt: "Created",
    updatedAt: "Updated",
    url: "Link",
  };
  return map[col.key] ?? col.key;
}

function cellValue(it: WireItem, col: ViewColumn): string {
  if (col.source === "property") {
    const p = it.properties as Record<string, unknown> | null;
    const v = p?.[col.key];
    if (v == null || v === "") return "";
    return Array.isArray(v) ? v.map(String).join(", ") : String(v);
  }
  switch (col.key) {
    case "type":
      return it.type;
    case "status":
      return it.status;
    case "urgency":
      return it.urgency != null ? `P${it.urgency}` : "";
    case "url":
      return it.url ?? "";
    case "plan":
      return day(it.scheduledDate ?? it.dueDate);
    case "dueDate":
      return day(it.dueDate);
    case "scheduledDate":
      return day(it.scheduledDate);
    case "meetingAt":
      return day(it.meetingAt);
    case "createdAt":
      return day(it.createdAt);
    case "updatedAt":
      return day(it.updatedAt);
    default:
      return "";
  }
}

function TableLayout({
  view,
  items,
  onOpen,
}: {
  view: ViewDefinition;
  items: WireItem[];
  onOpen: (id: string) => void;
}) {
  const cols = view.columns ?? DEFAULT_COLUMNS;
  return (
    <div className="mt-3 overflow-x-auto" data-testlayout="table">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4 font-semibold">Title</th>
            {cols.map((c, i) => (
              <th key={i} className="py-2 pr-4 font-semibold">
                {columnLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-neutral-900 hover:bg-neutral-900/40">
              <td className="py-2 pr-4">
                <button
                  onClick={() => onOpen(it.id)}
                  className="text-left text-neutral-200 hover:underline"
                >
                  {it.title || "(untitled)"}
                </button>
              </td>
              {cols.map((c, i) => (
                <td key={i} className="py-2 pr-4 text-neutral-400">
                  {cellValue(it, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- board ---------------------------------------------------------------

function BoardLayout({
  view,
  items,
  onOpen,
}: {
  view: ViewDefinition;
  items: WireItem[];
  onOpen: (id: string) => void;
}) {
  const now = new Date();
  const groups = new Map<string, WireItem[]>();
  for (const it of items) {
    const g = groupValueFor(groupable(it), view.grouping, now);
    const list = groups.get(g) ?? [];
    list.push(it);
    groups.set(g, list);
  }
  const order = orderedGroups(view.grouping, new Set(groups.keys()));

  return (
    <div className="mt-3 flex gap-4 overflow-x-auto pb-2" data-testlayout="board">
      {order.map((g) => (
        <div key={g} className="w-64 shrink-0 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <h3 className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-neutral-400">
            <span className="truncate">{g === NONE_GROUP ? "None" : g}</span>
            <span className="ml-2 text-neutral-600">{groups.get(g)?.length ?? 0}</span>
          </h3>
          <ul className="flex list-none flex-col gap-2 p-0">
            {(groups.get(g) ?? []).map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => onOpen(it.id)}
                  className="block w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left text-sm text-neutral-200 hover:border-neutral-700"
                >
                  <span className="block truncate">{it.title || "(untitled)"}</span>
                  {it.urgency != null && it.urgency <= 2 ? (
                    <span className="mt-1 inline-block rounded bg-amber-950 px-1.5 text-xs text-amber-400">
                      P{it.urgency}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- calendar (read-only month grid) -------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function calDayKey(it: WireItem, prop: ViewDefinition["dateProperty"]): string | null {
  const s =
    prop === "dueDate"
      ? it.dueDate
      : prop === "scheduledDate"
        ? it.scheduledDate
        : prop === "meetingAt"
          ? it.meetingAt
          : prop === "createdAt"
            ? it.createdAt
            : prop === "updatedAt"
              ? it.updatedAt
              : (it.scheduledDate ?? it.dueDate ?? it.meetingAt); // "plan" / null
  return day(s) || null;
}

function CalendarLayout({
  view,
  items,
  onOpen,
}: {
  view: ViewDefinition;
  items: WireItem[];
  onOpen: (id: string) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth()); // 0-based

  const byDay = new Map<string, WireItem[]>();
  for (const it of items) {
    const k = calDayKey(it, view.dateProperty);
    if (!k) continue;
    const list = byDay.get(k) ?? [];
    list.push(it);
    byDay.set(k, list);
  }

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const todayKey = today.toISOString().slice(0, 10);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const step = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="mt-3" data-testlayout="calendar">
      <div className="mb-2 flex items-center gap-3">
        <button onClick={() => step(-1)} className="rounded border border-neutral-700 px-2 py-0.5 text-sm text-neutral-300 hover:bg-neutral-800">
          ‹
        </button>
        <span className="text-sm font-medium text-neutral-200">
          {MONTHS[month]} {year}
        </span>
        <button onClick={() => step(1)} className="rounded border border-neutral-700 px-2 py-0.5 text-sm text-neutral-300 hover:bg-neutral-800">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-neutral-900 px-2 py-1 text-center text-xs font-semibold uppercase text-neutral-500">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const key = d == null ? null : `${year}-${pad(month + 1)}-${pad(d)}`;
          const dayItems = key ? (byDay.get(key) ?? []) : [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              className={`min-h-24 bg-neutral-950 p-1 ${d == null ? "opacity-40" : ""}`}
            >
              {d != null ? (
                <div className={`mb-1 text-xs ${isToday ? "font-bold text-[var(--accent,#60a5fa)]" : "text-neutral-500"}`}>
                  {d}
                </div>
              ) : null}
              <ul className="flex list-none flex-col gap-1 p-0">
                {dayItems.slice(0, 4).map((it) => (
                  <li key={it.id}>
                    <button
                      onClick={() => onOpen(it.id)}
                      className="block w-full truncate rounded bg-neutral-800 px-1.5 py-0.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
                    >
                      {it.title || "(untitled)"}
                    </button>
                  </li>
                ))}
                {dayItems.length > 4 ? (
                  <li className="px-1 text-xs text-neutral-600">+{dayItems.length - 4} more</li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- dispatcher ----------------------------------------------------------

export default function ViewLayouts({
  view,
  items,
  onOpen,
  onToggle,
}: {
  view: ViewDefinition;
  items: WireItem[];
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  if (!items.length) {
    return <p className="mt-3 text-sm text-neutral-500">No items in this view.</p>;
  }
  switch (view.layout) {
    case "table":
      return <TableLayout view={view} items={items} onOpen={onOpen} />;
    case "board":
      return <BoardLayout view={view} items={items} onOpen={onOpen} />;
    case "calendar":
      return <CalendarLayout view={view} items={items} onOpen={onOpen} />;
    // agenda (a date-ordered list) and list both render as the row list; the
    // interactive time-grid stays cloud-side (defer-by-hiding).
    default:
      return (
        <ItemRows
          items={items.map(toRow)}
          empty="No items in this view."
          onOpen={onOpen}
          onToggle={onToggle}
        />
      );
  }
}

// Interactive month grid for the Planner (ADR-131): the read-only CalendarLayout
// made draggable. Tasks are all-day chips in their day cell; drag a chip to
// another day to re-plan it, drag from the Unscheduled rail onto a day to give
// it a date, or drag back to the rail to clear it. Desktop uses native HTML5
// drag; touch uses the long-press path in usePlannerTouchDrag. Each drop is
// optimistic (local override) → PATCH /api/items/[id] → router.refresh, and
// reverts on failure — the same shape as the canvas date controls.
//
// What a drag WRITES: scheduled_date by default (the plan), or due_date when the
// view places by due (ADR-131). It never touches the other date. Read-only
// calendars (events by meeting_at) keep the static CalendarLayout; ViewRenderer
// only mounts this for writable-date views.
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlannerTouchDrag } from "@/components/planner/usePlannerTouchDrag";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { DateProperty, PlaceBy } from "@/lib/views";

// Sentinel data-day for the Unscheduled rail (drop here = clear the date).
const RAIL = "__none__";
const pad = (n: number) => String(n).padStart(2, "0");
const ymdToIso = (ymd: string) => `${ymd}T00:00:00.000Z`;

// en-CA → YYYY-MM-DD. Scheduled/due are UTC-midnight calendar days (ADR-008),
// so a chip's day key is its date formatted in UTC; matches how dates store.
const utcKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });

export default function PlannerMonth({
  items,
  prop,
  placeBy,
  month,
  navHref,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  month?: string;
  navHref?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Optimistic placement overrides: id → "YYYY-MM-DD" or null (unscheduled).
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  // The date field a drag writes (and reads placement by). When the view places
  // explicitly by due/scheduled, follow that; for "plan"/unset, the placeBy
  // toggle decides (scheduled by default — the Planner plans work, not deadlines).
  const field: "scheduledDate" | "dueDate" =
    prop === "dueDate"
      ? "dueDate"
      : prop === "scheduledDate"
        ? "scheduledDate"
        : placeBy === "due"
          ? "dueDate"
          : "scheduledDate";

  const byId = new Map(items.map((it) => [it.id, it]));
  function storedYmd(item: ViewItem): string | null {
    const d =
      prop === "dueDate"
        ? item.dueDate
        : prop === "scheduledDate"
          ? item.scheduledDate
          : (item.scheduledDate ?? item.dueDate); // plan / unset
    return d ? utcKey.format(d) : null;
  }
  const effectiveYmd = (item: ViewItem): string | null =>
    Object.prototype.hasOwnProperty.call(override, item.id)
      ? override[item.id]
      : storedYmd(item);

  // Month to show (YYYY-MM), else the current month in local time.
  const now = new Date();
  const shown =
    month && /^\d{4}-\d{2}$/.test(month)
      ? month
      : `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
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
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const onCurrentMonth = shown === `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const toParam = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  const prevMonth = toParam(new Date(Date.UTC(year, monthNum - 2, 1)));
  const nextMonth = toParam(new Date(Date.UTC(year, monthNum, 1)));

  // Bucket by effective day; undated → rail; dated in another month → counted.
  const byDay = new Map<string, ViewItem[]>();
  const unscheduled: ViewItem[] = [];
  let elsewhere = 0;
  for (const item of items) {
    const ymd = effectiveYmd(item);
    if (!ymd) {
      unscheduled.push(item);
      continue;
    }
    if (!ymd.startsWith(shown)) {
      elsewhere += 1;
      continue;
    }
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd)!.push(item);
  }

  const cells: ({ day: number; key: string } | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push({ day: d, key: `${shown}-${pad(d)}` });

  async function commitDrop(id: string | null, day: string | null) {
    setDragId(null);
    setOverDay(null);
    if (!id || day === null) return; // dropped nowhere
    const item = byId.get(id);
    if (!item) return;
    const target = day === RAIL ? null : day; // RAIL → clear the date
    if (target === effectiveYmd(item)) return; // no change
    setOverride((o) => ({ ...o, [id]: target }));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: target ? ymdToIso(target) : null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setOverride((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    }
  }

  usePlannerTouchDrag(containerRef, {
    onArm: (id) => setDragId(id),
    onOver: (day) => setOverDay(day),
    onDrop: (day) => commitDrop(dragId, day),
    onCancel: () => {
      setDragId(null);
      setOverDay(null);
    },
  });

  const navLink =
    "rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200";

  function Chip({ item }: { item: ViewItem }) {
    const done = item.statusCategory === "done";
    const lifted = dragId === item.id;
    return (
      <Link
        href={`/items/${item.id}`}
        title={item.title || "Untitled"}
        data-card-id={item.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(item.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverDay(null);
        }}
        className={`block cursor-grab touch-none select-none truncate rounded px-1 py-0.5 text-[11px] active:cursor-grabbing ${
          done ? "text-neutral-500 line-through" : "text-neutral-300"
        } ${lifted ? "opacity-40" : ""}`}
        style={{
          backgroundColor: "rgb(38 38 38)",
          borderLeft:
            item.urgency != null && item.urgency <= 2
              ? "2px solid var(--accent)"
              : "2px solid transparent",
        }}
      >
        {item.title || "Untitled"}
      </Link>
    );
  }

  // A drop target (day cell or rail): allow the drop and read the dragged id.
  const dropProps = (day: string) => ({
    "data-day": day,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overDay !== day) setOverDay(day);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      commitDrop(id, day);
    },
  });

  return (
    <div ref={containerRef} className="mt-4 flex flex-col gap-3 sm:flex-row">
      {/* Unscheduled rail */}
      <aside
        {...dropProps(RAIL)}
        className={`shrink-0 rounded-lg border p-2 sm:w-44 ${
          overDay === RAIL ? "border-[color:var(--accent)]" : "border-neutral-800"
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Unscheduled
          </span>
          <span className="rounded-full bg-neutral-800 px-1.5 text-[11px] text-neutral-400">
            {unscheduled.length}
          </span>
        </div>
        <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
          {unscheduled.length === 0 ? (
            <p className="text-[11px] text-neutral-600">Nothing waiting.</p>
          ) : (
            unscheduled.map((item) => <Chip key={item.id} item={item} />)
          )}
        </div>
        <p className="mt-2 hidden text-[11px] text-neutral-600 sm:block">
          Drag onto a day →
        </p>
      </aside>

      {/* Month grid */}
      <div className="min-w-0 flex-1">
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
            const isToday = cell.key === todayYmd;
            const isOver = overDay === cell.key;
            return (
              <div
                key={cell.key}
                {...dropProps(cell.key)}
                className="min-h-20 bg-neutral-900 p-1"
                style={isOver ? { outline: "2px solid var(--accent)", outlineOffset: "-2px" } : undefined}
              >
                <div
                  className={`mb-1 text-right text-[11px] ${
                    isToday ? "font-bold text-neutral-100" : "text-neutral-600"
                  }`}
                >
                  {isToday ? (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1"
                      style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" }}
                    >
                      {cell.day}
                    </span>
                  ) : (
                    cell.day
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayItems.slice(0, 4).map((item) => (
                    <Chip key={item.id} item={item} />
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
        {elsewhere > 0 && (
          <p className="mt-2 text-xs text-neutral-600">
            {elsewhere} item{elsewhere === 1 ? "" : "s"} in another month — use ‹ › to find them.
          </p>
        )}
      </div>
    </div>
  );
}

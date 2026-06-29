// Interactive month grid for the Planner (ADR-131): the read-only CalendarLayout
// made draggable. Tasks are all-day chips in their day cell; drag a chip to
// another day to re-plan it, drag from the Unscheduled rail onto a day to give
// it a date, or drag back to the rail to clear it. Desktop uses native HTML5
// drag; touch uses the long-press path in usePlannerTouchDrag. Each drop is
// optimistic (local override) → PATCH /api/items/[id] → router.refresh, and
// reverts on failure.
//
// Chips are <div>s (not <Link>s) so the browser's native anchor-drag doesn't
// fight our drag (that caused a "click twice" feel); click navigates. The grid
// fills complete weeks with leading/trailing spillover days so there are no
// blank cells at the month edges. What a drag WRITES: scheduled_date by default
// (the plan), or due_date when the view places by due.
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysYmd } from "@/lib/recurrence";
import UnscheduledRail from "@/components/planner/UnscheduledRail";
import { usePlannerTouchDrag } from "@/components/planner/usePlannerTouchDrag";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { DateProperty, PlaceBy } from "@/lib/views";

const RAIL = "__none__";
const pad = (n: number) => String(n).padStart(2, "0");
const ymdToIso = (ymd: string) => `${ymd}T00:00:00.000Z`;
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
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const field: "scheduledDate" | "dueDate" =
    prop === "dueDate" ? "dueDate" : prop === "scheduledDate" ? "scheduledDate" : placeBy === "due" ? "dueDate" : "scheduledDate";

  const byId = new Map(items.map((it) => [it.id, it]));
  function storedYmd(item: ViewItem): string | null {
    const d = prop === "dueDate" ? item.dueDate : prop === "scheduledDate" ? item.scheduledDate : (item.scheduledDate ?? item.dueDate);
    return d ? utcKey.format(d) : null;
  }
  const effectiveYmd = (item: ViewItem): string | null =>
    Object.prototype.hasOwnProperty.call(override, item.id) ? override[item.id] : storedYmd(item);

  // Month to show (YYYY-MM), else the current month in local time.
  const now = new Date();
  const shown = month && /^\d{4}-\d{2}$/.test(month) ? month : `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [ys, ms] = shown.split("-");
  const year = Number(ys);
  const monthNum = Number(ms); // 1-12
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNum - 1, 1)));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const onCurrentMonth = shown === `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const toParam = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  const prevMonth = toParam(new Date(Date.UTC(year, monthNum - 2, 1)));
  const nextMonth = toParam(new Date(Date.UTC(year, monthNum, 1)));

  // Complete weeks: start on the Sunday on/before the 1st, run enough rows to
  // cover the month, so leading/trailing spillover days fill the grid (no blanks).
  const gridStartYmd = addDaysYmd(`${shown}-01`, -firstWeekday);
  const rowCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const cells = Array.from({ length: rowCount * 7 }, (_, i) => {
    const ymd = addDaysYmd(gridStartYmd, i);
    return { ymd, day: Number(ymd.slice(8)), inMonth: ymd.slice(0, 7) === shown };
  });
  const cellKeys = new Set(cells.map((c) => c.ymd));

  // Bucket by effective day; undated → rail; dated outside the grid → counted.
  const byDay = new Map<string, ViewItem[]>();
  const unscheduled: ViewItem[] = [];
  let elsewhere = 0;
  for (const item of items) {
    const ymd = effectiveYmd(item);
    if (!ymd) {
      unscheduled.push(item);
      continue;
    }
    if (!cellKeys.has(ymd)) {
      elsewhere += 1;
      continue;
    }
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd)!.push(item);
  }

  async function commitDrop(id: string | null, day: string | null) {
    setDragId(null);
    setOverDay(null);
    if (!id || day === null) return;
    const item = byId.get(id);
    if (!item) return;
    const target = day === RAIL ? null : day;
    if (target === effectiveYmd(item)) return;
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

  const navLink = "rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200";

  function Chip({ item }: { item: ViewItem }) {
    const done = item.statusCategory === "done";
    const lifted = dragId === item.id;
    return (
      <div
        role="button"
        tabIndex={0}
        data-card-id={item.id}
        draggable
        title={item.title || "Untitled"}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(item.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverDay(null);
        }}
        onClick={() => router.push(`/items/${item.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/items/${item.id}`);
        }}
        className={`block cursor-grab touch-none select-none truncate rounded px-1 py-0.5 text-[11px] active:cursor-grabbing ${done ? "text-neutral-500 line-through" : "text-neutral-300"} ${lifted ? "opacity-40" : ""}`}
        style={{
          backgroundColor: "rgb(38 38 38)",
          borderLeft: item.urgency != null && item.urgency <= 2 ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        {item.title || "Untitled"}
      </div>
    );
  }

  const dropProps = (day: string) => ({
    "data-day": day,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overDay !== day) setOverDay(day);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      commitDrop(e.dataTransfer.getData("text/plain") || dragId, day);
    },
  });

  return (
    <div ref={containerRef} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <UnscheduledRail
        items={unscheduled}
        dropProps={dropProps(RAIL)}
        highlight={overDay === RAIL}
        renderChip={(item) => <Chip key={item.id} item={item} />}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-neutral-300">{monthLabel}</p>
          {navHref && (
            <div className="flex items-center gap-1 text-xs">
              <a href={`${navHref}?month=${prevMonth}`} aria-label="Previous month" className={navLink}>‹</a>
              {!onCurrentMonth && (
                <a href={navHref} className={navLink}>Today</a>
              )}
              <a href={`${navHref}?month=${nextMonth}`} aria-label="Next month" className={navLink}>›</a>
            </div>
          )}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="bg-neutral-900 px-2 py-1 text-center font-medium uppercase tracking-wide text-neutral-500">
              {d}
            </div>
          ))}
          {cells.map((cell) => {
            const dayItems = byDay.get(cell.ymd) ?? [];
            const isToday = cell.ymd === todayYmd;
            const isOver = overDay === cell.ymd;
            return (
              <div
                key={cell.ymd}
                {...dropProps(cell.ymd)}
                className={`min-h-24 p-1 ${cell.inMonth ? "bg-neutral-900" : "bg-neutral-950"}`}
                style={isOver ? { outline: "2px solid var(--accent)", outlineOffset: "-2px" } : undefined}
              >
                <div className={`mb-1 text-right text-[11px] ${isToday ? "font-bold text-neutral-100" : cell.inMonth ? "text-neutral-600" : "text-neutral-700"}`}>
                  {isToday ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1" style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" }}>
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
                    <span className="px-1 text-[11px] text-neutral-600">+{dayItems.length - 4} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {elsewhere > 0 && (
          <p className="mt-2 text-xs text-neutral-600">
            {elsewhere} scheduled item{elsewhere === 1 ? "" : "s"} outside this month — use ‹ › to find {elsewhere === 1 ? "it" : "them"}.
          </p>
        )}
      </div>
    </div>
  );
}

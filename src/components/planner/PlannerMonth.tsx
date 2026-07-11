// Interactive month grid for the Planner (ADR-131): the read-only CalendarLayout
// made draggable. Tasks are all-day chips in their day cell; drag a chip to
// another day to re-plan it, drag from the Unscheduled rail onto a day to give
// it a date, or drag back to the rail to clear it. Desktop uses native HTML5
// drag; touch uses the long-press path in usePlannerTouchDrag. Each drop is
// optimistic (local override) → PATCH /api/items/[id] → router.refresh, and
// reverts on failure. A drop announces an Undo toast; a chip carries a
// complete-in-place check; double-clicking a day's empty area captures a task.
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
import CompleteButton from "@/components/planner/CompleteButton";
import QuickCreateInput from "@/components/planner/QuickCreateInput";
import { usePlannerTouchDrag } from "@/components/planner/usePlannerTouchDrag";
import { usePlannerComplete } from "@/components/planner/usePlannerComplete";
import { usePlannerCreate } from "@/components/planner/usePlannerCreate";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { DateProperty, PlaceBy } from "@/lib/views";
import type { OverlayEvent } from "@/lib/calendar/overlay";
import type { StatusDef } from "@/lib/status";
import { urgencyRank } from "@/lib/planner-rail";
import { formatTime12, parseScheduledTime } from "@/lib/scheduled-time";

const RAIL = "__none__";
const pad = (n: number) => String(n).padStart(2, "0");
const ymdToIso = (ymd: string) => `${ymd}T00:00:00.000Z`;
const utcKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });

type Notify = (text: string, undo?: () => void) => void;

// Minutes-since-midnight of a task's floating start, or null if untimed.
function startMin(item: ViewItem): number | null {
  const st = parseScheduledTime(item.properties);
  if (!st) return null;
  const [h, m] = st.start.split(":").map(Number);
  return h * 60 + m;
}

// Day-cell order: timed tasks first (by start), then untimed by priority, then
// title — so a day reads top-to-bottom like a schedule.
function compareDay(a: ViewItem, b: ViewItem): number {
  const sa = startMin(a);
  const sb = startMin(b);
  if (sa != null && sb != null) return sa - sb || (a.title || "").localeCompare(b.title || "");
  if (sa != null) return -1;
  if (sb != null) return 1;
  return urgencyRank(a.urgency) - urgencyRank(b.urgency) || (a.title || "").localeCompare(b.title || "");
}

export default function PlannerMonth({
  items,
  prop,
  placeBy,
  month,
  navHref,
  showUnscheduled = true,
  calendarEvents,
  statuses,
  notify,
  onOpenDay,
  today,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  month?: string;
  navHref?: string;
  showUnscheduled?: boolean;
  calendarEvents?: OverlayEvent[];
  statuses?: StatusDef[];
  notify: Notify;
  onOpenDay?: (ymd: string) => void;
  // App-timezone "today" (YYYY-MM-DD) from the server, so the default month and
  // the "today" cell marker are deterministic across SSR/hydration (a
  // browser-local `new Date()` here mismatched a UTC server render).
  today: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [creatingDay, setCreatingDay] = useState<string | null>(null);
  const { effectiveDone, toggle } = usePlannerComplete(statuses, notify);
  const { create, busy: creating } = usePlannerCreate(notify);

  const field: "scheduledDate" | "dueDate" =
    prop === "dueDate" ? "dueDate" : prop === "scheduledDate" ? "scheduledDate" : placeBy === "due" ? "dueDate" : "scheduledDate";

  const byId = new Map(items.map((it) => [it.id, it]));
  function storedYmd(item: ViewItem): string | null {
    const d = prop === "dueDate" ? item.dueDate : prop === "scheduledDate" ? item.scheduledDate : (item.scheduledDate ?? item.dueDate);
    return d ? utcKey.format(d) : null;
  }
  const effectiveYmd = (item: ViewItem): string | null =>
    Object.prototype.hasOwnProperty.call(override, item.id) ? override[item.id] : storedYmd(item);

  // Month to show (YYYY-MM), else the current month (app timezone, from the
  // server-resolved `today` — never the browser's local `new Date()`, which
  // mismatched a UTC server render).
  const todayYmd = today;
  const currentMonth = today.slice(0, 7); // YYYY-MM
  const shown = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth;
  const [ys, ms] = shown.split("-");
  const year = Number(ys);
  const monthNum = Number(ms); // 1-12
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNum - 1, 1)));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
  const onCurrentMonth = shown === currentMonth;
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
  for (const list of byDay.values()) list.sort(compareDay);

  // Read-only synced calendar events, bucketed by their (app-tz) day. These are
  // context to plan around — never draggable, never editable.
  const eventsByDay = new Map<string, OverlayEvent[]>();
  for (const ev of calendarEvents ?? []) {
    if (!eventsByDay.has(ev.ymd)) eventsByDay.set(ev.ymd, []);
    eventsByDay.get(ev.ymd)!.push(ev);
  }

  // Commit a drop. `announce` off for the undo re-drop so undo doesn't re-toast.
  async function commitDrop(id: string | null, day: string | null, announce = true) {
    setDragId(null);
    setOverDay(null);
    if (!id || day === null) return;
    const item = byId.get(id);
    if (!item) return;
    const prev = effectiveYmd(item); // ymd or null (was unscheduled)
    const target = day === RAIL ? null : day;
    if (target === prev) return;
    setOverride((o) => ({ ...o, [id]: target }));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: target ? ymdToIso(target) : null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      if (announce) {
        const where = target
          ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(ymdToIso(target)))
          : "Unscheduled";
        notify(`Moved “${item.title || "Untitled"}” → ${where}`, () =>
          commitDrop(id, prev === null ? RAIL : prev, false),
        );
      }
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

  // A plain render function (NOT an inner component): returning <Chip/> from a
  // component declared in the render body gives it a new type every render, so
  // setting dragId in onDragStart would unmount/remount the dragged node and
  // cancel the native drag (the "drag twice" bug — month only, since the
  // time-grid already renders chips inline). Calling chip(item) keeps the DOM
  // node stable across the optimistic re-render.
  function chip(item: ViewItem) {
    const done = effectiveDone(item);
    const lifted = dragId === item.id;
    const st = parseScheduledTime(item.properties);
    return (
      <div
        key={item.id}
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
        className={`group flex cursor-grab touch-none select-none items-center gap-1 rounded px-1 py-0.5 text-[11px] active:cursor-grabbing ${done ? "text-neutral-500 line-through" : "text-neutral-300"} ${lifted ? "opacity-40" : ""}`}
        style={{
          backgroundColor: "rgb(38 38 38)",
          borderLeft: item.urgency != null && item.urgency <= 2 ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        <CompleteButton done={done} onToggle={() => toggle(item)} />
        {st && <span className="shrink-0 text-neutral-500">{formatTime12(st.start)}</span>}
        <span className="min-w-0 truncate">{item.title || "Untitled"}</span>
      </div>
    );
  }

  // A read-only calendar event badge: muted, a cool-toned left bar to read as
  // "calendar, not task," non-draggable. Drag/drop still works because the
  // parent day cell owns the handlers and the events bubble up through it.
  function eventBadge(ev: OverlayEvent) {
    return (
      <div
        key={ev.id}
        title={`${ev.start ? `${formatTime12(ev.start)} · ` : ""}${ev.title || "(busy)"}${ev.location ? ` · ${ev.location}` : ""}`}
        className="block cursor-default select-none truncate rounded px-1 py-0.5 text-[11px] text-neutral-400"
        style={{
          backgroundColor: "color-mix(in srgb, #38bdf8 12%, rgb(23 23 23))",
          borderLeft: "2px solid #38bdf8",
        }}
      >
        {ev.start && <span className="text-neutral-500">{formatTime12(ev.start)} </span>}
        {ev.title || "(busy)"}
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
      {showUnscheduled && (
        <UnscheduledRail
          items={unscheduled}
          dropProps={dropProps(RAIL)}
          highlight={overDay === RAIL}
          renderChip={(item) => chip(item)}
        />
      )}

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
            const dayEvents = eventsByDay.get(cell.ymd) ?? [];
            const isToday = cell.ymd === todayYmd;
            const isPast = cell.ymd < todayYmd;
            const isOver = overDay === cell.ymd;
            return (
              <div
                key={cell.ymd}
                {...dropProps(cell.ymd)}
                onDoubleClick={(e) => {
                  // Only the empty area creates — not a double-click on a chip.
                  if ((e.target as HTMLElement).closest("[data-card-id]")) return;
                  setCreatingDay(cell.ymd);
                }}
                className={`min-h-24 p-1 ${cell.inMonth ? (isPast ? "bg-neutral-950/60" : "bg-neutral-900") : "bg-neutral-950"}`}
                style={isOver ? { outline: "2px solid var(--accent)", outlineOffset: "-2px" } : undefined}
              >
                <div className={`mb-1 flex items-center justify-end text-[11px] ${isToday ? "font-bold text-neutral-100" : cell.inMonth ? (isPast ? "text-neutral-700" : "text-neutral-600") : "text-neutral-700"}`}>
                  {isToday ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1" style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" }}>
                      {cell.day}
                    </span>
                  ) : onOpenDay ? (
                    <button
                      onClick={() => onOpenDay(cell.ymd)}
                      className="rounded px-1 hover:bg-neutral-800 hover:text-neutral-300"
                      title="Open this day"
                    >
                      {cell.day}
                    </button>
                  ) : (
                    cell.day
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayEvents.slice(0, 2).map((ev) => eventBadge(ev))}
                  {dayEvents.length > 2 && (
                    <span className="px-1 text-[11px] text-neutral-600">+{dayEvents.length - 2} event{dayEvents.length - 2 === 1 ? "" : "s"}</span>
                  )}
                  {dayItems.slice(0, 4).map((item) => chip(item))}
                  {dayItems.length > 4 && (
                    onOpenDay ? (
                      <button
                        onClick={() => onOpenDay(cell.ymd)}
                        className="px-1 text-left text-[11px] text-neutral-500 hover:text-neutral-300"
                      >
                        +{dayItems.length - 4} more
                      </button>
                    ) : (
                      <span className="px-1 text-[11px] text-neutral-600">+{dayItems.length - 4} more</span>
                    )
                  )}
                  {creatingDay === cell.ymd && (
                    <QuickCreateInput
                      busy={creating}
                      placeholder="New task…"
                      onSubmit={async (title) => {
                        const ok = await create({ ymd: cell.ymd, start: null, durationMinutes: 60 }, title);
                        if (ok) setCreatingDay(null);
                      }}
                      onCancel={() => setCreatingDay(null)}
                    />
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

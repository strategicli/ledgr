// Multi-day time-grid for the Planner (ADR-131). Days are columns, the full 24h
// is rows (slotMinutes tall) in a scroll viewport that opens at the work-hours
// window but scrolls to any time; an all-day band and the day headers stay
// pinned (sticky) while you scroll. The whole grid scrolls horizontally to reach
// more days, and while dragging it auto-scrolls when the pointer nears an edge
// (Notion-style). Drag a task into a slot (day + start time), onto the band
// (day-only), or to the Unscheduled rail (clear); drag a block's bottom edge to
// resize its duration — releasing on the edge does NOT open the task.
//
// Chips/blocks are <div>s (not <Link>s) so the browser's native anchor-drag
// doesn't fight ours; click navigates. Floating local time lives in
// properties.scheduledTime; the day in scheduled_date (or due_date when placing
// by due). Desktop = HTML5 drag + pointer resize; touch = long-press move.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysYmd, ymdToUtcDate } from "@/lib/recurrence";
import { DEFAULT_DURATION_MINUTES, parseScheduledTime, startMinutes, formatTime12 } from "@/lib/scheduled-time";
import { blockHeightPx, blockTopPx, durationFromResizePx } from "@/lib/planner-grid";
import { edgeAutoScrollVelocity } from "@/lib/board-touch-drag";
import UnscheduledRail from "@/components/planner/UnscheduledRail";
import { usePlannerTouchDrag } from "@/components/planner/usePlannerTouchDrag";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { DateProperty, PlaceBy, ViewDisplay } from "@/lib/views";
import { DISPLAY_DEFAULTS } from "@/lib/views";
import type { OverlayEvent } from "@/lib/calendar/overlay";

const RAIL = "__none__";
const HOUR_PX = 48;
const GUTTER = 52; // time-label column width
const HEADER_H = 40; // day-header row height
const ALLDAY_H = 56; // all-day band height
const RANGE_DAYS = 28; // how many days are rendered for horizontal scrolling
const pad = (n: number) => String(n).padStart(2, "0");
const ymdToIso = (ymd: string) => `${ymd}T00:00:00.000Z`;
const utcKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });
const dayHeadFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

type Placement = { ymd: string | null; start: string | null; dur: number };

export default function PlannerTimeGrid({
  items,
  prop,
  placeBy,
  display,
  showUnscheduled = true,
  calendarEvents,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  display: ViewDisplay | null;
  showUnscheduled?: boolean;
  calendarEvents?: OverlayEvent[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragPos = useRef<{ x: number; y: number } | null>(null);
  const handleResizing = useRef(false);
  const justResized = useRef(false);
  const [colWidth, setColWidth] = useState(170);
  const [override, setOverride] = useState<Record<string, Placement>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const dayCount = display?.dayCount ?? DISPLAY_DEFAULTS.dayCount;
  const slotMinutes = display?.slotMinutes ?? DISPLAY_DEFAULTS.slotMinutes;
  const workStart = display?.workStartHour ?? DISPLAY_DEFAULTS.workStartHour;
  const slotPx = (HOUR_PX * slotMinutes) / 60;
  const fullRows = Math.round((24 * 60) / slotMinutes);
  const colHeight = 24 * HOUR_PX;

  const field: "scheduledDate" | "dueDate" =
    prop === "dueDate" ? "dueDate" : prop === "scheduledDate" ? "scheduledDate" : placeBy === "due" ? "dueDate" : "scheduledDate";

  const byId = new Map(items.map((it) => [it.id, it]));
  function stored(item: ViewItem): Placement {
    const d = prop === "dueDate" ? item.dueDate : prop === "scheduledDate" ? item.scheduledDate : (item.scheduledDate ?? item.dueDate);
    const st = parseScheduledTime(item.properties);
    return { ymd: d ? utcKey.format(d) : null, start: st?.start ?? null, dur: st?.durationMinutes ?? DEFAULT_DURATION_MINUTES };
  }
  const place = (item: ViewItem): Placement =>
    Object.prototype.hasOwnProperty.call(override, item.id) ? override[item.id] : stored(item);

  const todayYmd = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  })();
  const [anchor, setAnchor] = useState<string>(todayYmd);
  const days = Array.from({ length: RANGE_DAYS }, (_, i) => addDaysYmd(anchor, i));
  const dayset = new Set(days);

  const allDayByDay = new Map<string, ViewItem[]>();
  const timedByDay = new Map<string, ViewItem[]>();
  const unscheduled: ViewItem[] = [];
  for (const item of items) {
    const p = place(item);
    if (!p.ymd) {
      unscheduled.push(item);
      continue;
    }
    if (!dayset.has(p.ymd)) continue;
    const map = p.start ? timedByDay : allDayByDay;
    if (!map.has(p.ymd)) map.set(p.ymd, []);
    map.get(p.ymd)!.push(item);
  }

  // Read-only synced calendar events, split into all-day (the band) and timed
  // (positioned blocks), bucketed by their (app-tz) day. Context to plan
  // around — never draggable; timed blocks are pointer-events-none so a task
  // can still be dropped onto the slot underneath them.
  const eventAllDayByDay = new Map<string, OverlayEvent[]>();
  const eventTimedByDay = new Map<string, OverlayEvent[]>();
  for (const ev of calendarEvents ?? []) {
    if (!dayset.has(ev.ymd)) continue;
    const map = ev.start ? eventTimedByDay : eventAllDayByDay;
    if (!map.has(ev.ymd)) map.set(ev.ymd, []);
    map.get(ev.ymd)!.push(ev);
  }

  // Fit dayCount columns to the viewport; extra days overflow → horizontal scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setColWidth(Math.max(150, Math.floor((el.clientWidth - GUTTER) / dayCount)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dayCount]);

  // Open at the work-hours window (but the whole day is scrollable).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = workStart * HOUR_PX;
  }, [workStart]);

  // Edge auto-scroll while dragging (both axes), Notion-style.
  useEffect(() => {
    if (!dragId) return;
    let raf = 0;
    const tick = () => {
      const el = scrollRef.current;
      const p = dragPos.current;
      if (el && p) {
        const r = el.getBoundingClientRect();
        const left = edgeAutoScrollVelocity(p.x - r.left);
        const right = edgeAutoScrollVelocity(r.right - p.x);
        if (left > 0) el.scrollLeft -= left * 1.5;
        else if (right > 0) el.scrollLeft += right * 1.5;
        const up = edgeAutoScrollVelocity(p.y - r.top);
        const down = edgeAutoScrollVelocity(r.bottom - p.y);
        if (up > 0) el.scrollTop -= up;
        else if (down > 0) el.scrollTop += down;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragId]);

  async function commitDrop(id: string | null, key: string | null) {
    setDragId(null);
    setOverKey(null);
    if (!id || key === null) return;
    const item = byId.get(id);
    if (!item) return;
    const cur = place(item);
    let next: Placement;
    let body: Record<string, unknown>;
    if (key === RAIL) {
      next = { ymd: null, start: null, dur: cur.dur };
      body = { [field]: null, propertyPatch: { scheduledTime: null } };
    } else {
      const m = key.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/);
      if (!m) return;
      const ymd = m[1];
      const start = m[2] ?? null;
      if (ymd === cur.ymd && start === cur.start) return;
      if (start) {
        const dur = cur.dur || DEFAULT_DURATION_MINUTES;
        next = { ymd, start, dur };
        body = { [field]: ymdToIso(ymd), propertyPatch: { scheduledTime: { start, durationMinutes: dur } } };
      } else {
        next = { ymd, start: null, dur: cur.dur };
        body = { [field]: ymdToIso(ymd), propertyPatch: { scheduledTime: null } };
      }
    }
    setOverride((o) => ({ ...o, [id]: next }));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setOverride((o) => {
        const nx = { ...o };
        delete nx[id];
        return nx;
      });
    }
  }

  function startResize(e: React.PointerEvent, item: ViewItem) {
    e.preventDefault();
    e.stopPropagation();
    const p = place(item);
    if (!p.start) return;
    handleResizing.current = true;
    const startY = e.clientY;
    const startHeight = blockHeightPx(p.dur, slotMinutes, slotPx);
    let dur = p.dur;
    const move = (ev: PointerEvent) => {
      dur = durationFromResizePx(startHeight + (ev.clientY - startY), slotMinutes, slotPx);
      setOverride((o) => ({ ...o, [item.id]: { ymd: p.ymd, start: p.start, dur } }));
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      handleResizing.current = false;
      justResized.current = true; // suppress the click that follows pointerup
      try {
        const res = await fetch(`/api/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyPatch: { scheduledTime: { start: p.start, durationMinutes: dur } } }),
        });
        if (!res.ok) throw new Error(String(res.status));
        router.refresh();
      } catch {
        setOverride((o) => {
          const nx = { ...o };
          delete nx[item.id];
          return nx;
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  usePlannerTouchDrag(containerRef, {
    onArm: (id) => setDragId(id),
    onOver: (key) => setOverKey(key),
    onDrop: (key) => commitDrop(dragId, key),
    onCancel: () => {
      setDragId(null);
      setOverKey(null);
    },
  });

  const dropProps = (key: string) => ({
    "data-day": key,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overKey !== key) setOverKey(key);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      commitDrop(e.dataTransfer.getData("text/plain") || dragId, key);
    },
  });

  function dragProps(id: string) {
    return {
      "data-card-id": id,
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        if (handleResizing.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
        setDragId(id);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverKey(null);
        dragPos.current = null;
      },
      onClick: () => {
        if (justResized.current) {
          justResized.current = false;
          return;
        }
        router.push(`/items/${id}`);
      },
    };
  }

  const navBtn = "rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200";
  const totalWidth = GUTTER + days.length * colWidth;

  return (
    <div ref={containerRef} className="mt-4 flex flex-col gap-3 sm:flex-row">
      {showUnscheduled && (
      <UnscheduledRail
        items={unscheduled}
        dropProps={dropProps(RAIL)}
        highlight={overKey === RAIL}
        renderChip={(item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            title={item.title || "Untitled"}
            {...dragProps(item.id)}
            className={`block cursor-grab touch-none select-none truncate rounded px-1 py-0.5 text-[11px] text-neutral-300 ${dragId === item.id ? "opacity-40" : ""}`}
            style={{ backgroundColor: "rgb(38 38 38)" }}
          >
            {item.title || "Untitled"}
          </div>
        )}
      />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-neutral-300">
            {dayHeadFmt.format(ymdToUtcDate(days[0]))} {Number(days[0].slice(8))} — scroll for more days →
          </p>
          <div className="flex items-center gap-1 text-xs">
            <button onClick={() => setAnchor(addDaysYmd(anchor, -dayCount))} aria-label="Previous" className={navBtn}>‹</button>
            {anchor !== todayYmd && (
              <button onClick={() => setAnchor(todayYmd)} className={navBtn}>Today</button>
            )}
            <button onClick={() => setAnchor(addDaysYmd(anchor, dayCount))} aria-label="Next" className={navBtn}>›</button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onDragOver={(e) => {
            e.preventDefault();
            dragPos.current = { x: e.clientX, y: e.clientY };
          }}
          className="mt-2 max-h-[70vh] overflow-auto rounded-lg border border-neutral-800"
        >
          <div style={{ width: totalWidth }}>
            {/* Day headers (sticky top) */}
            <div className="sticky top-0 z-20 flex bg-neutral-900" style={{ height: HEADER_H }}>
              <div className="sticky left-0 z-30 shrink-0 bg-neutral-900" style={{ width: GUTTER }} />
              {days.map((ymd) => {
                const isToday = ymd === todayYmd;
                return (
                  <div key={ymd} className="shrink-0 border-l border-neutral-800 py-1 text-center" style={{ width: colWidth }}>
                    <span className="text-[10px] uppercase tracking-wide text-neutral-500">{dayHeadFmt.format(ymdToUtcDate(ymd))} </span>
                    <span className={`text-xs ${isToday ? "font-bold text-neutral-100" : "text-neutral-400"}`}>
                      {isToday ? (
                        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1" style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" }}>{Number(ymd.slice(8))}</span>
                      ) : (
                        Number(ymd.slice(8))
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* All-day band (sticky, just below the headers) */}
            <div className="sticky z-10 flex border-b border-neutral-800 bg-neutral-950" style={{ top: HEADER_H, height: ALLDAY_H }}>
              <div className="sticky left-0 z-20 flex shrink-0 items-start justify-end bg-neutral-950 py-1 pr-1 text-[10px] text-neutral-600" style={{ width: GUTTER }}>all-day</div>
              {days.map((ymd) => (
                <div
                  key={ymd}
                  {...dropProps(ymd)}
                  className="shrink-0 overflow-y-auto border-l border-neutral-800 p-1"
                  style={{ width: colWidth, height: ALLDAY_H, ...(overKey === ymd ? { outline: "2px solid var(--accent)", outlineOffset: "-2px" } : {}) }}
                >
                  <div className="flex flex-col gap-0.5">
                    {(eventAllDayByDay.get(ymd) ?? []).map((ev) => (
                      <div
                        key={ev.id}
                        title={`${ev.title || "(busy)"}${ev.location ? ` · ${ev.location}` : ""}`}
                        className="block cursor-default select-none truncate rounded px-1 text-[11px] text-neutral-400"
                        style={{
                          backgroundColor: "color-mix(in srgb, #38bdf8 12%, rgb(23 23 23))",
                          borderLeft: "2px solid #38bdf8",
                        }}
                      >
                        {ev.title || "(busy)"}
                      </div>
                    ))}
                    {(allDayByDay.get(ymd) ?? []).map((item) => (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        title={item.title || "Untitled"}
                        {...dragProps(item.id)}
                        className={`block cursor-grab touch-none select-none truncate rounded px-1 text-[11px] text-neutral-300 ${dragId === item.id ? "opacity-40" : ""}`}
                        style={{ backgroundColor: "rgb(38 38 38)" }}
                      >
                        {item.title || "Untitled"}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Time body */}
            <div className="flex">
              {/* Hour gutter (sticky left) */}
              <div className="sticky left-0 z-10 shrink-0 bg-neutral-900" style={{ width: GUTTER, height: colHeight }}>
                <div className="relative h-full">
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} className="absolute right-1 text-[10px] text-neutral-600" style={{ top: h * HOUR_PX - 6 }}>
                      {h === 0 ? "" : formatTime12(`${pad(h)}:00`).replace(":00", "")}
                    </span>
                  ))}
                </div>
              </div>
              {/* Day columns */}
              {days.map((ymd) => (
                <div key={ymd} className="relative shrink-0 border-l border-neutral-800" style={{ width: colWidth, height: colHeight }}>
                  {Array.from({ length: fullRows }, (_, r) => {
                    const hhmm = `${pad(Math.floor((r * slotMinutes) / 60))}:${pad((r * slotMinutes) % 60)}`;
                    const key = `${ymd}T${hhmm}`;
                    const onHour = (r * slotMinutes) % 60 === 0;
                    return (
                      <div
                        key={r}
                        {...dropProps(key)}
                        className={onHour ? "border-b border-neutral-800/50" : "border-b border-neutral-800/20"}
                        style={{ height: slotPx, ...(overKey === key ? { background: "color-mix(in srgb, var(--accent) 22%, transparent)" } : {}) }}
                      />
                    );
                  })}
                  {(eventTimedByDay.get(ymd) ?? []).map((ev) => {
                    if (!ev.start) return null;
                    const top = Math.max(0, blockTopPx(startMinutes({ start: ev.start, durationMinutes: ev.durationMinutes }), 0, slotMinutes, slotPx));
                    const height = blockHeightPx(ev.durationMinutes, slotMinutes, slotPx);
                    // pointer-events-none: purely visual context, so a task can
                    // still be dropped onto the slot underneath an event.
                    return (
                      <div
                        key={ev.id}
                        title={`${formatTime12(ev.start)} · ${ev.title || "(busy)"}${ev.location ? ` · ${ev.location}` : ""}`}
                        className="pointer-events-none absolute left-0.5 right-0.5 z-0 overflow-hidden rounded px-1 text-[11px] text-neutral-300"
                        style={{
                          top,
                          height,
                          backgroundColor: "color-mix(in srgb, #38bdf8 14%, rgb(23 23 23))",
                          borderLeft: "2px solid #38bdf8",
                        }}
                      >
                        <div className="truncate">{ev.title || "(busy)"}</div>
                        <div className="truncate text-[10px] text-neutral-500">{formatTime12(ev.start)}</div>
                      </div>
                    );
                  })}
                  {(timedByDay.get(ymd) ?? []).map((item) => {
                    const p = place(item);
                    if (!p.start) return null;
                    const top = Math.max(0, blockTopPx(startMinutes({ start: p.start, durationMinutes: p.dur }), 0, slotMinutes, slotPx));
                    const height = blockHeightPx(p.dur, slotMinutes, slotPx);
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        title={item.title || "Untitled"}
                        {...dragProps(item.id)}
                        className={`absolute left-0.5 right-0.5 overflow-hidden rounded px-1 text-[11px] text-neutral-100 ${dragId === item.id ? "opacity-40" : ""}`}
                        style={{ top, height, backgroundColor: "color-mix(in srgb, var(--accent) 30%, rgb(23 23 23))", borderLeft: "2px solid var(--accent)" }}
                      >
                        <div className="truncate">{item.title || "Untitled"}</div>
                        <div className="truncate text-[10px] text-neutral-400">{formatTime12(p.start)}</div>
                        <div
                          onPointerDown={(e) => startResize(e, item)}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                          style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }}
                          aria-label="Resize"
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

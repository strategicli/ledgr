// Multi-day time-grid for the Planner (ADR-131): days as columns, time as rows
// (slotMinutes tall), an all-day band on top, and the Unscheduled rail. Drag a
// task into a slot to give it a day + start time, onto the all-day band to keep
// it day-only, or to the rail to clear it; drag a timed block's bottom edge to
// set its duration. Floating local time lives in properties.scheduledTime
// (scheduled-time.ts); the day lives in scheduled_date (or due_date when the
// view places by due). Same optimistic PATCH → router.refresh shape as the
// month grid. Desktop = HTML5 drag + pointer resize; touch = long-press move
// (usePlannerTouchDrag), reusing the composite data-day drop keys.
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysYmd, ymdToUtcDate } from "@/lib/recurrence";
import {
  DEFAULT_DURATION_MINUTES,
  parseScheduledTime,
  startMinutes,
  formatTime12,
} from "@/lib/scheduled-time";
import {
  blockHeightPx,
  blockTopPx,
  durationFromResizePx,
  slotCount,
  slotStartHhmm,
} from "@/lib/planner-grid";
import { usePlannerTouchDrag } from "@/components/planner/usePlannerTouchDrag";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { DateProperty, PlaceBy, ViewDisplay } from "@/lib/views";
import { DISPLAY_DEFAULTS } from "@/lib/views";

const RAIL = "__none__";
const HOUR_PX = 44;
const pad = (n: number) => String(n).padStart(2, "0");
const ymdToIso = (ymd: string) => `${ymd}T00:00:00.000Z`;
const utcKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });
const dayHeadFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const rangeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Placement = { ymd: string | null; start: string | null; dur: number };

export default function PlannerTimeGrid({
  items,
  prop,
  placeBy,
  display,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  display: ViewDisplay | null;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [override, setOverride] = useState<Record<string, Placement>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const dayCount = display?.dayCount ?? DISPLAY_DEFAULTS.dayCount;
  const slotMinutes = display?.slotMinutes ?? DISPLAY_DEFAULTS.slotMinutes;
  const workStart = display?.workStartHour ?? DISPLAY_DEFAULTS.workStartHour;
  const workEnd = display?.workEndHour ?? DISPLAY_DEFAULTS.workEndHour;
  const slotPx = (HOUR_PX * slotMinutes) / 60;
  const rows = slotCount(workStart, workEnd, slotMinutes);
  const colHeight = rows * slotPx;

  const field: "scheduledDate" | "dueDate" =
    prop === "dueDate"
      ? "dueDate"
      : prop === "scheduledDate"
        ? "scheduledDate"
        : placeBy === "due"
          ? "dueDate"
          : "scheduledDate";

  const todayYmd = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  })();
  const [anchor, setAnchor] = useState<string>(todayYmd);
  const days = Array.from({ length: dayCount }, (_, i) => addDaysYmd(anchor, i));

  const byId = new Map(items.map((it) => [it.id, it]));
  function stored(item: ViewItem): Placement {
    const d = prop === "dueDate" ? item.dueDate : prop === "scheduledDate" ? item.scheduledDate : (item.scheduledDate ?? item.dueDate);
    const st = parseScheduledTime(item.properties);
    return { ymd: d ? utcKey.format(d) : null, start: st?.start ?? null, dur: st?.durationMinutes ?? DEFAULT_DURATION_MINUTES };
  }
  const place = (item: ViewItem): Placement =>
    Object.prototype.hasOwnProperty.call(override, item.id) ? override[item.id] : stored(item);

  const allDayByDay = new Map<string, ViewItem[]>();
  const timedByDay = new Map<string, ViewItem[]>();
  const unscheduled: ViewItem[] = [];
  for (const item of items) {
    const p = place(item);
    if (!p.ymd) {
      unscheduled.push(item);
      continue;
    }
    if (!days.includes(p.ymd)) continue; // dated outside the visible window
    const map = p.start ? timedByDay : allDayByDay;
    if (!map.has(p.ymd)) map.set(p.ymd, []);
    map.get(p.ymd)!.push(item);
  }

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
      if (ymd === cur.ymd && start === cur.start) return; // no change
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

  // Resize a timed block by dragging its bottom edge (desktop pointer).
  function startResize(e: React.PointerEvent, item: ViewItem) {
    e.preventDefault();
    e.stopPropagation();
    const p = place(item);
    if (!p.start) return;
    const startY = e.clientY;
    const startHeight = blockHeightPx(p.dur, slotMinutes, slotPx);
    const move = (ev: PointerEvent) => {
      const dur = durationFromResizePx(startHeight + (ev.clientY - startY), slotMinutes, slotPx);
      setOverride((o) => ({ ...o, [item.id]: { ...p, ...(o[item.id] ?? {}), ymd: p.ymd, start: p.start, dur } }));
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Read the freshest duration from the override we've been setting.
      let dur = p.dur;
      setOverride((o) => {
        dur = o[item.id]?.dur ?? p.dur;
        return o;
      });
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

  function dragChipProps(id: string) {
    return {
      "data-card-id": id,
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
        setDragId(id);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverKey(null);
      },
    };
  }

  const navBtn = "rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200";
  const rangeLabel = `${rangeFmt.format(ymdToUtcDate(days[0]))} – ${rangeFmt.format(ymdToUtcDate(days[days.length - 1]))}`;
  // Hour labels: one per 60 minutes down the gutter.
  const hourRows = Math.max(1, Math.round(60 / slotMinutes));

  return (
    <div ref={containerRef} className="mt-4 flex flex-col gap-3 sm:flex-row">
      {/* Unscheduled rail */}
      <aside
        {...dropProps(RAIL)}
        className={`shrink-0 rounded-lg border p-2 sm:w-44 ${
          overKey === RAIL ? "border-[color:var(--accent)]" : "border-neutral-800"
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Unscheduled</span>
          <span className="rounded-full bg-neutral-800 px-1.5 text-[11px] text-neutral-400">{unscheduled.length}</span>
        </div>
        <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
          {unscheduled.length === 0 ? (
            <p className="text-[11px] text-neutral-600">Nothing waiting.</p>
          ) : (
            unscheduled.map((item) => (
              <Link
                key={item.id}
                href={`/items/${item.id}`}
                title={item.title || "Untitled"}
                {...dragChipProps(item.id)}
                className={`block cursor-grab touch-none select-none truncate rounded px-1 py-0.5 text-[11px] text-neutral-300 ${dragId === item.id ? "opacity-40" : ""}`}
                style={{ backgroundColor: "rgb(38 38 38)" }}
              >
                {item.title || "Untitled"}
              </Link>
            ))
          )}
        </div>
      </aside>

      {/* Grid */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-neutral-300">{rangeLabel}</p>
          <div className="flex items-center gap-1 text-xs">
            <button onClick={() => setAnchor(addDaysYmd(anchor, -dayCount))} aria-label="Previous" className={navBtn}>‹</button>
            {anchor !== todayYmd && (
              <button onClick={() => setAnchor(todayYmd)} className={navBtn}>Today</button>
            )}
            <button onClick={() => setAnchor(addDaysYmd(anchor, dayCount))} aria-label="Next" className={navBtn}>›</button>
          </div>
        </div>

        <div className="mt-2 overflow-hidden rounded-lg border border-neutral-800">
          {/* Day headers */}
          <div className="flex border-b border-neutral-800 bg-neutral-900">
            <div className="w-12 shrink-0" />
            {days.map((ymd) => {
              const isToday = ymd === todayYmd;
              return (
                <div key={ymd} className="flex-1 border-l border-neutral-800 py-1 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">{dayHeadFmt.format(ymdToUtcDate(ymd))}</div>
                  <div className={`text-xs ${isToday ? "font-bold text-neutral-100" : "text-neutral-400"}`}>
                    {isToday ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1" style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" }}>{Number(ymd.slice(8))}</span>
                    ) : (
                      Number(ymd.slice(8))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* All-day band */}
          <div className="flex border-b border-neutral-800 bg-neutral-950">
            <div className="flex w-12 shrink-0 items-start justify-end py-1 pr-1 text-[10px] text-neutral-600">all-day</div>
            {days.map((ymd) => (
              <div
                key={ymd}
                {...dropProps(ymd)}
                className="min-h-9 flex-1 border-l border-neutral-800 p-1"
                style={overKey === ymd ? { outline: "2px solid var(--accent)", outlineOffset: "-2px" } : undefined}
              >
                <div className="flex flex-col gap-0.5">
                  {(allDayByDay.get(ymd) ?? []).map((item) => (
                    <Link
                      key={item.id}
                      href={`/items/${item.id}`}
                      title={item.title || "Untitled"}
                      {...dragChipProps(item.id)}
                      className={`block cursor-grab touch-none select-none truncate rounded px-1 text-[11px] text-neutral-300 ${dragId === item.id ? "opacity-40" : ""}`}
                      style={{ backgroundColor: "rgb(38 38 38)" }}
                    >
                      {item.title || "Untitled"}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Time body */}
          <div className="flex max-h-[60vh] overflow-y-auto bg-neutral-900">
            {/* Hour gutter */}
            <div className="w-12 shrink-0">
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="relative border-b border-neutral-800/40 text-right" style={{ height: slotPx }}>
                  {r % hourRows === 0 && (
                    <span className="absolute -top-1.5 right-1 text-[10px] text-neutral-600">
                      {formatTime12(slotStartHhmm(r, workStart, slotMinutes)).replace(":00", "")}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {/* Day columns */}
            {days.map((ymd) => (
              <div key={ymd} className="relative flex-1 border-l border-neutral-800" style={{ height: colHeight }}>
                {/* slot cells (drop targets) */}
                {Array.from({ length: rows }, (_, r) => {
                  const key = `${ymd}T${slotStartHhmm(r, workStart, slotMinutes)}`;
                  return (
                    <div
                      key={r}
                      {...dropProps(key)}
                      className="border-b border-neutral-800/40"
                      style={{ height: slotPx, ...(overKey === key ? { background: "color-mix(in srgb, var(--accent) 22%, transparent)" } : {}) }}
                    />
                  );
                })}
                {/* timed blocks */}
                {(timedByDay.get(ymd) ?? []).map((item) => {
                  const p = place(item);
                  if (!p.start) return null;
                  const top = Math.max(0, blockTopPx(startMinutes({ start: p.start, durationMinutes: p.dur }), workStart, slotMinutes, slotPx));
                  const height = blockHeightPx(p.dur, slotMinutes, slotPx);
                  return (
                    <Link
                      key={item.id}
                      href={`/items/${item.id}`}
                      title={item.title || "Untitled"}
                      {...dragChipProps(item.id)}
                      className={`absolute left-0.5 right-0.5 overflow-hidden rounded px-1 text-[11px] text-neutral-100 ${dragId === item.id ? "opacity-40" : ""}`}
                      style={{
                        top,
                        height,
                        backgroundColor: "color-mix(in srgb, var(--accent) 30%, rgb(23 23 23))",
                        borderLeft: "2px solid var(--accent)",
                      }}
                    >
                      <div className="truncate">{item.title || "Untitled"}</div>
                      <div className="truncate text-[10px] text-neutral-400">{formatTime12(p.start)}</div>
                      {/* resize handle */}
                      <div
                        onPointerDown={(e) => startResize(e, item)}
                        onClick={(e) => e.preventDefault()}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                        style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }}
                        aria-label="Resize"
                      />
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

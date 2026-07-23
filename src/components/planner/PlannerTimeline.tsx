// Timeline mode (ADR-166): one continuous horizontal time axis, zoomable from
// Hour to 5-Year, that renders ANY dated item via the placement layer. A
// single-date item is a chip on its day; a start+end item is a bar; overlapping
// items pack into vertical lanes (so the region grows taller). This slice is
// READ-ONLY (drag + edge-resize land in slice 4); it consumes placements and
// never reads a date field directly, so it works for tasks, events, notes, and
// custom date props alike.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CompleteButton from "@/components/planner/CompleteButton";
import UnscheduledRail from "@/components/planner/UnscheduledRail";
import { usePlannerComplete } from "@/components/planner/usePlannerComplete";
import {
  resolvePlacement,
  type DateRef,
  type PlaceableItem,
  type PlacementSpec,
} from "@/lib/placement";
import {
  addDays,
  dateToX,
  daysBetween,
  pxPerDay,
  ticks,
} from "@/lib/timeline-geometry";
import { layoutOverlaps } from "@/lib/planner-overlap";
import { formatTime12 } from "@/lib/scheduled-time";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { DateProperty, PlaceBy, ViewDisplay, TimelineZoom } from "@/lib/views";
import { DISPLAY_DEFAULTS, TIMELINE_ZOOMS } from "@/lib/views";
import type { OverlayEvent } from "@/lib/calendar/overlay";
import type { StatusDef } from "@/lib/status";

type Notify = (text: string, undo?: () => void) => void;

const LANE_H = 32; // px per stacked lane (row), including its gap
const CHIP_MIN = 120; // min chip/bar width so a point stays readable + grabbable
const RULER_H = 34;

// Days of breathing room on each side of the data range, per zoom.
const PAD: Record<TimelineZoom, number> = {
  hour: 1,
  day: 2,
  week: 5,
  month: 14,
  quarter: 45,
  year: 120,
  halfDecade: 365,
};
// A friendly label for the zoom buttons.
const ZOOM_LABEL: Record<TimelineZoom, string> = {
  hour: "Hour",
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  halfDecade: "5-Year",
};

// Derive the placement spec from the view's date property + any explicit
// start/end fields (ADR-166). A meeting anchors to its end_at; a scheduled/plan
// task pairs with its due date (chip if only one is set, bar if both).
function deriveSpec(prop: DateProperty | null, display: ViewDisplay | null): PlacementSpec {
  const start: DateRef = display?.startField ?? (prop ? { field: prop } : { field: "plan" });
  let end: DateRef | undefined = display?.endField ?? undefined;
  if (!end && "field" in start) {
    if (start.field === "meetingAt") end = { field: "endAt" };
    else if (start.field === "scheduledDate" || start.field === "plan") end = { field: "dueDate" };
  }
  return { start, end };
}

export default function PlannerTimeline({
  items,
  prop,
  display,
  showUnscheduled,
  statuses,
  notify,
  today,
  tz,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  display: ViewDisplay | null;
  showUnscheduled: boolean;
  calendarEvents?: OverlayEvent[];
  statuses?: StatusDef[];
  notify: Notify;
  today: string;
  tz: string;
}) {
  const [zoom, setZoom] = useState<TimelineZoom>(display?.zoom ?? DISPLAY_DEFAULTS.zoom);
  const { effectiveDone, toggle } = usePlannerComplete(statuses, notify);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spec = useMemo(() => deriveSpec(prop, display), [prop, display]);

  // Resolve every item to a placement; split placed (on the axis) from unplaced
  // (the rail). Placements are pure, so this recomputes cheaply on zoom change.
  const { placed, rail } = useMemo(() => {
    const placed: { item: ViewItem; start: { ymd: string; minutes: number | null }; end: { ymd: string; minutes: number | null } | null }[] = [];
    const rail: ViewItem[] = [];
    for (const item of items) {
      const p = resolvePlacement(item as unknown as PlaceableItem, spec, tz);
      if (p.start) placed.push({ item, start: p.start, end: p.end });
      else rail.push(item);
    }
    return { placed, rail };
  }, [items, spec, tz]);

  // The axis window: the data range (plus today) padded by the zoom, clamped so a
  // fine zoom over a wide range can't blow up the canvas width.
  const ppd = pxPerDay(zoom);
  const { originYmd, spanDays } = useMemo(() => {
    let min = today;
    let max = today;
    for (const p of placed) {
      if (p.start.ymd < min) min = p.start.ymd;
      if (p.start.ymd > max) max = p.start.ymd;
      if (p.end) {
        if (p.end.ymd < min) min = p.end.ymd;
        if (p.end.ymd > max) max = p.end.ymd;
      }
    }
    let origin = addDays(min, -PAD[zoom]);
    const rawSpan = daysBetween(origin, addDays(max, PAD[zoom])) + 1;
    const maxSpan = Math.max(7, Math.floor(60000 / ppd));
    if (rawSpan > maxSpan) {
      origin = addDays(today, -Math.floor(maxSpan / 2));
      return { originYmd: origin, spanDays: maxSpan };
    }
    return { originYmd: origin, spanDays: rawSpan };
  }, [placed, today, zoom, ppd]);

  const contentWidth = spanDays * ppd;
  const ruler = useMemo(() => ticks(originYmd, spanDays, zoom), [originYmd, spanDays, zoom]);

  // Lane-pack placed items by their pixel intervals so overlaps stack vertically.
  const { boxes, laneCount } = useMemo(() => {
    const intervals = placed.map((p) => {
      const sx = dateToX(p.start.ymd, p.start.minutes, originYmd, zoom);
      const ex = p.end ? dateToX(p.end.ymd, p.end.minutes, originYmd, zoom) : sx;
      const width = Math.max(CHIP_MIN, ex - sx);
      return { id: p.item.id, sx, width };
    });
    const layout = layoutOverlaps(
      intervals.map((i) => ({ id: i.id, startMin: i.sx, endMin: i.sx + i.width })),
    );
    const boxes = placed.map((p, i) => {
      const iv = intervals[i];
      const lay = layout.get(p.item.id) ?? { left: 0, width: 1 };
      const lanes = Math.max(1, Math.round(1 / lay.width));
      const lane = Math.round(lay.left / lay.width);
      return { p, sx: iv.sx, width: iv.width, lane, lanes, isBar: p.end != null };
    });
    const laneCount = boxes.reduce((m, b) => Math.max(m, b.lanes), 1);
    return { boxes, laneCount };
  }, [placed, originYmd, zoom]);

  const todayX = dateToX(today, null, originYmd, zoom);

  // Center the view on today after mount + whenever the zoom changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
  }, [todayX, zoom]);

  const zoomBtn = (z: TimelineZoom) => (
    <button
      key={z}
      onClick={() => setZoom(z)}
      aria-pressed={zoom === z}
      className={`rounded px-2 py-0.5 text-[11px] ${
        zoom === z ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
      style={zoom === z ? { backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" } : undefined}
    >
      {ZOOM_LABEL[z]}
    </button>
  );

  const railDrop = {}; // read-only for this slice; drag lands in slice 4

  return (
    <div className="mt-2">
      <div className="mb-2 flex items-center gap-1">
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-neutral-800 p-0.5">
          {TIMELINE_ZOOMS.map(zoomBtn)}
        </div>
        <button
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
          }}
          className="ml-2 rounded border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200"
        >
          Today
        </button>
      </div>

      <div className="flex gap-2">
        {showUnscheduled && (
          <UnscheduledRail
            items={rail}
            dropProps={railDrop}
            highlight={false}
            renderChip={(item) => (
              <div className="flex items-center gap-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-300">
                <CompleteButton done={effectiveDone(item)} onToggle={() => toggle(item)} />
                <span className="min-w-0 truncate">{item.title || "Untitled"}</span>
              </div>
            )}
          />
        )}

        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-neutral-800"
        >
          <div className="relative" style={{ width: contentWidth }}>
            {/* Ruler */}
            <div className="sticky top-0 z-20 bg-neutral-900" style={{ height: RULER_H }}>
              {ruler.map((t, i) => (
                <div
                  key={i}
                  className="absolute top-0 flex h-full flex-col justify-end border-l pb-1 pl-1"
                  style={{
                    left: t.x,
                    borderColor: t.major ? "rgb(64 64 64)" : "rgb(38 38 38)",
                  }}
                >
                  <span className={`whitespace-nowrap text-[10px] ${t.major ? "text-neutral-300" : "text-neutral-600"}`}>
                    {t.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Lanes area */}
            <div className="relative" style={{ height: Math.max(LANE_H * laneCount + 8, 80) }}>
              {/* gridlines under items */}
              {ruler.map((t, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l"
                  style={{ left: t.x, borderColor: t.major ? "rgb(38 38 38)" : "rgb(28 28 28)" }}
                />
              ))}
              {/* today line */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10 border-l-2"
                style={{ left: todayX, borderColor: "var(--accent)" }}
              />
              {/* items */}
              {boxes.map(({ p, sx, width, lane, isBar }) => {
                const done = effectiveDone(p.item);
                return (
                  <div
                    key={p.item.id}
                    title={p.item.title || "Untitled"}
                    className={`absolute z-[1] flex items-center gap-1 overflow-hidden rounded px-1 text-[11px] ${
                      done ? "text-neutral-500 line-through" : "text-neutral-100"
                    }`}
                    style={{
                      left: sx,
                      width,
                      top: lane * LANE_H,
                      height: LANE_H - 4,
                      backgroundColor: isBar
                        ? "color-mix(in srgb, var(--accent) 22%, rgb(23 23 23))"
                        : "color-mix(in srgb, var(--accent) 30%, rgb(23 23 23))",
                      borderLeft: "2px solid var(--accent)",
                    }}
                  >
                    <CompleteButton done={done} onToggle={() => toggle(p.item)} />
                    <span className="min-w-0 truncate">{p.item.title || "Untitled"}</span>
                    {p.start.minutes != null && (
                      <span className="shrink-0 text-[10px] text-neutral-400">
                        {formatTime12(minToHhmm(p.start.minutes))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {placed.length === 0 && (
        <p className="mt-3 px-2 text-sm text-neutral-600">
          Nothing to place on the timeline for this view{rail.length ? " (all items are undated — toggle “Show unscheduled”)" : ""}.
        </p>
      )}
    </div>
  );
}

function minToHhmm(minutes: number): string {
  const within = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(within / 60)).padStart(2, "0")}:${String(within % 60).padStart(2, "0")}`;
}

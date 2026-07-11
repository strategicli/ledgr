// Planner shell (ADR-131): a thin client wrapper that switches between the
// month grid and the multi-day time-grid. The view's display.mode sets the
// initial mode; the toggle changes it for the session (persisting per-view is a
// later step — system views can't be edited, and a quick toggle shouldn't write
// anyway). Both children are self-contained (own nav + Unscheduled rail); this
// owns the mode segmented control, the multi-day anchor (lifted so month's
// "+N more" can open a day in the time-grid), and the shared action toast.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PlannerMonth from "@/components/planner/PlannerMonth";
import PlannerTimeGrid from "@/components/planner/PlannerTimeGrid";
import PlannerToast, { type PlannerToastMsg } from "@/components/planner/PlannerToast";
import type { DateProperty, PlaceBy, ViewDisplay, CalendarMode } from "@/lib/views";
import { DISPLAY_DEFAULTS } from "@/lib/views";
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { OverlayEvent } from "@/lib/calendar/overlay";
import type { StatusDef } from "@/lib/status";

export default function PlannerCalendar({
  items,
  prop,
  placeBy,
  display,
  month,
  navHref,
  calendarEvents,
  statuses,
  today,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  display: ViewDisplay | null;
  month?: string;
  navHref?: string;
  calendarEvents?: OverlayEvent[];
  statuses?: StatusDef[];
  // App-timezone "today" (YYYY-MM-DD), resolved server-side and passed down so
  // SSR and the client's first render agree (a browser-local `new Date()` here
  // mismatched a UTC server render — a hydration warning). Seeds the time-grid
  // anchor and both sub-views' "today" marker.
  today: string;
}) {
  const [mode, setMode] = useState<CalendarMode>(display?.mode ?? DISPLAY_DEFAULTS.mode);
  // The multi-day time-grid's leftmost day, lifted here so the month grid can
  // jump to a specific day ("+N more" / a day number → open that day in the
  // time-grid). Owned by the shell; both are passed to the time-grid.
  const [anchor, setAnchor] = useState<string>(today);
  // Show/hide tasks with no due/scheduled date (the Unscheduled rail). Off by
  // default — most days you want to see only what's already placed; persisted
  // per browser so the choice sticks.
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  // Overlay the read-only synced calendar (what's already scheduled) so you can
  // plan tasks around it. Seeded from the view's display.showCalendar so a view
  // can default it on; the per-browser toggle then overrides for the session.
  const [showCalendar, setShowCalendar] = useState(display?.showCalendar ?? false);
  // One toast at a time; a new action replaces it. Monotonic id restarts the
  // dismiss timer even on identical text.
  const toastId = useRef(0);
  const [toast, setToast] = useState<PlannerToastMsg | null>(null);
  const notify = useCallback((text: string, undo?: () => void) => {
    setToast({ id: ++toastId.current, text, undo });
  }, []);

  useEffect(() => {
    // Read after mount, not in a lazy initializer: localStorage isn't available
    // during SSR, and reading it in the initializer would cause a hydration
    // mismatch. This is the intended client-only-preference pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowUnscheduled(localStorage.getItem("planner:showUnscheduled") === "1");
    const cal = localStorage.getItem("planner:showCalendar");
    if (cal != null) setShowCalendar(cal === "1");
  }, []);
  function toggleUnscheduled(v: boolean) {
    setShowUnscheduled(v);
    try {
      localStorage.setItem("planner:showUnscheduled", v ? "1" : "0");
    } catch {
      /* ignore storage failures */
    }
  }
  function toggleCalendar(v: boolean) {
    setShowCalendar(v);
    try {
      localStorage.setItem("planner:showCalendar", v ? "1" : "0");
    } catch {
      /* ignore storage failures */
    }
  }
  // Open a specific day in the multi-day time-grid (from the month grid).
  const openDay = useCallback((ymd: string) => {
    setAnchor(ymd);
    setMode("timegrid");
  }, []);
  // Only hand the grids events when the overlay is on (toggle off = no blocks).
  const overlay = showCalendar ? calendarEvents : undefined;

  const seg = (m: CalendarMode, label: string) => (
    <button
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`rounded px-2 py-0.5 text-xs ${
        mode === m ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
      style={mode === m ? { backgroundColor: "var(--accent)", color: "var(--accent-fg, #fff)" } : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-800 p-0.5">
          {seg("month", "Month")}
          {seg("timegrid", "Multi-day")}
        </div>
        <span className="ml-2 text-[11px] text-neutral-600">
          Drag to plan · {mode === "timegrid" ? "click a slot to add · " : "double-click a day to add · "}
          places by {placeBy === "due" ? "due date" : "scheduled date"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-400">
            <input
              type="checkbox"
              checked={showCalendar}
              onChange={(e) => toggleCalendar(e.target.checked)}
            />
            Show calendar
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-400">
            <input
              type="checkbox"
              checked={showUnscheduled}
              onChange={(e) => toggleUnscheduled(e.target.checked)}
            />
            Show unscheduled
          </label>
        </div>
      </div>
      {showCalendar && (calendarEvents?.length ?? 0) === 0 && (
        <p className="mt-1 text-[11px] text-neutral-600">
          No synced calendar events in this range. Calendar sync reaches about
          two weeks ahead.
        </p>
      )}
      {mode === "month" ? (
        <PlannerMonth items={items} prop={prop} placeBy={placeBy} month={month} navHref={navHref} showUnscheduled={showUnscheduled} calendarEvents={overlay} statuses={statuses} notify={notify} onOpenDay={openDay} today={today} />
      ) : (
        <PlannerTimeGrid items={items} prop={prop} placeBy={placeBy} display={display} showUnscheduled={showUnscheduled} calendarEvents={overlay} statuses={statuses} notify={notify} anchor={anchor} setAnchor={setAnchor} today={today} />
      )}
      <PlannerToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// Planner shell (ADR-131): a thin client wrapper that switches between the
// month grid and the multi-day time-grid. The view's display.mode sets the
// initial mode; the toggle changes it for the session (persisting per-view is a
// later step — system views can't be edited, and a quick toggle shouldn't write
// anyway). Both children are self-contained (own nav + Unscheduled rail); this
// only owns the mode segmented control.
"use client";

import { useState } from "react";
import PlannerMonth from "@/components/planner/PlannerMonth";
import PlannerTimeGrid from "@/components/planner/PlannerTimeGrid";
import type { DateProperty, PlaceBy, ViewDisplay, CalendarMode } from "@/lib/views";
import { DISPLAY_DEFAULTS } from "@/lib/views";
import type { ViewItem } from "@/components/views/ViewRenderer";

export default function PlannerCalendar({
  items,
  prop,
  placeBy,
  display,
  month,
  navHref,
}: {
  items: ViewItem[];
  prop: DateProperty | null;
  placeBy: PlaceBy;
  display: ViewDisplay | null;
  month?: string;
  navHref?: string;
}) {
  const [mode, setMode] = useState<CalendarMode>(display?.mode ?? DISPLAY_DEFAULTS.mode);

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
          Drag to plan · places by {placeBy === "due" ? "due date" : "scheduled date"}
        </span>
      </div>
      {mode === "month" ? (
        <PlannerMonth items={items} prop={prop} placeBy={placeBy} month={month} navHref={navHref} />
      ) : (
        <PlannerTimeGrid items={items} prop={prop} placeBy={placeBy} display={display} />
      )}
    </div>
  );
}

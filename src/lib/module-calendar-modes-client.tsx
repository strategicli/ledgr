// The browser-safe half of the `calendarModes` slot (ADR-287): a mode id → the
// module's client component, fed the plain data module-calendar-modes.tsx
// prepared on the server. ViewRenderer imports this, and dashboards mount
// ViewRenderer in the browser, so nothing here may touch the server.
import type { ComponentType } from "react";
import YearMapClient, { type YearMapProps } from "@/modules/year-map/YearMapClient";

const CALENDAR_MODE_VIEWS: Record<string, ComponentType<YearMapProps>> = {
  year: YearMapClient,
};

// The mode's component for its prepared data, or null for an unknown id.
export default function ModuleModeView({ mode, data, compact }: { mode: string; data: unknown; compact?: boolean }) {
  const View = CALENDAR_MODE_VIEWS[mode];
  // The data is whatever that mode's prepare function returned (same registry key).
  return View ? <View {...(data as YearMapProps)} compact={compact} /> : null;
}

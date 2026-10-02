// The server half of the `calendarModes` slot (ADR-287): a mode id → the
// module's `prepare` function, the same split as module-wiring.tsx for canvases
// (the manifest names the id, this file maps it to code). Prepare runs on the
// server and may read the database; it returns plain data. The component that
// draws it is wired in module-calendar-modes-client.tsx, because ViewRenderer
// runs in the browser on dashboards and must stay client-safe. Without a mode
// here (module off, id unknown), the view shows as Month.
import "@/lib/modules/register";
import { calendarModesFor } from "@/lib/modules";
import { moduleOnFor } from "@/lib/modules/enabled";
import type { StatusDef } from "@/lib/status";
import type { ViewDefinition } from "@/lib/views";
import type { ViewItem } from "@/components/views/ViewRenderer";
import { prepareYearMap } from "@/modules/year-map/YearMap";

// What a module's mode receives: the view, its already owner-scoped body-free
// rows, and the calendar context ViewRenderer was given.
export type CalendarModeProps = {
  ownerId: string;
  view: ViewDefinition;
  items: ViewItem[];
  statuses?: StatusDef[];
  today?: string;
  tz: string;
  month?: string;
  navHref?: string;
};

const CALENDAR_MODE_PREPARE: Record<string, (props: CalendarModeProps) => Promise<unknown>> = {
  year: prepareYearMap,
};

// Whether a view's mode asks the page for the full screen width. Pure lookup;
// a switched-off module's mode renders as Month, which is fine wide too.
export function calendarModeWide(mode: unknown): boolean {
  return calendarModesFor().some((m) => m.id === mode && m.wide);
}

// The prepared mode for a view, or null when its mode is core, unregistered, or
// owned by a module this owner has off (the view then renders as Month and
// keeps its stored mode for later).
export async function moduleCalendarModeData(
  props: CalendarModeProps
): Promise<{ mode: string; data: unknown } | null> {
  const mode = props.view.display?.mode;
  const reg = calendarModesFor().find((m) => m.id === mode);
  const prepare = reg ? CALENDAR_MODE_PREPARE[reg.id] : undefined;
  if (!reg || !prepare || !(await moduleOnFor(props.ownerId, reg.moduleId))) return null;
  return { mode: reg.id, data: await prepare(props) };
}

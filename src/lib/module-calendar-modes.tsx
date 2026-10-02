// The wiring half of the `calendarModes` slot (ADR-287): a mode id → the
// module's renderer, the same split as module-wiring.tsx for canvases (the
// manifest names the id, this file maps it to a component). Server-only: the
// renderers may read the database. ViewRenderer stays client-safe (dashboards
// mount it in the browser), so a server page renders the mode here and passes
// the result in as ViewRenderer's `moduleMode`; without one, the view shows
// as Month.
import type { ReactNode } from "react";
import "@/lib/modules/register";
import { calendarModesFor } from "@/lib/modules";
import { moduleOnFor } from "@/lib/modules/enabled";
import type { StatusDef } from "@/lib/status";
import type { ViewDefinition } from "@/lib/views";
import type { ViewItem } from "@/components/views/ViewRenderer";
import YearMap from "@/modules/year-map/YearMap";

// What a module's mode renderer receives: the view, its already owner-scoped
// body-free rows, and the calendar context ViewRenderer was given.
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

const CALENDAR_MODE_COMPONENTS: Record<
  string,
  (props: CalendarModeProps) => ReactNode | Promise<ReactNode>
> = {
  year: YearMap,
};

// Whether a view's mode asks the page for the full screen width. Pure lookup;
// a switched-off module's mode renders as Month, which is fine wide too.
export function calendarModeWide(mode: unknown): boolean {
  return calendarModesFor().some((m) => m.id === mode && m.wide);
}

// The rendered mode for a view, or null when its mode is core, unregistered, or
// owned by a module this owner has off (the view then renders as Month and
// keeps its stored mode for later).
export async function moduleCalendarMode(props: CalendarModeProps): Promise<ReactNode | null> {
  const mode = props.view.display?.mode;
  const reg = calendarModesFor().find((m) => m.id === mode);
  const Mode = reg ? CALENDAR_MODE_COMPONENTS[reg.id] : undefined;
  if (!reg || !Mode || !(await moduleOnFor(props.ownerId, reg.moduleId))) return null;
  return <Mode {...props} />;
}

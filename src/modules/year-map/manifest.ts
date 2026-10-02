// The Year Map module (ADR-287): a `year` calendar mode, twelve month rows of
// weekday-aligned days, for seeing a whole year (or a fiscal year, or a few
// months) at a glance and printing it. Pure, like every manifest.
import type { ModuleManifest } from "@/lib/modules";

export const yearMapModule: ModuleManifest = {
  id: "year-map",
  label: "Year Map",
  description:
    "A calendar mode that lays a whole year out as twelve month rows, colored by tag, ready to print.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  calendarModes: [{ id: "year", label: "Year Map", wide: true }],
};

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
  // Add widget → Prebuilt: the next few months as a dashboard map. Adding it
  // creates a saved view carrying these year settings; the widget renders it
  // faithfully, so the settings live on that view like any other Year Map.
  starterWidgets: [
    {
      id: "year-map-3-months",
      label: "Next 3 Months (Year Map)",
      description: "Your dated items as month rows, three months from now",
      renderStyle: "faithful",
      view: {
        name: "Next 3 Months (Year Map)",
        filter: {},
        // Newest first, so the 2,000-row cap keeps the coming months.
        sort: { field: "plan", dir: "desc" },
        grouping: null,
        columns: null,
        layout: "calendar",
        dateProperty: "plan",
        display: {
          mode: "year",
          modes: { year: { window: "rolling", months: 3, colorBy: "tag", layout: "fit" } },
        },
      },
    },
  ],
};

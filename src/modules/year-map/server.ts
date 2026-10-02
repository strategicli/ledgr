// The Year Map's one write (ADR-287): the first time the module is switched
// on, give the owner a "Year Map" saved view (every type, colored by tag) so
// there is something to open and pin to the nav. Skipped when the owner
// already has a view in this mode, so switching it off and on never doubles up.
import { createView, listViews, parseViewInput } from "@/lib/views";
import { YEAR_MODE } from "./lib";

export async function ensureYearMapView(ownerId: string): Promise<void> {
  const views = await listViews(ownerId);
  if (views.some((v) => v.display?.mode === YEAR_MODE)) return;
  await createView(
    ownerId,
    parseViewInput({
      name: "Year Map",
      layout: "calendar",
      filter: {},
      dateProperty: "plan",
      display: { mode: YEAR_MODE, modes: { [YEAR_MODE]: { colorBy: "tag" } } },
    })
  );
}

// The Desk module (ADR-146; moved under src/modules by ADR-272 step 4). Pure: no
// DB, no React.
//
// What it owns: the /desk page and everything under src/modules/desk (the
// layout tree, panels, per-device persistence, named workspaces, the "Send to
// Desk" menus). Its footprint outside that folder:
//   - Root layout: its send menu is a shell panel (module-panels.tsx
//     `shellPanels`), mounted only while the module is on.
//   - Editor and preview: a right-click on a mention or item link reaches that
//     menu through core's lib/inline-ref-menu, so with the Desk off the native
//     context menu stays.
//   - settings.deskWorkspaces: synced named layouts, kept by core as an opaque
//     slot and validated here (lib/workspaces.ts).
//   - Work nav: "/desk" is a built-in destination tagged with this module
//     (nav-slot-options.ts); it is not offered, and an existing slot is hidden,
//     while the module is off.
//   - `react-resizable-panels` in package.json is this module's dependency (only
//     the Desk uses it; a dependency cannot be per-module).
//   - The live layout and Recent ring are per-device localStorage keys
//     (`desk:layout`, `desk:recent`, lib/persist.ts), not database state, so
//     switching the module off and on again finds them where they were.
import type { ModuleManifest } from "@/lib/modules";

export const deskModule: ModuleManifest = {
  id: "desk",
  label: "Desk",
  description:
    "A side-by-side workspace: open several items in resizable panes and send text between them.",
  // The owner uses it daily; it was always on before it had a switch.
  enabledByDefault: true,
  types: [],
  exporters: [],
  routes: ["src/app/desk/page.tsx"],
};

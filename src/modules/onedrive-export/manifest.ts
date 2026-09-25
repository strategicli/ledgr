// The OneDrive export module (slice 17 / ADR-017, moved under src/modules by
// ADR-272 step 4). Pure manifest: no DB, no React. Its health check lives in
// server.ts; its scheduled job is `export` in supervisor/jobs.json.
//
// The boundary, and why Save Offline stayed core (Principle 4, Sunday-proof):
// the export ENGINE (src/lib/export/engine.ts), the target interface
// (target.ts) and the local-disk target (local.ts) are core, because the
// offline fallback must not depend on a switch. Only the OneDrive target, the
// nightly job and the "export now" route are this module. The engine never
// imported the OneDrive target (each route builds it and hands it in), so no
// target registry was needed to keep core from reaching in here.
//
// `items.exported_at` and `export_path` stay in the core schema: the engine
// writes them for whichever target it is handed. In production that is only
// ever this module's target, so they are this module's data in practice.
import type { ModuleManifest } from "@/lib/modules";

export const onedriveExportModule: ModuleManifest = {
  id: "onedrive-export",
  label: "OneDrive export",
  description:
    "Writes a plain-file copy of everything to your OneDrive every night, the copy you would open if the internet were down.",
  // On: the nightly job has always run, and the offline copy depends on it.
  enabledByDefault: true,
  types: [],
  exporters: [],
  routes: ["src/app/api/export/route.ts", "src/app/api/machine/export/route.ts"],
};

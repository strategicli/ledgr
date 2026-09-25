// Server-only slots for the OneDrive export module (ADR-272 step 4). Imported
// for effect by src/lib/modules/server-slots.ts, never by the pure path.
import { allModules } from "@/lib/modules";
import "@/lib/modules/register";

const m = allModules().find((x) => x.id === "onedrive-export");
// The last run, the last clean one, and the backlog. health.ts copies these
// into the three top-level lastExport* keys the weekly check reads.
if (m && !m.healthCheck) {
  m.healthCheck = async () => {
    const { getExportState } = await import("@/lib/export/engine");
    const s = await getExportState();
    return {
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastRunAt: s?.lastRunAt ?? null,
      remaining: s?.lastResult?.remaining ?? null,
    };
  };
}

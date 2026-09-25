// Server-only slots for the Todoist module (ADR-272 step 4). Imported for
// effect by src/lib/modules/server-slots.ts, never by the pure path.
import { allModules } from "@/lib/modules";
import "@/lib/modules/register";

const todoist = allModules().find((m) => m.id === "todoist");
// The last sync run and the last clean one. Both null is expected when the
// instance runs native tasks: the sync skips and never stamps.
if (todoist && !todoist.healthCheck) {
  todoist.healthCheck = async () => {
    const { getTodoistState } = await import("@/modules/todoist/lib/sync");
    const s = await getTodoistState();
    return { lastSyncAt: s?.lastSuccessAt ?? null, lastRunAt: s?.lastRunAt ?? null };
  };
}

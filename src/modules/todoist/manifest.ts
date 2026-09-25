// The Todoist module (ADR-272 step 4; the optional tasks adapter of ADR-073/081).
// Pure manifest: no DB, no React. It is imported on the middleware and client
// sidebar paths through register.ts, so the health check lives in server.ts.
//
// Two switches decide whether Todoist sync runs, and both must be on:
//  - this module, per owner, at Build → Modules (off by default: native tasks
//    are the default and Brandon's instance never ran Todoist);
//  - the instance's tasks adapter, TASKS_ADAPTER=todoist plus TODOIST_TOKEN
//    (src/lib/tasks/provider.ts), which says Todoist is configured at all.
import type { ModuleManifest } from "@/lib/modules";

export const todoistModule: ModuleManifest = {
  id: "todoist",
  label: "Todoist",
  description:
    "Two-way task sync with Todoist: tasks you complete in either place stay in step, and a Todoist webhook keeps Ledgr current.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  // Todoist signs its webhook with an HMAC, not a Clerk session. The route
  // verifies the signature itself; /api/todoist/sync stays sign-in protected.
  publicPaths: ["/api/todoist/webhook"],
  routes: [
    "src/app/api/todoist/sync/route.ts",
    "src/app/api/todoist/webhook/route.ts",
    "src/app/api/machine/todoist-sync/route.ts",
  ],
};

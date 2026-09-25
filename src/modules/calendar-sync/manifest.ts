// Calendar sync (slice 22 / ADR-094 E3, PRD §5.1) as a module (ADR-272 step 4).
// Pure manifest: no DB, no React. It is imported on the middleware and client
// sidebar paths through register.ts, so the health check lives in server.ts.
//
// Where the line sits. An owner with no Microsoft account still has events, so
// everything that SHOWS or USES events stays core; the module is only the pull
// from Outlook.
//
// In the module (src/modules/calendar-sync/lib):
//  - sync.ts, graph-source.ts: read the Outlook calendar over Graph and fill the
//    calendar_events cache; the job's place is the `calendar_sync` job_state row.
//  - matchers/engine.ts, matchers/store.ts: the dormant matchers-table rules
//    (retired by EM3, ADR-123) and their /api/matchers routes.
//  - the "Sync now" route and the scheduled calendar-sync job.
//
// Core, and why:
//  - src/lib/calendar/types.ts: the event shape every reader below speaks.
//  - feed.ts, overlay.ts: READ the cache for the Planner overlay, the Calendar
//    lens on the event list, and the list_calendar_feed / add_calendar_event MCP
//    tools, and promote a cached event on Add (/api/calendar/events/[id]/add).
//    With the module off they read an empty or aging cache and show nothing
//    new; nothing breaks.
//  - intake.ts, event-rules.ts, suggest-people.ts: template match rules and the
//    person suggester. Templates are core, and the suggester runs live on the
//    event canvas for hand-made events too.
//  - src/lib/matchers/types.ts: the condition vocabulary templates use.
//  - owner.ts: the mailbox-owner lookup, shared by MCP, push, machine auth,
//    email capture and Todoist.
// The shared Graph sign-in is not core: it is the microsoft module, required below.
//
// Tables: calendar_events is written by this module's sync and read by core.
// items.ms_event_id is the sync's match key; the sync and the core Add both
// write it. Both stay in src/db/schema.ts. Turning the module off stops the job
// (the step 3 job verdict answers "module-off") and turns the owned routes
// away; it never touches an event item or the cache.
import type { ModuleManifest } from "@/lib/modules";

export const calendarSyncModule: ModuleManifest = {
  id: "calendar-sync",
  label: "Calendar sync",
  description:
    "Brings your Outlook calendar into Ledgr every few hours, so upcoming meetings show on the Planner and wait to be added as events.",
  // On by default: the job runs by default in supervisor/jobs.json.
  enabledByDefault: true,
  types: [],
  exporters: [],
  // Reads and writes through the Microsoft Graph sign-in.
  requires: ["microsoft"],
  routes: [
    "src/app/api/calendar/sync/route.ts",
    "src/app/api/matchers/route.ts",
    "src/app/api/matchers/[id]/route.ts",
    "src/app/api/machine/calendar-sync/route.ts",
  ],
};

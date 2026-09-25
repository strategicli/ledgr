// Email capture (slice 26, PRD §5.3) as a module (ADR-272 step 4). Pure
// manifest: no DB, no React. It is imported on the middleware and client
// sidebar paths through register.ts, so the health check lives in server.ts.
//
// What the module is: the code that reads the "Ledgr Import" Outlook folder
// over Microsoft Graph and turns each forwarded message into an inbox item
// (lib/), the "Import now" and "Open in Outlook" routes, and the scheduled
// email-import job. Its place in the mailbox is the `email_import` row in
// job_state, which stays where it is. The shared Graph sign-in is the
// microsoft module, which this one requires; the mailbox-owner lookup
// (src/lib/calendar/owner.ts) is core. The module imports both.
//
// Turning it off stops the job (the step 3 job verdict answers "module-off")
// and turns the two routes away. Items it already made are ordinary items and
// stay exactly as they are.
import type { ModuleManifest } from "@/lib/modules";

export const emailCaptureModule: ModuleManifest = {
  id: "email-capture",
  label: "Email capture",
  description:
    "Turns messages you forward to the Ledgr Import folder in Outlook into items in your inbox.",
  // On by default: the job runs by default in supervisor/jobs.json.
  enabledByDefault: true,
  types: [],
  exporters: [],
  // Reads and writes through the Microsoft Graph sign-in.
  requires: ["microsoft"],
  routes: [
    "src/app/api/email/import/route.ts",
    "src/app/api/email/open/route.ts",
    "src/app/api/machine/email-import/route.ts",
  ],
};

// Microsoft 365 as a parent module (ADR-272 step 4). Pure manifest: no DB, no
// React. Its health check lives in server.ts.
//
// The module is the shared Microsoft Graph sign-in (lib/client.ts: app-only
// credentials from the GRAPH_* env vars, the cached token, graphFetch). It has
// no routes or jobs of its own: calendar-sync, email-capture and
// onedrive-export each `requires` it, so the Modules page and PATCH
// /api/settings refuse to turn it off while any of them is on. Clerk's
// Microsoft sign-in is core auth and is not part of this.
import type { ModuleManifest } from "@/lib/modules";

export const microsoftModule: ModuleManifest = {
  id: "microsoft",
  label: "Microsoft 365",
  description:
    "Connects Ledgr to your Outlook calendar, your email and your OneDrive through Microsoft Graph.",
  // On: its three dependents are on by default, so off here would leave every
  // existing install in violation of their `requires` on upgrade.
  enabledByDefault: true,
  types: [],
  exporters: [],
};

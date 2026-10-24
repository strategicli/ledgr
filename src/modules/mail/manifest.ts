// Mail & Calendar (plan note a06242d3): Outlook and Gmail, read and answered
// inside Ledgr, live from the providers rather than copied. Pure manifest: no
// DB, no fs.
//
// Hub only. The module runs where the Tailscale module runs (same check, the
// same function): never on Vercel, and only on an install the supervisor
// started. Its routes refuse anywhere else (lib/gate.ts), and its sign-ins
// live in the hub's data folder (lib/store.ts), so even code reached on
// Vercel would have nothing to sign in with.
//
// Phase 1 (foundation): the two sign-ins, the provider action list
// (lib/types.ts) and the safe mail viewer. Phase 2 (reading): the /mail page
// (src/app/mail/page.tsx, gated by pageGate + mailAvailable) over lib/reading.ts.
import type { ModuleManifest } from "@/lib/modules";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";

export const mailAvailable = tailscaleAvailable;

export const mailModule: ModuleManifest = {
  id: "mail",
  label: "Mail & Calendar",
  description:
    "Read and answer your Outlook and Gmail mail and calendars inside Ledgr. Runs only on a Ledgr installed on your own computer.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  available: mailAvailable,
  settingsPanel: "mail",
  settingsPanelOpen: true,
  routes: [
    "src/app/api/mail/accounts/route.ts",
    "src/app/api/mail/google/start/route.ts",
    "src/app/api/mail/google/callback/route.ts",
    "src/app/api/mail/read/route.ts",
    "src/app/api/mail/attachment/route.ts",
  ],
};

// The Tailscale module: private access to a Ledgr installed on your own
// computer, from your phone and your other computers, with no Tailscale app on
// this computer (ADR-276, install plan step 3). Pure manifest: no DB, no fs.
//
// The work is a small helper program (tailnet/main.go) the supervisor runs
// beside Postgres. It joins the owner's tailnet as its own machine and serves
// this install over HTTPS there. supervisor/tailnet.mjs keeps it running.
//
// Two switches, both in the app, both must be on (the snapshots shape, ADR-222):
//  - this module, per owner, at Build → Modules.
//  - `tailscale:enabled` in job_state, per computer, flipped by Connect and
//    Disconnect on this module's options. Never synced: each computer is its
//    own machine on the tailnet.
// The supervisor asks GET /api/machine/tailscale, which answers both at once.
import type { ModuleManifest } from "@/lib/modules";

// A local install marks itself with LEDGR_SUPERVISOR_DIR. A cloud deploy
// cannot run a long-lived helper and is already public, so it never offers it.
export function tailscaleAvailable(): boolean {
  return !process.env.VERCEL && !!process.env.LEDGR_SUPERVISOR_DIR;
}

export const tailscaleModule: ModuleManifest = {
  id: "tailscale",
  label: "Private access (Tailscale)",
  description:
    "Open this computer's Ledgr from your phone and your other devices, anywhere, over your own private Tailscale network. Nothing is put on the public internet.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  available: tailscaleAvailable,
  settingsPanel: "tailscale",
  // Connect lives in the options, so they start unfolded.
  settingsPanelOpen: true,
  routes: ["src/app/api/tailscale/route.ts", "src/app/api/machine/tailscale/route.ts"],
};

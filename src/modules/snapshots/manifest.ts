// The snapshots module: hourly restore points on a local install (ADR-217,
// ADR-222; moved under src/modules by ADR-272 step 4). Pure manifest: no DB,
// no child_process. Its scheduled job is `snapshot` in supervisor/jobs.json.
//
// Two switches, on purpose, and both must be on for a restore point to be taken:
//  - this module, per owner, at Build → Modules: "the feature exists here".
//  - `snapshots:enabled` in job_state, per install, on Build → Backups: "this
//    machine keeps restore points". Never synced, because each machine has its
//    own disk and its own answer (ADR-222), and off by default, because
//    restore points cost real disk.
// No health check: the only cheap state is a directory listing on the one
// machine that keeps them, which Build → Backups already shows.
import type { ModuleManifest } from "@/lib/modules";

export const snapshotsModule: ModuleManifest = {
  id: "snapshots",
  label: "Snapshots",
  description:
    "Hourly restore points of the database on a computer running Ledgr locally. Each computer also has its own on/off switch on Build → Backups.",
  enabledByDefault: true,
  types: [],
  exporters: [],
  perInstallNote: {
    text: "Restore points are also switched per computer on Build → Backups.",
    href: "/build/backups",
  },
  routes: ["src/app/api/snapshots/route.ts", "src/app/api/machine/snapshot/route.ts"],
};

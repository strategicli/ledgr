// The passages module (ADR-149, moved under src/modules by ADR-272 step 4).
// Pure: no DB, no React. The save hook that keeps `passage_refs` current lives
// in `server.ts`. The ref grammar (`src/lib/passages/{canon,ref}.ts`) stays in
// core, because the `ledgr://passage/` link is part of the body dialect the
// editor must round-trip whether or not this module is on.
import type { ModuleManifest } from "@/lib/modules";

export const passagesModule: ModuleManifest = {
  id: "passages",
  label: "Scripture passages",
  description: "Scripture references in a body become links to a passage page.",
  // It had no switch before step 3.6 and always ran, so it defaults on.
  enabledByDefault: true,
  types: [],
  exporters: [],
  routes: ["src/app/passage/[ref]/page.tsx"],
};

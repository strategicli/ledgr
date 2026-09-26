// The presentations module (explorations/presentations.md). A browser slide
// player for any item: slide marks or `---` breaks become slides, with a
// presenter window, an offline download and a public follow link. Pure: no
// DB, no React. Off by default; the main stage keeps its own software.
import type { ModuleManifest } from "@/lib/modules";

export const presentationsModule: ModuleManifest = {
  id: "presentations",
  label: "Presentations",
  description:
    "Present any item as slides in the browser, with a presenter view, an offline copy and a live link viewers can follow.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  // The public follow link (step 6): no session, an unguessable token is the
  // credential, same posture as sharing's "/share(.*)".
  publicPaths: ["/live(.*)"],
  routes: [
    "src/app/present/[id]/route.ts",
    "src/app/present/[id]/live/route.ts",
    "src/app/live/[token]/route.ts",
  ],
};

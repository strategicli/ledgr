// Listen (read-aloud) as a module (ADR-272 step 4). Pure: no DB, no React. The
// player (ListenBar) reaches the item canvas through module-editor.tsx. Core
// keeps speechTextFor (markdown-render.ts) and the per-type columns
// types.listen_enabled / listen_open_in_edge; turning the module off keeps
// every type's choice, it just stops offering Listen.
import type { ModuleManifest } from "@/lib/modules";

export const listenModule: ModuleManifest = {
  id: "listen",
  label: "Listen",
  description: "Have the browser read an item aloud, from its ⋯ menu, for the types you turn it on for.",
  // It shipped with no switch (a per-type opt-in only), so it defaults on.
  enabledByDefault: true,
  types: [],
  exporters: [],
  routes: ["src/app/api/types/[key]/listen/route.ts"],
};

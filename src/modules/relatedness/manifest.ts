// The relatedness module (Discover, ADR-127; moved under src/modules by ADR-272
// step 4). Pure: no DB, no React. Its health check lives in `server.ts`; its
// scheduled job is `relatedness` in supervisor/jobs.json.
//
// The boundary. Relations themselves are core: the `relations` table, the
// Related panel's explicit links, "+ Relate" and `@` mentions. This module is
// the COMPUTED layer on top: the `item_relatedness` cache (the table stays in
// src/db/schema.ts, owned here), the nightly job that fills it, the scorer, the
// Discover section, the Related Explorer page and Loose Ends. The three
// `src/lib/related-*.ts` files stay core: related-lens.ts and related-prefs.ts
// are the owner's sort/filter and "show completed" choices for the explicit
// list, and related-views.ts renders one type group of explicit relations
// through a saved view. None of them reads `item_relatedness` or the scorer.
import type { ModuleManifest } from "@/lib/modules";

export const relatednessModule: ModuleManifest = {
  id: "relatedness",
  label: "Relatedness",
  description:
    "Suggests items that belong together and lists loose ends, from a nightly pass over your items.",
  // The job ran by default on every peer before it had a switch.
  enabledByDefault: true,
  types: [],
  exporters: [],
  nav: [
    // Loose Ends (ADR-127 Phase 3): under-connected items with their top
    // suggested links, the scorer inverted across the whole corpus.
    { group: "MAINTAIN", label: "Loose Ends", href: "/build/loose-ends", icon: "affiliate", after: "/build/hygiene" },
  ],
  routes: [
    "src/app/build/loose-ends/page.tsx",
    "src/app/items/[id]/explore/page.tsx",
    "src/app/api/items/[id]/suggested-relations/route.ts",
    "src/app/api/machine/relatedness/route.ts",
  ],
};

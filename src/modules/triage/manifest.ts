// Triage mode as a module (ADR-272 step 4): the one-card-at-a-time swipe deck
// at /inbox/triage. Pure: no DB, no React. The Inbox itself (the items.inbox
// column, the /inbox list and its inline controls) stays core; this is only the
// deck on top of it.
import type { ModuleManifest } from "@/lib/modules";

export const triageModule: ModuleManifest = {
  id: "triage",
  label: "Triage mode",
  description: "Work through the Inbox one card at a time: swipe right to mark it triaged, left to trash it.",
  // It shipped with no switch, so it defaults on.
  enabledByDefault: true,
  types: [],
  exporters: [],
  routes: ["src/app/inbox/triage/page.tsx"],
};

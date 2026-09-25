// Live editing context (ADR-162) as a module (ADR-272 step 4). Pure: the proxy
// and the client sidebar import this through register.ts. The two MCP tools are
// attached on the server by ./server.ts; the canvas tracker reaches core through
// src/lib/module-panels.tsx (panel id "live-context"). The `active_context`
// table stays in src/db/schema.ts and is owned by this module.
import type { ModuleManifest } from "@/lib/modules";

// Appended only when Live editing context is on (ADR-162). Like the memory
// addendum, this is what actually gets the co-editing loop used. Kept short;
// points at the tools.
const LIVE_CONTEXT_INSTRUCTIONS = [
  "",
  "LIVE EDITING CONTEXT is on. The owner may refer to \"this note\", \"this page\",",
  "\"the draft\", \"this sentence\", \"this\", or \"it\" to mean whatever they",
  "currently have open in Ledgr. Call get_active_context to resolve that — it",
  "returns the open note's freshly-read body and any text they've highlighted.",
  "Re-read it whenever they reference the note again or ask what you think of it;",
  "they edit directly with keyboard and mouse, so don't trust a body you saw",
  "earlier. To change the note, use edit_item_body (a surgical find-and-replace on",
  "one spot) rather than update_item (which resends the whole body), so you never",
  "clobber an edit they made elsewhere. Confirm before writing unless they've told",
  "you to go ahead.",
].join("\n");

export const liveContextModule: ModuleManifest = {
  id: "live-context",
  label: "Live editing context",
  description:
    "Tells Claude which item you have open and what text you selected, so it can edit the note you are looking at.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  mcpTools: { names: ["get_active_context", "edit_item_body"], instructions: LIVE_CONTEXT_INSTRUCTIONS },
  routes: ["src/app/api/active-context/route.ts", "src/app/api/active-context/prompt/route.ts"],
};

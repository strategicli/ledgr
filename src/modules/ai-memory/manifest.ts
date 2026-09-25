// AI Memory (ADR-137) as a module (ADR-272 step 4). Pure: the proxy and the
// client sidebar import this through register.ts, so nothing here reaches the
// database. The two MCP tools, the memory-protocol resource and the search_items
// hook are attached on the server by ./server.ts. The `memory` item type is a
// row in the `types` table (drizzle/0040_memory_type.sql), so it is data and
// stays put when the module is off; only the tools, the resource and the Build
// page go quiet.
import type { ModuleManifest } from "@/lib/modules";

// Appended to the MCP server's instructions only when AI Memory is on (ADR-137).
// The connect-time instructions are the one place every client reliably
// surfaces to the model, so this is what actually gets the memory system used:
// tool descriptions are only read once a tool is already under consideration,
// and most clients never fetch resources unprompted. Kept short: it points at
// the protocol resource for the full contract rather than restating it. When AI
// Memory is off, the base instructions are emitted byte-for-byte unchanged.
const MEMORY_INSTRUCTIONS = [
  "",
  "AI MEMORY is on. The owner keeps durable memories about themselves, their",
  "people, and their work in Ledgr, in two tiers. Call get_memory_stumps at the",
  "START of the session: it returns the small PINNED set, the standing rules you",
  "need on every run. Everything else is retrieved on demand — when a person,",
  "project, or system comes up that you don't already know, search_items for it",
  "by name with type: \"memory\", then get_item the stump for detail. When you",
  "learn something durable worth carrying into a later session, file it with",
  "remember. Read the memory-protocol resource (ledgr://guide/memory-protocol)",
  "for the full contract.",
].join("\n");

export const aiMemoryModule: ModuleManifest = {
  id: "ai-memory",
  label: "AI Memory",
  description:
    "Lets Claude keep durable memories in Ledgr over MCP, with a Build → AI Memory page to review them.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  mcpTools: { names: ["get_memory_stumps", "remember"], instructions: MEMORY_INSTRUCTIONS },
  // "affiliate" (connected nodes) nods to the memory relation graph.
  nav: [{ group: "MAINTAIN", label: "AI Memory", href: "/build/memory", icon: "affiliate", after: "/build/api" }],
  routes: ["src/app/build/memory/page.tsx"],
};

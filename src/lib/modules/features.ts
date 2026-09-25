// The feature modules (ADR-272 step 2): switches that add behavior rather than
// an item type, folded onto Build → Modules from the four settings checkboxes
// and the notification-center constant they replace. Pure manifests, no types,
// no canvas. Every folded default is the old key's default (all off), and
// seedModulesFromLegacy (settings.ts) carries an owner's existing choice across,
// so nobody's switch flips on upgrade. `passages` is the exception: it had no
// switch before step 3.6, it always ran, so it defaults on. The code each one
// gates still lives where it did; step 4 of the plan moves it under the module.
//
// Hooks and health checks (step 3.4 to 3.6) are NOT declared here: this file is
// on the pure path (register.ts, imported by build-nav.ts for the client sidebar
// and by proxy.ts for the middleware), and their implementations reach the
// database, yt-dlp and child_process. `server-slots.ts` attaches them on the
// server only.
import type { ModuleManifest } from "@/lib/modules";

const feature = (
  id: string,
  label: string,
  description: string,
  slots: Partial<ModuleManifest> = {}
): ModuleManifest => ({
  id,
  label,
  description,
  enabledByDefault: false,
  types: [],
  exporters: [],
  ...slots,
});

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

export const FEATURE_MODULES: ModuleManifest[] = [
  feature(
    "ai-memory",
    "AI Memory",
    "Lets Claude keep durable memories in Ledgr over MCP, with a Build → AI Memory page to review them.",
    {
      mcpTools: { names: ["get_memory_stumps", "remember"], instructions: MEMORY_INSTRUCTIONS },
      // ADR-137: the memory an AI reads over MCP. The page gates itself too.
      // "affiliate" (connected nodes) nods to the memory relation graph.
      nav: [
        { group: "MAINTAIN", label: "AI Memory", href: "/build/memory", icon: "affiliate", after: "/build/api" },
      ],
    }
  ),
  feature(
    "live-context",
    "Live editing context",
    "Tells Claude which item you have open and what text you selected, so it can edit the note you are looking at.",
    { mcpTools: { names: ["get_active_context", "edit_item_body"], instructions: LIVE_CONTEXT_INSTRUCTIONS } }
  ),
  feature(
    "agent",
    "In-app agent",
    "A Claude sidebar, inline edit and slash commands inside Ledgr, run under this computer's Claude login."
  ),
  feature(
    "youtube-transcripts",
    "YouTube transcripts",
    "Saved YouTube links fill their body with the video's transcript, using captions or Whisper on this computer."
  ),
  feature(
    "notification-center",
    "Notification center",
    "An in-app notification inbox and push alerts. Paused: its reminder jobs are switched off, so turning it on shows the inbox but sends nothing new."
  ),
  feature(
    "passages",
    "Scripture passages",
    "Scripture references in a body become links to a passage page.",
    { enabledByDefault: true }
  ),
];

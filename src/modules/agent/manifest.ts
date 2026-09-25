// The in-app agent module (the Claude sidebar, inline edit and slash prompts,
// ADR-271; moved under src/modules by ADR-272 step 4). Pure: no DB, no React.
// Its scheduled job is `agent-purge` in supervisor/jobs.json.
//
// Two switches decide whether the agent shows. The owner's is Build → Modules
// (settings.modules.agent). The machine's is `available` below: the agent spawns
// Claude Code under this computer's Claude login, so it runs only on a local
// install that is its own hub. It lives on the manifest, not only inside the
// module's components, because the root layout (fenced core) needs it to stamp
// body[data-agent] for the editor, and it may not import this module to ask.
//
// The four agent_* tables stay in src/db/schema.ts, owned here. The owner's
// agent options (models, prompt item ids) stay a plain shape parsed by core in
// src/lib/settings.ts; this module reads them.
import type { ModuleManifest } from "@/lib/modules";

// The supervisor marks a local install with LEDGR_SUPERVISOR_DIR and gives a
// spoke LEDGR_SYNC_HUBS; a hub has the first and not the second. LEDGR_AGENT
// (on|off) overrides for testing only. Turning the feature on for the owner is
// the Build → Modules switch, never this (the config-file rule, ADR-222).
export function agentAvailable(): boolean {
  const o = process.env.LEDGR_AGENT;
  if (o === "on") return true;
  if (o === "off" || process.env.VERCEL) return false;
  return !!process.env.LEDGR_SUPERVISOR_DIR && !process.env.LEDGR_SYNC_HUBS;
}

export const agentModule: ModuleManifest = {
  id: "agent",
  label: "In-app agent",
  description:
    "A Claude sidebar, inline edit and slash commands inside Ledgr, run under this computer's Claude login.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  available: agentAvailable,
  settingsPanel: "agent",
  routes: [
    "src/app/api/agent/approval/[id]/route.ts",
    "src/app/api/agent/health/route.ts",
    "src/app/api/agent/inline/[id]/route.ts",
    "src/app/api/agent/inline/route.ts",
    "src/app/api/agent/prompts/route.ts",
    "src/app/api/agent/sessions/[id]/bring-back/route.ts",
    "src/app/api/agent/sessions/[id]/route.ts",
    "src/app/api/agent/sessions/route.ts",
    "src/app/api/agent/turn/[id]/stop/route.ts",
    "src/app/api/agent/turn/[id]/stream/route.ts",
    "src/app/api/agent/turn/route.ts",
    "src/app/api/machine/agent-purge/route.ts",
  ],
};

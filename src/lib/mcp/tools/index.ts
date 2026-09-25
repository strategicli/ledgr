// The MCP tool registry (ADR-047, PRD §5.5): search items, read item, create
// item, update item, list by entity/date — plus list_types so the model knows
// the type/property vocabulary before it creates or filters. Every tool is a
// thin wrapper over the same owner-scoped libs the REST API uses, so the MCP
// surface can never drift from the app's own contract or skip owner scoping.
//
// Tool definitions live per-family in sibling files (items/types/relations/
// views/templates/dashboards/workspace/memory); this file only assembles the
// registry and dispatches calls.
//
// A tool handler returns a plain object; callTool serializes it to MCP text
// content. Expected validation failures (ItemError) come back as an isError
// tool result so Claude sees a clean message and the session stays open;
// unexpected errors are captured (rule 9) and returned with a correlation id.
import { getSettings, type UserSettings } from "@/lib/settings";
import { moduleOwningTool, toolEnabledFor } from "@/lib/modules";
import { moduleOn } from "@/lib/modules/enabled";
import { ItemError } from "@/lib/items";
import { captureError } from "@/lib/log";
import { attachmentTools } from "./attachments";
import { calendarTools } from "./calendar";
import { contextTools } from "./context";
import { dashboardTools } from "./dashboards";
import { exportTools } from "./export";
import { itemTools } from "./items";
import { memoryTools } from "./memory";
import { recordTools } from "./records";
import { relationTools } from "./relations";
import { shareTools } from "./share";
import { taskTools } from "./tasks";
import { templateTools } from "./templates";
import { trashTools } from "./trash";
import { typeTools } from "./types";
import { viewTools } from "./views";
import type { McpTool, McpToolDef, ToolCallResult } from "./wire";
import { workspaceTools } from "./workspace";

export type { McpToolDef, ToolCallResult } from "./wire";

const TOOLS: McpTool[] = [
  ...itemTools,
  ...taskTools,
  ...recordTools,
  ...attachmentTools,
  ...calendarTools,
  ...typeTools,
  ...relationTools,
  ...shareTools, // core for now: sharing is not a module yet, so no manifest claims these
  ...trashTools,
  ...exportTools,
  ...viewTools,
  ...templateTools,
  ...workspaceTools,
  ...dashboardTools,
  ...memoryTools,
  ...contextTools,
];

// Every registered tool name, for guards like verify-agent (each needs a tier).
export const TOOL_NAMES = TOOLS.map((t) => t.name);

// Whether a tool is on for this owner (the mcpTools slot, ADR-272 step 3): a
// tool a module claims follows that module's switch; any other tool is core
// and always on. The share tools stay core until sharing becomes a module.
function toolEnabled(
  name: string,
  settings: Pick<UserSettings, "modules">
): boolean {
  return toolEnabledFor(name, (id) => moduleOn(settings, id));
}

// The wire definitions (handler stripped) for tools/list. Owner-aware: a
// module's tools drop out while that module is off.
export async function listToolDefs(ownerId: string): Promise<McpToolDef[]> {
  const flags = await getSettings(ownerId);
  return TOOLS.filter((t) => toolEnabled(t.name, flags)).map(
    ({ handler: _handler, ...def }) => def
  );
}

function toolError(message: string): ToolCallResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Run a tool by name. Expected request errors (ItemError) become an isError
// result with the message; anything unexpected is captured and answered with a
// correlation id, never thrown out to the transport (the session survives).
export async function callTool(
  ownerId: string,
  name: string,
  args: unknown
): Promise<ToolCallResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return toolError(`unknown tool '${name}'`);
  const a =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  try {
    // Defense in depth: a disabled gated tool is rejected even if a client calls
    // it directly without listing (listToolDefs already hides it).
    const owning = moduleOwningTool(name);
    if (owning && !toolEnabled(name, await getSettings(ownerId))) {
      return toolError(`tool '${name}' is not enabled — turn on ${owning.label} at Build → Modules`);
    }
    const payload = await tool.handler(ownerId, a);
    // A handler that returns a string has already rendered its own wire format
    // (the compact memory-stump index, ADR-230). Don't re-encode it as JSON.
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof ItemError) return toolError(err.message);
    const correlationId = crypto.randomUUID();
    await captureError("mcp", err, { correlationId, detail: { tool: name } });
    return toolError(`internal error (correlationId ${correlationId})`);
  }
}

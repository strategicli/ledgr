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
import { getSettings } from "@/lib/settings";
import { ItemError } from "@/lib/items";
import { captureError } from "@/lib/log";
import { dashboardTools } from "./dashboards";
import { itemTools } from "./items";
import { MEMORY_TOOL_NAMES, memoryTools } from "./memory";
import { relationTools } from "./relations";
import { templateTools } from "./templates";
import { typeTools } from "./types";
import { viewTools } from "./views";
import type { McpTool, McpToolDef, ToolCallResult } from "./wire";
import { workspaceTools } from "./workspace";

export type { McpToolDef, ToolCallResult } from "./wire";
export { MEMORY_TOOL_NAMES };

const TOOLS: McpTool[] = [
  ...itemTools,
  ...typeTools,
  ...relationTools,
  ...viewTools,
  ...templateTools,
  ...workspaceTools,
  ...dashboardTools,
  ...memoryTools,
];

const MEMORY_TOOL_SET = new Set<string>(MEMORY_TOOL_NAMES);

// The wire definitions (handler stripped) for tools/list. Owner-aware: the
// memory tools drop out unless the owner enabled AI Memory.
export async function listToolDefs(ownerId: string): Promise<McpToolDef[]> {
  const { aiMemoryEnabled } = await getSettings(ownerId);
  return TOOLS.filter((t) => aiMemoryEnabled || !MEMORY_TOOL_SET.has(t.name)).map(
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
    // Defense in depth: a disabled memory tool is rejected even if a client
    // calls it directly without listing (listToolDefs already hides it).
    if (MEMORY_TOOL_SET.has(name) && !(await getSettings(ownerId)).aiMemoryEnabled) {
      return toolError(`tool '${name}' is not enabled — turn on AI Memory in User Settings`);
    }
    const payload = await tool.handler(ownerId, a);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  } catch (err) {
    if (err instanceof ItemError) return toolError(err.message);
    const correlationId = crypto.randomUUID();
    await captureError("mcp", err, { correlationId, detail: { tool: name } });
    return toolError(`internal error (correlationId ${correlationId})`);
  }
}

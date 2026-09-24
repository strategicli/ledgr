// The agent's tools (ADR-271): Ledgr's own MCP tool registry, served in-process
// to the Claude Agent SDK, so the sidebar acts exactly as the owner with no
// network hop and no API key. Every tool sits in exactly one tier;
// scripts/verify-agent.mts fails CI if a new registry tool is left unmapped.
//
//   R  read: runs.
//   W  write: runs (Brandon, 2026-09-24: no approval card for writes; Trash and
//      revisions are the undo).
//   D  destructive or public: always asks, every time, and "allow for this
//      chat" is never offered.
//   X  not exposed: reshaping the workspace (types, views, nav, dashboards) is
//      for Claude Code or claude.ai, and uploads need a network the agent lacks.
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool, listToolDefs } from "@/lib/mcp/tools";

export type Tier = "R" | "W" | "D" | "X";

export const TOOL_TIERS: Record<string, Tier> = {
  search_items: "R",
  list_items: "R",
  get_item: "R",
  get_active_context: "R",
  list_types: "R",
  list_views: "R",
  run_view: "R",
  get_memory_stumps: "R",
  list_subtasks: "R",
  list_templates: "R",
  describe_workspace: "R",
  list_calendar_feed: "R",
  get_record_layout: "R",
  list_share_links: "R",
  export_item: "R",
  link_to_line: "R",

  create_item: "W",
  update_item: "W",
  edit_item_body: "W",
  add_to_record: "W",
  add_subtasks: "W",
  relate_items: "W",
  unrelate_items: "W",
  remember: "W",
  attach_file: "W",
  set_recurrence: "W",
  update_occurrence: "W",
  apply_template: "W",
  move_item_type: "W",
  add_calendar_event: "W",
  restore_item: "W",

  delete_item: "D",
  share_item: "D",
  revoke_share_link: "D",

  create_type: "X",
  update_type: "X",
  set_type_statuses: "X",
  set_type_layout: "X",
  set_record_layout: "X",
  update_nav: "X",
  create_dashboard: "X",
  add_widget: "X",
  create_view: "X",
  update_view: "X",
  set_list_tabs: "X",
  set_capture_routes: "X",
  assign_dashboards: "X",
  create_upload_url: "X",
  embed_attachment: "X",
};

export const SERVER = "ledgr";
export const sdkName = (tool: string) => `mcp__${SERVER}__${tool}`;
export const bareName = (sdk: string) => sdk.replace(`mcp__${SERVER}__`, "");

// An unmapped tool is treated as X: a new registry tool stays out of the agent
// until someone decides its tier.
export function tierOf(tool: string): Tier {
  return TOOL_TIERS[tool] ?? "X";
}

// One-line plain-English summary of a call, for the tool row and approvals.
export function describeCall(tool: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const q = (v: unknown) => `"${s(v).replace(/^"|"$/g, "").slice(0, 60)}"`;
  switch (tool) {
    case "search_items":
      return `Searched for ${q(args.query)}`;
    case "get_item":
      return "Read an item";
    case "get_active_context":
      return "Looked at what you have open";
    case "list_items":
      return `Listed ${s(args.type) || "items"}`;
    case "create_item":
      return `Created ${s(args.type) || "item"} ${q(args.title)}`;
    case "update_item":
      return "Updated an item";
    case "edit_item_body":
      return "Edited an item's text";
    case "delete_item":
      return `Move ${Array.isArray(args.ids) ? `${args.ids.length} items` : "an item"} to Trash`;
    case "share_item":
      return "Make a public share link";
    case "revoke_share_link":
      return "Turn off a share link";
    default:
      return tool.replace(/_/g, " ");
  }
}

// The in-process MCP server. `ownerId` is fixed per turn, so every call acts as
// the signed-in owner. Creates are stamped with the ai_agent arrival path so
// Capture settings (and the owner) can tell sidebar captures from connector ones.
export async function buildToolServer(ownerId: string) {
  const defs = (await listToolDefs(ownerId)).filter((d) => tierOf(d.name) !== "X");
  const cfg = createSdkMcpServer({ name: SERVER, version: "1", alwaysLoad: true });
  const server = cfg.instance.server;
  server.registerCapabilities({ tools: {} });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: defs.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
      annotations: d.annotations,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (tierOf(name) === "X") {
      return { content: [{ type: "text", text: `tool '${name}' is not available here` }], isError: true };
    }
    const args = { ...(req.params.arguments ?? {}) } as Record<string, unknown>;
    if (name === "create_item" && args.source === undefined && args.inbox === undefined) {
      args.source = "ai_agent";
    }
    return callTool(ownerId, name, args);
  });
  // R and W run without asking; D is listed but left out of `allowed`, so the
  // SDK routes every D call through canUseTool (the approval card).
  const allowed = defs.filter((d) => tierOf(d.name) !== "D").map((d) => sdkName(d.name));
  return { config: cfg, allowed };
}

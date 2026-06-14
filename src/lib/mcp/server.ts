// The MCP method dispatcher (ADR-047): one JSON-RPC message in, one response
// (or null for a notification, which the route turns into a 202). Pure
// orchestration over the protocol envelope (protocol.ts) and the tool registry
// (tools.ts) — the route owns transport (auth, headers, status codes), this
// owns the MCP semantics. The method set is the stable core: initialize,
// tools/list, tools/call, and ping.
import {
  JSONRPC,
  classifyMessage,
  negotiateProtocolVersion,
  rpcError,
  rpcResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@/lib/mcp/protocol";
import { callTool, listToolDefs } from "@/lib/mcp/tools";

// Free-form version string for clients to display; tracks the PRD epoch
// (v0.18, the Markdown epoch), not the package.json build number.
const LEDGR_VERSION = "0.18";

export const SERVER_INFO = {
  name: "ledgr",
  title: "Ledgr",
  version: LEDGR_VERSION,
};

// Surfaced to the model by the client at connect time — what Ledgr is and how
// these tools fit together, so the first tool call is well-aimed.
export const INSTRUCTIONS = [
  "Ledgr is the owner's personal life-management system: meetings, tasks,",
  "notes, links, and entities (people, orgs, projects, topics) stored as typed",
  "items with relations between them.",
  "",
  "Use search_items to find an item or entity by words; list_items to list by",
  "type, status, due-date window, or related entity; get_item to read an item's",
  "body and its relations; create_item to file a task/note or capture something;",
  "and update_item to change fields (e.g. mark a task done). Call list_types to",
  "learn the available types and their custom properties before creating or",
  "filtering. A typical flow for \"what's open with Roger\": search_items for the",
  "Roger entity, then list_items with that entityId, type=task, status=open.",
  "",
  "All data belongs to the single owner of this Ledgr; you only ever see and",
  "modify their items.",
].join("\n");

export async function handleMcpMessage(
  message: unknown,
  ownerId: string
): Promise<JsonRpcResponse | null> {
  const kind = classifyMessage(message);
  // Notifications (e.g. notifications/initialized) and stray responses get no
  // reply — the route answers them with 202 Accepted.
  if (kind === "notification" || kind === "response") return null;
  if (kind === "invalid") {
    return rpcError(null, JSONRPC.INVALID_REQUEST, "invalid JSON-RPC message");
  }

  const req = message as JsonRpcRequest;
  const { id, method } = req;

  switch (method) {
    case "initialize": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      return rpcResult(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        // We offer tools only; listChanged false since the set is static.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "tools/list":
      return rpcResult(id, { tools: listToolDefs() });

    case "tools/call": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (typeof params.name !== "string") {
        return rpcError(id, JSONRPC.INVALID_PARAMS, "tools/call requires a string 'name'");
      }
      const result = await callTool(ownerId, params.name, params.arguments);
      return rpcResult(id, result);
    }

    case "ping":
      return rpcResult(id, {});

    default:
      return rpcError(id, JSONRPC.METHOD_NOT_FOUND, `unknown method '${method}'`);
  }
}

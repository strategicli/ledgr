// The MCP wire protocol, hand-rolled (ADR-047). Ledgr exposes a thin MCP
// server (PRD §5.5) so Claude is a first-class client. The protocol is
// JSON-RPC 2.0 over the Streamable HTTP transport; for request/response tools
// that's a small, stable surface (initialize / tools/list / tools/call / ping),
// so we implement it directly rather than take the @modelcontextprotocol/sdk
// dependency — the same call ADR-034 made for Web Push (Principle 5, boring
// stack/few deps). The transport rules we hold to (MCP 2025-06-18 spec):
//   - a POST carrying a JSON-RPC *request* gets one application/json response;
//   - a POST carrying only a *notification* or *response* gets 202, no body;
//   - we are stateless (no Mcp-Session-Id) — allowed for a server that keeps
//     no per-connection state; every call re-resolves the owner and the data.
//
// This module is PURE (no DB, no Next, no env): types, version negotiation,
// message classification, and the JSON-RPC envelope builders. Dispatch lives
// in server.ts and tool execution in tools.ts, so this half stays node-testable
// the same way modules.ts/canvas policy is split from its wiring.

// Protocol versions we understand. The spec's version string is a date. We
// accept the three stable revisions and negotiate down to the client's if we
// share it, else answer with our latest (the client then decides to proceed).
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
] as const;
export const LATEST_PROTOCOL_VERSION = "2025-06-18";
// The transport's backwards-compat default when no MCP-Protocol-Version header
// is present and no version was negotiated (spec: assume 2025-03-26).
export const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

export function isSupportedProtocolVersion(v: string): boolean {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

// Version negotiation (spec lifecycle): echo the client's requested version
// when we support it, otherwise return our latest.
export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && isSupportedProtocolVersion(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

// --- JSON-RPC 2.0 envelope ------------------------------------------------

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
} & ({ result: unknown } | { error: JsonRpcError });

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

// Standard JSON-RPC error codes (the only ones MCP uses at the protocol layer;
// tool-level failures are returned as an isError result, not these).
export const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

// What kind of message arrived. A *request* has a method and an id (it expects
// a response → 200 + body). A *notification* has a method and no id (fire and
// forget → 202). A *response* (result/error, no method) is a reply to a
// server-initiated request — we never send those, so we just 202 it. Anything
// else is malformed.
export type MessageKind = "request" | "notification" | "response" | "invalid";

export function classifyMessage(msg: unknown): MessageKind {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return "invalid";
  }
  const m = msg as Record<string, unknown>;
  const hasMethod = typeof m.method === "string";
  // id may legitimately be null, a string, or a number; "present" means the
  // key exists (a request), "absent" means a notification.
  const hasId = "id" in m && m.id !== undefined;
  if (hasMethod && hasId) return "request";
  if (hasMethod && !hasId) return "notification";
  if (!hasMethod && hasId && ("result" in m || "error" in m)) return "response";
  return "invalid";
}

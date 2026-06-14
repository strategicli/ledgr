// Slice 36 verification (ADR-047): the MCP server. Pure protocol (version
// negotiation, message classification, JSON-RPC envelope), the method
// dispatcher (initialize / tools/list / ping / unknown / notification), and the
// six tools run end-to-end against live Neon (create → relate → get → search →
// list-by-entity/date → update → list_types), plus validation and owner
// scoping. Creates two temp owners and cleans up. Run:
//   npx tsx scripts/verify-mcp.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { eq } = await import("drizzle-orm");
const protocol = await import("../src/lib/mcp/protocol");
const { handleMcpMessage } = await import("../src/lib/mcp/server");
const { listToolDefs, callTool } = await import("../src/lib/mcp/tools");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// Small typed accessors for the JSON-RPC envelopes the dispatcher returns.
const resultOf = (r: unknown) => (r as { result?: Record<string, unknown> }).result ?? {};
const errorOf = (r: unknown) => (r as { error?: { code?: number } }).error;

// --- pure protocol --------------------------------------------------------
check("negotiate echoes a supported version", protocol.negotiateProtocolVersion("2025-03-26") === "2025-03-26");
check("negotiate unsupported -> latest", protocol.negotiateProtocolVersion("1.0.0") === protocol.LATEST_PROTOCOL_VERSION);
check("negotiate undefined -> latest", protocol.negotiateProtocolVersion(undefined) === protocol.LATEST_PROTOCOL_VERSION);
check("isSupportedProtocolVersion true", protocol.isSupportedProtocolVersion("2025-06-18"));
check("isSupportedProtocolVersion false", !protocol.isSupportedProtocolVersion("nope"));
check("classify request", protocol.classifyMessage({ jsonrpc: "2.0", id: 1, method: "ping" }) === "request");
check("classify notification", protocol.classifyMessage({ jsonrpc: "2.0", method: "notifications/initialized" }) === "notification");
check("classify response", protocol.classifyMessage({ jsonrpc: "2.0", id: 1, result: {} }) === "response");
check("classify invalid (empty)", protocol.classifyMessage({}) === "invalid");
check("classify invalid (array, no batching in 2025-06-18)", protocol.classifyMessage([{}]) === "invalid");
const errEnv = protocol.rpcError(7, protocol.JSONRPC.METHOD_NOT_FOUND, "x");
check("rpcError shape", errEnv.jsonrpc === "2.0" && errEnv.id === 7 && "error" in errEnv && errEnv.error.code === -32601);
const resEnv = protocol.rpcResult(8, { ok: true });
check("rpcResult shape", resEnv.jsonrpc === "2.0" && resEnv.id === 8 && "result" in resEnv);

// --- dispatcher (no DB needed) --------------------------------------------
const DUMMY = "00000000-0000-0000-0000-000000000000";
const initRes = await handleMcpMessage(
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "0" } } },
  DUMMY
);
const initResult = resultOf(initRes);
check("initialize negotiates the client's version", initResult.protocolVersion === "2025-06-18");
check("initialize advertises tools capability", !!(initResult.capabilities as { tools?: unknown })?.tools);
check("initialize serverInfo.name = ledgr", (initResult.serverInfo as { name?: string })?.name === "ledgr");
check("initialize includes instructions", typeof initResult.instructions === "string" && (initResult.instructions as string).length > 0);

const listRes = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, DUMMY);
const toolList = (resultOf(listRes).tools ?? []) as { name: string; description: string; inputSchema: { type: string; properties: unknown }; annotations: { readOnlyHint?: boolean } }[];
const EXPECTED = ["search_items", "list_items", "get_item", "create_item", "update_item", "list_types"];
check("tools/list returns all six tools", EXPECTED.every((n) => toolList.some((t) => t.name === n)));
check("every tool has an object inputSchema", toolList.every((t) => t.inputSchema?.type === "object" && !!t.inputSchema.properties));
check("every tool has a non-empty description", toolList.every((t) => typeof t.description === "string" && t.description.length > 0));
check("read tools are flagged readOnly", ["search_items", "list_items", "get_item", "list_types"].every((n) => toolList.find((t) => t.name === n)!.annotations.readOnlyHint === true));
check("write tools are not readOnly", ["create_item", "update_item"].every((n) => toolList.find((t) => t.name === n)!.annotations.readOnlyHint === false));
check("listToolDefs strips the handler", listToolDefs().every((d) => !("handler" in (d as Record<string, unknown>))));

const pingRes = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "ping" }, DUMMY);
check("ping returns an empty result", JSON.stringify(resultOf(pingRes)) === "{}");
const unknownRes = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "frobnicate" }, DUMMY);
check("unknown method -> -32601", errorOf(unknownRes)?.code === -32601);
const notifRes = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, DUMMY);
check("notification -> null (route sends 202)", notifRes === null);
const invalidRes = await handleMcpMessage({}, DUMMY);
check("invalid message -> -32600", errorOf(invalidRes)?.code === -32600);

// --- tools/call against live Neon -----------------------------------------
type Json = Record<string, unknown>;
const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-mcp-${stamp}@example.invalid` }).returning({ id: users.id });
const [owner2] = await db.insert(users).values({ email: `verify-mcp2-${stamp}@example.invalid` }).returning({ id: users.id });
const ownerId = owner.id;
const owner2Id = owner2.id;

async function callJson(o: string, name: string, args: Json): Promise<Json> {
  const r = await callTool(o, name, args);
  if (r.isError) throw new Error(`tool ${name} unexpectedly errored: ${r.content[0]?.text}`);
  return JSON.parse(r.content[0].text) as Json;
}
async function expectErr(label: string, o: string, name: string, args: Json) {
  const r = await callTool(o, name, args);
  check(label, r.isError === true, r.isError ? r.content[0].text : "did not error");
}
const itemsOf = (j: Json) => (j.items ?? []) as Json[];

try {
  const dueStr = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  const entity = await callJson(ownerId, "create_item", { type: "entity", title: `Roger Zentaur ${stamp}`, kind: "person" });
  check("create_item returns an id", typeof entity.id === "string");
  check("create_item set the entity kind", entity.kind === "person");
  check("create_item defaults inbox=false (filed, not captured)", entity.inbox === false);

  const task = await callJson(ownerId, "create_item", {
    type: "task",
    title: `Follow up Zentaur ${stamp}`,
    bodyMarkdown: "Discuss the Zentaur **budget**.",
    dueDate: dueStr,
    status: "open",
    urgency: "normal",
    relateTo: [entity.id as string],
  });
  check("create_item made an open task", task.type === "task" && task.status === "open");
  check("create_item recorded the relateTo edge", Array.isArray(task.relatedTo) && (task.relatedTo as string[]).includes(entity.id as string));

  const got = await callJson(ownerId, "get_item", { id: task.id as string });
  check("get_item returns the markdown body verbatim", got.body === "Discuss the Zentaur **budget**.");
  check("get_item lists the related entity as confirmed", (got.related as Json[]).some((r) => r.id === entity.id && r.matchState === "confirmed"));

  const search = await callJson(ownerId, "search_items", { query: "Zentaur" });
  check("search_items finds the items (FTS over title+body)", (search.count as number) >= 2 && itemsOf(search).some((i) => i.id === task.id));
  const searchEntity = await callJson(ownerId, "search_items", { query: "Zentaur", type: "entity" });
  check("search_items filters by type", itemsOf(searchEntity).length >= 1 && itemsOf(searchEntity).every((i) => i.type === "entity"));

  const byEntity = await callJson(ownerId, "list_items", { type: "task", status: "open", entityId: entity.id as string });
  check("list_items by entity returns the open task", itemsOf(byEntity).some((i) => i.id === task.id));

  const byWeek = await callJson(ownerId, "list_items", { type: "task", due: "week", dateField: "dueDate" });
  check("list_items due=week includes the +2d task", itemsOf(byWeek).some((i) => i.id === task.id));
  const overdue = await callJson(ownerId, "list_items", { type: "task", due: "overdue", dateField: "dueDate" });
  check("list_items due=overdue excludes the future task", !itemsOf(overdue).some((i) => i.id === task.id));

  const updated = await callJson(ownerId, "update_item", { id: task.id as string, status: "done" });
  check("update_item set status=done", updated.status === "done");
  const stillOpen = await callJson(ownerId, "list_items", { type: "task", status: "open", entityId: entity.id as string });
  check("list_items open no longer returns the done task", !itemsOf(stillOpen).some((i) => i.id === task.id));

  const typesOut = await callJson(ownerId, "list_types", {});
  check("list_types lists the five system types", ["task", "meeting", "note", "link", "entity"].every((k) => (typesOut.types as Json[]).some((t) => t.key === k)));

  // Full transport path: a tools/call routed through the dispatcher.
  const dispatched = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_types", arguments: {} } }, ownerId);
  const dispatchedContent = (resultOf(dispatched).content ?? []) as { type: string; text: string }[];
  check("dispatcher tools/call returns text content", dispatchedContent[0]?.type === "text" && dispatchedContent[0].text.includes("\"task\""));

  // Validation / error surfacing (isError results, not thrown).
  await expectErr("create_item with an unknown type errors", ownerId, "create_item", { type: `nope_${stamp}`, title: "x" });
  await expectErr("create_item missing type errors", ownerId, "create_item", { title: "x" });
  await expectErr("get_item with a bad UUID errors", ownerId, "get_item", { id: "not-a-uuid" });
  await expectErr("get_item for a missing item errors", ownerId, "get_item", { id: DUMMY });
  await expectErr("an unknown tool errors", ownerId, "frobnicate", {});
  await expectErr("update_item with no fields errors", ownerId, "update_item", { id: task.id as string });

  // Owner scoping: owner2 cannot see owner1's data.
  await expectErr("owner2 cannot get_item owner1's item", owner2Id, "get_item", { id: task.id as string });
  const owner2List = await callJson(owner2Id, "list_items", { type: "task" });
  check("owner2's list excludes owner1's task", !itemsOf(owner2List).some((i) => i.id === task.id));
} finally {
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, owner2Id));
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(users).where(eq(users.id, owner2Id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

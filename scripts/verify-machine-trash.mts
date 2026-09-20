// ADR-267 verification: Trash is reachable over the machine API and MCP.
//
// The gap this closes: the app has had soft-delete since slice 6 (Trash, a
// 30-day purge, cascade to live children, matching restore), and the in-app
// routes have called it the whole time — but no MCP tool and no machine-API
// method did. An agent that filed a duplicate had no way to undo its own work.
// Now: DELETE /api/machine/items (batch), DELETE /api/machine/items/<id>,
// POST /api/machine/items/<id>/restore, ?trash=true on the list, and the MCP
// tools delete_item / restore_item — all over the same softDeleteItem /
// restoreItem the app uses. Soft only; nothing here hard-deletes.
//
// Runs the real route handlers and tool handlers against the dev DB with a
// real minted credential. DB-backed, so verify-ci.mjs classifies it
// local/manual.
//   npx tsx scripts/verify-machine-trash.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { eq, inArray } = await import("drizzle-orm");
const { getDb } = await import("../src/db");
const { apiCredentials, items } = await import("../src/db/schema");
const { createCredential, revokeCredential } = await import("../src/lib/auth/credentials");
const { resolveMachineOwner } = await import("../src/lib/machine/owner");
const { createItem } = await import("../src/lib/item-mutations");
const { trashTools } = await import("../src/lib/mcp/tools/trash");
const listRoute = await import("../src/app/api/machine/items/route");
const itemRoute = await import("../src/app/api/machine/items/[id]/route");
const restoreRoute = await import("../src/app/api/machine/items/[id]/restore/route");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = await resolveMachineOwner();
if (!ownerId) {
  console.error("No machine owner. Set DEV_USER_EMAIL in .env.local and seed the dev DB.");
  process.exit(1);
}
const made = await createCredential(ownerId, `verify-machine-trash ${Date.now()}`, ["api"]);
if (!made.ok) {
  console.error(`could not mint a credential: ${made.error}`);
  process.exit(1);
}
const AUTH = `Basic ${Buffer.from(`${made.keyId}:${made.secret}`).toString("base64")}`;
const BASE = "http://localhost/api/machine/items";
const STAMP = `vmt${Date.now().toString(36)}`;
const created: string[] = [];

async function mk(title: string, parentId?: string) {
  const row = await createItem(ownerId!, { type: "note", title: `${STAMP} ${title}`, parentId });
  created.push(row.id);
  return row.id;
}
async function deletedAt(id: string) {
  const [r] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, id));
  return r?.d ?? null;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const hdr = { authorization: AUTH, "content-type": "application/json" };
async function call(res: Response) {
  return { status: res.status, json: await res.json() };
}
async function list(qs: string) {
  return call(await listRoute.GET(new Request(`${BASE}${qs}`, { headers: hdr })));
}
const tool = (name: string) => trashTools.find((t) => t.name === name)!;

try {
  // --- DELETE one, cascade, restore --------------------------------------------
  const parent = await mk("parent");
  const child = await mk("child", parent);
  const one = await call(await itemRoute.DELETE(new Request(`${BASE}/${parent}`, { method: "DELETE", headers: hdr }), ctx(parent)));
  check("DELETE /items/<id> is a 200 reporting rows trashed", one.status === 200 && one.json.deleted === 2, JSON.stringify(one.json));
  check("the item and its child are soft-deleted (deleted_at set), not gone", (await deletedAt(parent)) !== null && (await deletedAt(child)) !== null);
  const notLive = await list(`?id=${parent}`);
  check("a trashed item is out of the live list", notLive.json.items?.length === 0);
  const inTrash = await list(`?id=${parent},${child}&trash=true`);
  check("?trash=true lists it (and its child)", inTrash.status === 200 && inTrash.json.items?.length === 2, `${inTrash.json.items?.length} rows`);
  const badTrash = await list(`?trash=maybe`);
  check("a non-boolean trash= is a 400", badTrash.status === 400);
  const again = await call(await itemRoute.DELETE(new Request(`${BASE}/${parent}`, { method: "DELETE", headers: hdr }), ctx(parent)));
  check("deleting an already-trashed item is a JSON 404", again.status === 404 && typeof again.json.error === "string");

  const back = await call(await restoreRoute.POST(new Request(`${BASE}/${parent}/restore`, { method: "POST", headers: hdr }), ctx(parent)));
  check("POST /items/<id>/restore brings the unit back", back.status === 200 && back.json.restored === 2, JSON.stringify(back.json));
  check("both rows are live again", (await deletedAt(parent)) === null && (await deletedAt(child)) === null);
  const notInTrash = await call(await restoreRoute.POST(new Request(`${BASE}/${parent}/restore`, { method: "POST", headers: hdr }), ctx(parent)));
  check("restoring a live item is a JSON 404 'not found in trash'", notInTrash.status === 404 && /trash/.test(notInTrash.json.error ?? ""));

  // --- DELETE batch, three body shapes, partial failure ------------------------
  const a = await mk("a"), b = await mk("b"), c = await mk("c");
  const batch = await call(await listRoute.DELETE(new Request(BASE, { method: "DELETE", headers: hdr, body: JSON.stringify({ ids: [a, b, "not-a-uuid", "00000000-0000-4000-8000-000000000000"] }) })));
  check("DELETE batch { ids } trashes the good ids and reports the bad by index", batch.status === 200 && batch.json.count === 2 && batch.json.errors?.length === 2, JSON.stringify(batch.json));
  check("the errors name the problem", /UUID/.test(batch.json.errors?.[0]?.error ?? "") && /not found/.test(batch.json.errors?.[1]?.error ?? ""), JSON.stringify(batch.json.errors));
  const asItems = await call(await listRoute.DELETE(new Request(BASE, { method: "DELETE", headers: hdr, body: JSON.stringify({ items: [{ id: c }] }) })));
  check("DELETE batch { items: [{ id }] } works too", asItems.status === 200 && asItems.json.count === 1);
  const d = await mk("d");
  const bare = await call(await listRoute.DELETE(new Request(BASE, { method: "DELETE", headers: hdr, body: JSON.stringify({ id: d }) })));
  check("DELETE with a bare { id } works", bare.status === 200 && bare.json.count === 1);
  const nothing = await call(await listRoute.DELETE(new Request(BASE, { method: "DELETE", headers: hdr, body: JSON.stringify({ title: "x" }) })));
  check("a body with none of the shapes is a 400 naming them", nothing.status === 400 && /ids/.test(nothing.json.error ?? ""));
  const allBad = await call(await listRoute.DELETE(new Request(BASE, { method: "DELETE", headers: hdr, body: JSON.stringify({ ids: [a] }) })));
  check("a batch where nothing was trashed is a 400", allBad.status === 400 && allBad.json.count === 0);
  const noAuth = await listRoute.DELETE(new Request(BASE, { method: "DELETE", body: JSON.stringify({ id: a }) }));
  check("DELETE without a credential is a 401", noAuth.status === 401);

  // --- MCP delete_item / restore_item -------------------------------------------
  const m1 = await mk("mcp one"), m2 = await mk("mcp two"), m2kid = await mk("mcp two's child", m2);
  const del = (await tool("delete_item").handler(ownerId, { id: m1, ids: [m2, m1] })) as Record<string, unknown>;
  check("delete_item takes id + ids, dedupes, and reports per id", del.trashed === 2 && del.failed === 0 && (del.results as unknown[]).length === 2, JSON.stringify(del));
  check("…cascading to the child", (await deletedAt(m2kid)) !== null);
  const delAgain = (await tool("delete_item").handler(ownerId, { ids: [m1, await mk("live one")] })) as Record<string, unknown>;
  check("an already-trashed id is reported, the rest still go", delAgain.trashed === 1 && delAgain.failed === 1, JSON.stringify(delAgain.results));
  let threw = "";
  try { await tool("delete_item").handler(ownerId, {}); } catch (e) { threw = (e as Error).message; }
  check("delete_item with neither id nor ids is a clear error", /id/.test(threw), threw);
  const res = (await tool("restore_item").handler(ownerId, { ids: [m1, m2] })) as Record<string, unknown>;
  check("restore_item brings both back (m2 with its child)", res.restored === 2 && ((res.results as { count: number }[])[1].count === 2), JSON.stringify(res));
  check("the child is live again", (await deletedAt(m2kid)) === null);
  check("delete_item is marked destructive, restore_item is not", tool("delete_item").annotations?.destructiveHint === true && tool("restore_item").annotations?.destructiveHint === false);
} finally {
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  await revokeCredential(ownerId, made.credential.id);
  await db.delete(apiCredentials).where(eq(apiCredentials.id, made.credential.id));
  console.log(`cleanup: removed ${created.length} test items and the test credential`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

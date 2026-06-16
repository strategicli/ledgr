// ADR-067 R2 verification: typed relation fields store their value as
// `relations` edges with role = the field key, read directionally from the
// item, and removed role-scoped so they don't disturb generic links. Against
// live Neon. Creates a temp user + items and cleans them up in finally.
// Run: npx tsx scripts/verify-relations-typed.mts  (safe to delete post-slice).
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const { relateItems, unrelateItems, outgoingRelationsByRole } = await import(
  "../src/lib/relations"
);
const { and, eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const stamp = Date.now();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-rel-typed-${stamp}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;
const createdItemIds: string[] = [];

async function mk(type: string, title: string) {
  const it = await createItem(ownerId, { type, title });
  createdItemIds.push(it.id);
  return it.id;
}

try {
  // A "book" host with typed fields; targets are people + another note.
  const host = await mk("note", `host ${stamp}`);
  const personA = await mk("person", `Alice ${stamp}`);
  const personB = await mk("person", `Bob ${stamp}`);
  const personC = await mk("person", `Carol ${stamp}`);

  // Typed-field writes: edges with role = the field key.
  await relateItems(ownerId, host, personA, "author");
  await relateItems(ownerId, host, personB, "attendees");
  // A generic +Relate edge to the SAME person the author field points at.
  await relateItems(ownerId, host, personA, "related");
  // A reverse edge with the same role, from a different item INTO the host.
  await relateItems(ownerId, personC, host, "author");

  // --- outgoingRelationsByRole buckets by role, directional (source = host) ---
  const byRole = await outgoingRelationsByRole(ownerId, host, [
    "author",
    "attendees",
  ]);
  const authors = byRole.get("author") ?? [];
  const attendees = byRole.get("attendees") ?? [];
  check("author field returns its one target", authors.length === 1 && authors[0].id === personA);
  check("attendees field returns its one target", attendees.length === 1 && attendees[0].id === personB);
  check(
    "directional: a reverse author edge (personC -> host) is not in the field",
    !authors.some((a) => a.id === personC)
  );
  check("unrequested roles aren't returned", !byRole.has("related"));
  check("a role with no edges buckets to []", (await outgoingRelationsByRole(ownerId, host, ["editor"])).get("editor")?.length === 0);

  // --- role-scoped removal leaves other edges intact ---
  await unrelateItems(ownerId, host, personA, { role: "author" });
  const afterRows = await db
    .select({ role: relations.role })
    .from(relations)
    .where(and(eq(relations.sourceId, host), eq(relations.targetId, personA)));
  const rolesLeft = afterRows.map((r) => r.role).sort();
  check(
    "role-scoped unrelate dropped 'author' but kept the generic 'related' edge",
    rolesLeft.length === 1 && rolesLeft[0] === "related"
  );
  const byRoleAfter = await outgoingRelationsByRole(ownerId, host, ["author"]);
  check("author field is now empty", (byRoleAfter.get("author") ?? []).length === 0);

  // The reverse author edge (personC -> host) was untouched by the host-scoped removal.
  const reverse = await db
    .select({ id: relations.id })
    .from(relations)
    .where(and(eq(relations.sourceId, personC), eq(relations.targetId, host), eq(relations.role, "author")));
  check("reverse edge into the host survives", reverse.length === 1);

  // --- create-on-miss (R3): an unmarked + inbox item, linked in place ---
  // This is the server work the @-mention / +Relate / untyped-field create row
  // does: create an `unmarked` item flagged for the Inbox, then relate it.
  const made = await createItem(ownerId, { type: "unmarked", title: `New thing ${stamp}`, inbox: true });
  createdItemIds.push(made.id);
  check("create-on-miss item is unmarked + inbox", made.type === "unmarked" && made.inbox === true);
  await relateItems(ownerId, host, made.id, "references");
  const refs = await outgoingRelationsByRole(ownerId, host, ["references"]);
  check("create-on-miss item links via the field role", (refs.get("references") ?? []).some((r) => r.id === made.id));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
} finally {
  if (createdItemIds.length > 0) {
    await db.delete(relations).where(
      inArray(relations.sourceId, createdItemIds)
    );
    await db.delete(relations).where(
      inArray(relations.targetId, createdItemIds)
    );
    await db.delete(items).where(inArray(items.id, createdItemIds));
  }
  await db.delete(users).where(eq(users.id, ownerId));
}

process.exit(failures === 0 ? 0 : 1);

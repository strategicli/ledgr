// Slice 28 verification: the interactive related-list contract end to end
// against live Neon under a throwaway owner. The component is UI, but its
// behaviors rest on a backend chain worth proving: a created item related to a
// host appears in the host's relatedTo-filtered query (create-inherits), a
// status toggle moves it across a status filter (inline check-off), and
// un-relating drops it from the view without deleting it (remove = un-relate).
// Run: npx tsx scripts/verify-embedded-views.mts  — safe to delete when closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { getItem } = await import("../src/lib/items");
const {
  createItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { relateItems, unrelateItems } = await import("../src/lib/relations");
const { queryViewItems } = await import("../src/lib/views");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-embedded-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

try {
  const host = await createItem(ownerId, { type: "person", title: "Roger" });
  const task = await createItem(ownerId, { type: "task", title: "Prep 1:1 agenda" });

  // create-inherits: relate the new task to the host person.
  await relateItems(ownerId, host.id, task.id);
  const related = await queryViewItems(ownerId, { type: "task", relatedTo: host.id });
  check("related task appears in host view", has(related, task.id));

  // an unrelated task must not appear.
  const stray = await createItem(ownerId, { type: "task", title: "Unrelated" });
  const related2 = await queryViewItems(ownerId, { type: "task", relatedTo: host.id });
  check("unrelated task stays out", !has(related2, stray.id));

  // inline check-off: marking done moves it across a status filter.
  const open = await queryViewItems(ownerId, { type: "task", status: "open", relatedTo: host.id });
  check("task shows under status=open", has(open, task.id));
  await updateItem(ownerId, task.id, { status: "done" });
  const stillOpen = await queryViewItems(ownerId, { type: "task", status: "open", relatedTo: host.id });
  check("done task drops from status=open", !has(stillOpen, task.id));
  const done = await queryViewItems(ownerId, { type: "task", status: "done", relatedTo: host.id });
  check("done task shows under status=done", has(done, task.id));

  // remove = un-relate: drops from the view, item survives.
  await unrelateItems(ownerId, host.id, task.id);
  const afterRemove = await queryViewItems(ownerId, { type: "task", relatedTo: host.id });
  check("un-related task leaves the view", !has(afterRemove, task.id));
  const survivor = await getItem(ownerId, task.id);
  check("the item itself still exists", survivor.id === task.id && survivor.deletedAt == null);
} finally {
  // relations cascade on item delete (ON DELETE CASCADE); items then users.
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

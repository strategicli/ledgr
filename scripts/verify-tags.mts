// E2 (ADR-094) verification: the `tag` type is a seeded-but-ordinary type, the
// three content types carry a built-in `tags` relation field, and tagging is a
// plain relations edge whose universal related panel answers "everything tagged
// X". Runs against the live Neon DB, then cleans up.
// Run with: node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/verify-tags.mts
import { readFileSync } from "node:fs";

// Minimal .env.local loader (DATABASE_URL only); no dotenv dependency.
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { ItemError, createItem } = await import("../src/lib/items");
const { relateItems, listRelatedItems, outgoingRelationsByRole } = await import(
  "../src/lib/relations"
);
const { listTypes } = await import("../src/lib/types");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function expectError(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "no error thrown");
  } catch (err) {
    check(name, err instanceof ItemError && err.code === "not_found", String(err));
  }
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
let tempUserId: string | null = null;

try {
  const types = await listTypes();

  // 1. The tag type is seeded and ordinary (not system, not in quick capture).
  const tag = types.find((t) => t.key === "tag");
  check("tag type is seeded", !!tag);
  check("tag is an ordinary type (is_system = false)", tag?.isSystem === false);
  check("tag is not in the quick-capture dropdown", tag?.showInQuickCapture === false);

  // 2. task / event / note carry the built-in `tags` relation field (-> tag, many).
  for (const key of ["task", "event", "note"]) {
    const def = types.find((t) => t.key === key);
    const f = def?.propertySchema.find((p) => p.key === "tags");
    check(`${key} has a built-in tags relation field`, !!f && f.kind === "relation");
    check(
      `${key} tags field targets the tag type (many)`,
      f?.targetType === "tag" && f?.cardinality === "many",
      `${f?.targetType}/${f?.cardinality}`
    );
  }

  // 3. Tagging round-trip: a task carries two tags; the field reads them back.
  const task = await createItem(ownerId, { type: "task", title: "E2 Tagged Task" });
  const pastors = await createItem(ownerId, { type: "tag", title: "Pastors" });
  const urgent = await createItem(ownerId, { type: "tag", title: "Urgent" });
  created.push(task.id, pastors.id, urgent.id);
  await relateItems(ownerId, task.id, pastors.id, "tags");
  await relateItems(ownerId, task.id, urgent.id, "tags");
  const tagged = (await outgoingRelationsByRole(ownerId, task.id, ["tags"])).get("tags") ?? [];
  check(
    "the tags field reads both tags back, both of type tag",
    tagged.length === 2 && tagged.every((x) => x.type === "tag"),
    tagged.map((x) => x.title).join(",")
  );

  // 4. "Everything tagged Pastors": the tag's universal related panel lists the task.
  const onPastors = await listRelatedItems(ownerId, pastors.id);
  check("the tag's related panel shows the tagged task", onPastors.some((r) => r.id === task.id));

  // 5. An event is taggable too (the field is on event); the tag gathers both.
  const ev = await createItem(ownerId, { type: "event", title: "E2 All Pastors", meetingAt: new Date() });
  created.push(ev.id);
  await relateItems(ownerId, ev.id, pastors.id, "tags");
  const evTags = (await outgoingRelationsByRole(ownerId, ev.id, ["tags"])).get("tags") ?? [];
  check("an event reads its own tags", evTags.some((x) => x.id === pastors.id));
  const onPastors2 = await listRelatedItems(ownerId, pastors.id);
  check(
    "the tag now gathers both the task and the event",
    [task.id, ev.id].every((id) => onPastors2.some((r) => r.id === id))
  );

  // 6. Owner scoping: a foreign owner's item never lands on our tag, and a
  // foreign owner cannot read our tag's related list at all.
  const temp = await db
    .insert(users)
    .values({ email: "verify-tags-temp@example.invalid" })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  const foreign = await db
    .insert(items)
    .values({ ownerId: tempUserId, type: "task", title: "Foreign Task" })
    .returning({ id: items.id });
  created.push(foreign[0].id);
  await db
    .insert((await import("../src/db/schema")).relations)
    .values({ sourceId: foreign[0].id, targetId: pastors.id, role: "tags" });
  const scoped = await listRelatedItems(ownerId, pastors.id);
  check("a cross-owner tagger is excluded", !scoped.some((r) => r.id === foreign[0].id));
  await expectError("foreign owner cannot read our tag's related list", () =>
    listRelatedItems(tempUserId!, pastors.id)
  );
} finally {
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

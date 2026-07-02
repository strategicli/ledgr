// ADR-110 verification: the editable note "date taken" (items.note_date).
// Pure (parseItemPayload coercion) + live Neon (createItem default for notes,
// task leaves it null, explicit value respected, PATCH updates + clears, getItem
// carries the column). Cleans up the items it creates. Run: npx tsx scripts/verify-note-date.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { getItem } = await import("../src/lib/items");
const {
  createItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { appTodayYmd } = await import("../src/lib/recurrence-service");
const { parseItemPayload } = await import("../src/lib/item-input");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];

console.log("\n# Pure: parseItemPayload coercion");
{
  const p = parseItemPayload({ noteDate: "2026-03-09" }, "patch");
  check("parses a YYYY-MM-DD noteDate to UTC-midnight Date", p.noteDate instanceof Date && p.noteDate.toISOString() === "2026-03-09T00:00:00.000Z");
  const cleared = parseItemPayload({ noteDate: null }, "patch");
  check("null noteDate round-trips as null", cleared.noteDate === null);
  let threw = false;
  try { parseItemPayload({ noteDate: "not-a-date" }, "patch"); } catch { threw = true; }
  check("rejects an unparseable noteDate", threw);
  const absent = parseItemPayload({ title: "x" }, "patch");
  check("omitted noteDate stays absent (not touched)", !("noteDate" in absent));
}

console.log("\n# Live: createItem defaults");
{
  const expected = `${appTodayYmd()}T00:00:00.000Z`;
  const note = await createItem(ownerId, { type: "note", title: "ADR-110 verify note" });
  created.push(note.id);
  check("a new note's noteDate defaults to today's UTC-midnight", note.noteDate?.toISOString() === expected, String(note.noteDate?.toISOString()));
  check("noteDate is distinct from created_at (a full instant)", note.createdAt.toISOString() !== expected || note.noteDate?.getTime() !== note.createdAt.getTime());

  const task = await createItem(ownerId, { type: "task", title: "ADR-110 verify task" });
  created.push(task.id);
  check("a new task leaves noteDate null", task.noteDate === null);

  const explicit = await createItem(ownerId, { type: "note", title: "explicit", noteDate: new Date("2025-12-25T00:00:00.000Z") });
  created.push(explicit.id);
  check("an explicit noteDate on create is respected", explicit.noteDate?.toISOString() === "2025-12-25T00:00:00.000Z");
}

console.log("\n# Live: PATCH updates + clears, getItem carries it");
{
  const note = await createItem(ownerId, { type: "note", title: "ADR-110 patch note" });
  created.push(note.id);
  await updateItem(ownerId, note.id, { noteDate: new Date("2026-01-15T00:00:00.000Z") });
  const after = await getItem(ownerId, note.id);
  check("updateItem persists a new noteDate", after.noteDate?.toISOString() === "2026-01-15T00:00:00.000Z");
  check("getItem carries the note_date column", "noteDate" in after);
  await updateItem(ownerId, note.id, { noteDate: null });
  const cleared = await getItem(ownerId, note.id);
  check("noteDate can be cleared to null", cleared.noteDate === null);
}

// Cleanup: hard-remove the items this run created (verification, not user data).
for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

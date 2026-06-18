// T4 verification (ADR-079): the published ICS task feed. Pure builder (ics.ts)
// — VCALENDAR/VEVENT structure, all-day dates, RRULE passthrough, VALARM default
// + per-task override, escaping, line folding, CRLF — plus the server assembler
// (ics-data.ts) against live Neon: token→owner resolution and the dated/recurring
// open-task selection. Run: npx tsx scripts/verify-ics.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { buildTaskCalendar } = await import("../src/lib/ics");
const { makeRecurrence } = await import("../src/lib/recurrence");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const STAMP = "20260617T120000Z";

console.log("\n# Pure: ICS builder");
{
  const ics = buildTaskCalendar(
    [{ id: "11111111-1111-1111-1111-111111111111", title: "Call the elder board", date: "2026-06-17", url: "https://x/items/1" }],
    { name: "Ledgr Tasks", dtstamp: STAMP }
  );
  check("wraps in VCALENDAR", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.trimEnd().endsWith("END:VCALENDAR"));
  check("CRLF line endings", ics.includes("\r\n") && !/[^\r]\n/.test(ics));
  check("all-day DTSTART", ics.includes("DTSTART;VALUE=DATE:20260617"));
  check("all-day DTEND is next day (exclusive)", ics.includes("DTEND;VALUE=DATE:20260618"));
  check("SUMMARY present", ics.includes("SUMMARY:Call the elder board"));
  check("UID namespaced", ics.includes("UID:11111111-1111-1111-1111-111111111111@ledgr"));
  check("default VALARM at 9am", ics.includes("TRIGGER:PT9H") && ics.includes("BEGIN:VALARM"));
  check("calendar name", ics.includes("X-WR-CALNAME:Ledgr Tasks"));
}
{
  const ics = buildTaskCalendar(
    [{ id: "22222222-2222-2222-2222-222222222222", title: "Weekly review", date: "2026-06-15", rrule: makeRecurrence({ freq: "weekly", byDay: ["MO"], dtstart: "2026-06-15" }).rrule }],
    { dtstamp: STAMP }
  );
  check("recurring emits RRULE", ics.includes("RRULE:FREQ=WEEKLY;BYDAY=MO"));
}
{
  const ics = buildTaskCalendar(
    [{ id: "33333333-3333-3333-3333-333333333333", title: "Pay invoice", date: "2026-06-17", reminderMinutes: 60 }],
    { dtstamp: STAMP }
  );
  check("per-task reminder overrides default", ics.includes("TRIGGER:-PT60M") && !ics.includes("TRIGGER:PT9H"));
}
{
  const ics = buildTaskCalendar(
    [{ id: "44444444-4444-4444-4444-444444444444", title: "Plan retreat; book venue, food", date: "2026-06-17" }],
    { dtstamp: STAMP }
  );
  check("escapes ; and ,", ics.includes("SUMMARY:Plan retreat\\; book venue\\, food"));
}
{
  const longTitle = "A".repeat(200);
  const ics = buildTaskCalendar(
    [{ id: "55555555-5555-5555-5555-555555555555", title: longTitle, date: "2026-06-17" }],
    { dtstamp: STAMP }
  );
  const folded = ics.split("\r\n").every((l) => l.length <= 75);
  check("folds long lines to <=75 octets", folded);
  check("continuation lines start with a space", ics.includes("\r\n "));
}

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const { updateSettings } = await import("../src/lib/settings");
const { resolveIcsOwner, listIcsTasks } = await import("../src/lib/ics-data");
const { eq: dEq, inArray } = await import("drizzle-orm");

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-ics-${stamp}@example.invalid` }).returning({ id: users.id });
const [other] = await db.insert(users).values({ email: `verify-ics-other-${stamp}@example.invalid` }).returning({ id: users.id });

try {
  console.log("\n# Service: token resolution + task selection");
  const token = `feedtoken${stamp}xyz`; // matches the 16-64 base64url shape
  await updateSettings(owner.id, { icsToken: token });
  check("resolveIcsOwner finds the owner", (await resolveIcsOwner(token)) === owner.id);
  check("resolveIcsOwner rejects unknown token", (await resolveIcsOwner("nope-not-a-real-token-123")) === null);
  check("resolveIcsOwner rejects malformed", (await resolveIcsOwner("short")) === null);

  const sched = await createItem(owner.id, { type: "task", title: "scheduled task", scheduledDate: ymdToUtc("2026-06-20") });
  const dueOnly = await createItem(owner.id, { type: "task", title: "due only", dueDate: ymdToUtc("2026-06-22") });
  const recurring = await createItem(owner.id, { type: "task", title: "recurring", scheduledDate: ymdToUtc("2026-06-15"), properties: { recurrence: makeRecurrence({ freq: "weekly", byDay: ["MO"], dtstart: "2026-06-15" }) } });
  await createItem(owner.id, { type: "task", title: "done", status: "done", scheduledDate: ymdToUtc("2026-06-20") });
  await createItem(owner.id, { type: "task", title: "no date" });
  await createItem(owner.id, { type: "note", title: "a note", dueDate: ymdToUtc("2026-06-20") });
  await createItem(other.id, { type: "task", title: "other owner", scheduledDate: ymdToUtc("2026-06-20") });

  const tasks = await listIcsTasks(owner.id, "https://ledgr.test");
  const ids = new Set(tasks.map((t) => t.id));
  check("includes scheduled, due-only, and recurring (3)", tasks.length === 3, `count=${tasks.length}`);
  check("includes the scheduled task", ids.has(sched.id));
  check("includes the due-only task", ids.has(dueOnly.id));
  check("excludes done / no-date / note / other-owner", !tasks.some((t) => /done|no date|note|other/.test(t.title)));

  const rec = tasks.find((t) => t.id === recurring.id)!;
  check("recurring carries the RRULE", rec.rrule === "FREQ=WEEKLY;BYDAY=MO");
  check("recurring anchors at dtstart", rec.date === "2026-06-15");
  check("due-only event date is the due day", tasks.find((t) => t.id === dueOnly.id)?.date === "2026-06-22");
  check("event url links back to the item", rec.url === `https://ledgr.test/items/${recurring.id}`);

  // The whole feed renders without throwing and includes all three.
  const feed = buildTaskCalendar(tasks, { dtstamp: STAMP });
  check("rendered feed has 3 VEVENTs", (feed.match(/BEGIN:VEVENT/g) || []).length === 3);
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

// Slices 9-11 verification (next_steps.md): exercises the Today data path
// (src/lib/today.ts) and the inbox flag (src/lib/items.ts) against the live
// Neon DB, then cleans up. Run with: npx tsx scripts/verify-today-inbox.mts
// Safe to delete once the slices are closed (like verify-subtasks.mts).
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
const {
  countInbox,
  listItems,
} = await import("../src/lib/items");
const {
  createItem,
  softDeleteItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { getTodayData, todayBounds, zonedMidnightUtc } = await import(
  "../src/lib/today"
);
const { inArray, sql } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const owners = await db.select({ id: users.id }).from(users);
const ownerId = owners[0].id;
const created: string[] = [];
let tempUserId: string | null = null;

try {
  // 1. Day-boundary math (no DB). New York is UTC-4 in June, UTC-5 in
  //    January; midnight on a spring-forward day is still standard time.
  const tz = "America/New_York";
  check(
    "zoned midnight, summer (EDT)",
    zonedMidnightUtc({ y: 2026, m: 6, d: 12 }, tz).toISOString() ===
      "2026-06-12T04:00:00.000Z"
  );
  check(
    "zoned midnight, winter (EST)",
    zonedMidnightUtc({ y: 2026, m: 1, d: 12 }, tz).toISOString() ===
      "2026-01-12T05:00:00.000Z"
  );
  check(
    "zoned midnight on the spring-forward day",
    zonedMidnightUtc({ y: 2026, m: 3, d: 8 }, tz).toISOString() ===
      "2026-03-08T05:00:00.000Z"
  );
  // 02:00Z on June 12 is still June 11 evening in New York.
  const b = todayBounds(new Date("2026-06-12T02:00:00Z"), tz);
  check(
    "late-evening UTC rolls back to the local day",
    b.today.d === 11 &&
      b.dayStart.toISOString() === "2026-06-11T04:00:00.000Z" &&
      b.dayEnd.toISOString() === "2026-06-12T04:00:00.000Z",
    JSON.stringify(b.today)
  );
  check(
    "due window uses plain UTC midnights",
    b.dueToday.toISOString() === "2026-06-11T00:00:00.000Z" &&
      b.dueCutoff.toISOString() === "2026-06-12T00:00:00.000Z"
  );

  // 2. Fixtures around the real "now".
  const now = new Date();
  const bounds = todayBounds(now);
  const midday = new Date(
    (bounds.dayStart.getTime() + bounds.dayEnd.getTime()) / 2
  );
  const dayMs = 24 * 60 * 60 * 1000;

  const mToday = await createItem(ownerId, { type: "event", title: "V9 meeting today", meetingAt: midday });
  const mEarly = await createItem(ownerId, { type: "event", title: "V9 meeting early", meetingAt: bounds.dayStart });
  const mTomorrow = await createItem(ownerId, { type: "event", title: "V9 meeting tomorrow", meetingAt: new Date(bounds.dayEnd.getTime() + 60_000) });
  const mPast = await createItem(ownerId, { type: "event", title: "V9 meeting yesterday", meetingAt: new Date(bounds.dayStart.getTime() - 60_000) });
  const tDueToday = await createItem(ownerId, { type: "task", title: "V9 due today", dueDate: bounds.dueToday });
  const tOverdue = await createItem(ownerId, { type: "task", title: "V9 overdue", dueDate: new Date(bounds.dueToday.getTime() - 3 * dayMs) });
  const tFuture = await createItem(ownerId, { type: "task", title: "V9 due tomorrow", dueDate: bounds.dueCutoff });
  const tDone = await createItem(ownerId, { type: "task", title: "V9 done today", dueDate: bounds.dueToday, status: "done" });
  const tTrashed = await createItem(ownerId, { type: "task", title: "V9 trashed today", dueDate: bounds.dueToday });
  created.push(mToday.id, mEarly.id, mTomorrow.id, mPast.id, tDueToday.id, tOverdue.id, tFuture.id, tDone.id, tTrashed.id);
  await softDeleteItem(ownerId, tTrashed.id);

  // 3. getTodayData windows, order, and shape.
  const data = await getTodayData(ownerId, now);
  const meetingIds = data.meetings.map((m) => m.id);
  check(
    "meetings: today's only, inclusive start, exclusive end",
    meetingIds.includes(mToday.id) &&
      meetingIds.includes(mEarly.id) &&
      !meetingIds.includes(mTomorrow.id) &&
      !meetingIds.includes(mPast.id)
  );
  check(
    "meetings ordered by time ascending",
    meetingIds.indexOf(mEarly.id) < meetingIds.indexOf(mToday.id)
  );
  const taskIds = data.dueTasks.map((t) => t.id);
  check(
    "tasks: open with due <= today; future/done/trashed excluded",
    taskIds.includes(tDueToday.id) &&
      taskIds.includes(tOverdue.id) &&
      !taskIds.includes(tFuture.id) &&
      !taskIds.includes(tDone.id) &&
      !taskIds.includes(tTrashed.id)
  );
  check(
    "tasks ordered oldest due first",
    taskIds.indexOf(tOverdue.id) < taskIds.indexOf(tDueToday.id)
  );
  const fetchedOverdue = data.dueTasks.find((t) => t.id === tOverdue.id)!;
  const fetchedDueToday = data.dueTasks.find((t) => t.id === tDueToday.id)!;
  check(
    "overdue/today split is clean against dueToday",
    fetchedOverdue.dueDate! < data.bounds.dueToday &&
      fetchedDueToday.dueDate! >= data.bounds.dueToday
  );
  check("recent items present and capped", data.recent.length > 0 && data.recent.length <= 8);
  const allRows = [...data.meetings, ...data.dueTasks, ...data.recent];
  check(
    "today rows carry no body",
    allRows.every((r) => !("body" in r) && !("bodyText" in r))
  );

  // 4. Owner scoping: another owner's meeting today stays invisible.
  const temp = await db
    .insert(users)
    .values({ email: `verify-today-${Date.now()}@example.org` })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  const foreign = await createItem(tempUserId, { type: "event", title: "V9 foreign meeting", meetingAt: midday });
  created.push(foreign.id);
  const data2 = await getTodayData(ownerId, now);
  check(
    "cross-owner meeting excluded",
    !data2.meetings.some((m) => m.id === foreign.id)
  );

  // 5. Inbox flag lifecycle.
  const before = await countInbox(ownerId);
  const plain = await createItem(ownerId, { type: "task", title: "V11 plain" });
  const captured = await createItem(ownerId, { type: "task", title: "V11 captured", inbox: true });
  const captured2 = await createItem(ownerId, { type: "note", title: "V11 captured note", inbox: true });
  created.push(plain.id, captured.id, captured2.id);
  check("inbox defaults to false", plain.inbox === false);
  check("inbox: true sticks on create", captured.inbox === true);
  check("count rises with arrivals", (await countInbox(ownerId)) === before + 2);

  const inboxList = await listItems(ownerId, { inbox: true });
  const inboxIds = inboxList.map((i) => i.id);
  check(
    "inbox list filters to flagged live items",
    inboxIds.includes(captured.id) &&
      inboxIds.includes(captured2.id) &&
      !inboxIds.includes(plain.id)
  );
  check(
    "inbox rows expose the flag and no body",
    inboxList.every((i) => i.inbox === true && !("body" in i))
  );

  await updateItem(ownerId, captured.id, { inbox: false });
  check("triage clears the flag", (await countInbox(ownerId)) === before + 1);
  await softDeleteItem(ownerId, captured2.id);
  check("trashing an inbox item drops it from the count", (await countInbox(ownerId)) === before);

  // 6. Cross-owner inbox isolation + the partial index really exists.
  const foreignCapture = await createItem(tempUserId, { type: "task", title: "V11 foreign capture", inbox: true });
  created.push(foreignCapture.id);
  check("cross-owner captures don't count", (await countInbox(ownerId)) === before);
  const idx = await db.execute(
    sql`select indexdef from pg_indexes where indexname = 'items_inbox_idx'`
  );
  const def = String(idx.rows[0]?.indexdef ?? "");
  check(
    "items_inbox_idx is partial on inbox AND deleted_at",
    def.includes("WHERE") && def.includes("inbox") && def.includes("deleted_at"),
    def
  );
} finally {
  if (created.length > 0) {
    await db.delete(items).where(inArray(items.id, created));
  }
  if (tempUserId) {
    await db.delete(users).where(sql`id = ${tempUserId}`);
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

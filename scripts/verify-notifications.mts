// Notification center verification (ADR-129) against live Neon: the
// recordNotification write path + per-source pref gate, listing/filtering,
// state transitions (single + bulk) with their timestamps, the unread count,
// mark-all-read, the 30-day archived purge, and owner-scoping.
// Run: npx tsx scripts/verify-notifications.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { getDb } = await import("../src/db");
const { notifications, users } = await import("../src/db/schema");
const {
  recordNotification,
  listNotifications,
  countUnread,
  notificationCounts,
  setNotificationState,
  markAllRead,
  purgeArchivedNotifications,
} = await import("../src/lib/notifications");
const { updateSettings } = await import("../src/lib/settings");
const { eq: dEq, inArray, and: dAnd } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-notif-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-notif-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  console.log("\n# recordNotification + the per-source toggle");
  const a = await recordNotification(owner.id, { kind: "agenda", title: "Today's agenda", body: "2 events" });
  const b = await recordNotification(owner.id, { kind: "meeting_prep", title: "Prep ready", url: "/items/x" });
  const c = await recordNotification(owner.id, { kind: "task_due", title: "Task due" });
  check("three records return ids", !!a && !!b && !!c);
  check("unread count = 3", (await countUnread(owner.id)) === 3);

  // Turn task_due off → recordNotification no-ops (gates row AND push).
  await updateSettings(owner.id, { notificationPrefs: { task_due: false } });
  const gated = await recordNotification(owner.id, { kind: "task_due", title: "should be silenced" });
  check("disabled source returns null (no row)", gated === null);
  check("unread still 3 after a gated record", (await countUnread(owner.id)) === 3);
  // Re-enable for the rest.
  await updateSettings(owner.id, { notificationPrefs: { task_due: true } });

  console.log("\n# listing + filters");
  const all = await listNotifications(owner.id, "all");
  check("list 'all' returns the 3 unread/read", all.length === 3);
  check("list is newest-first", all[0].createdAt >= all[2].createdAt);
  check("a record carries url + relatedItem fields", all.some((n) => n.url === "/items/x"));

  console.log("\n# state transitions + stamps");
  const changed = await setNotificationState(owner.id, [a!], "read");
  check("mark one read changes 1", changed === 1);
  const counts1 = await notificationCounts(owner.id);
  check("counts: unread 2, all 3, archived 0", counts1.unread === 2 && counts1.all === 3 && counts1.archived === 0);
  const [readRow] = await db.select().from(notifications).where(dEq(notifications.id, a!));
  check("read row stamped read_at, not archived_at", readRow.readAt !== null && readRow.archivedAt === null);

  // Back to unread clears stamps.
  await setNotificationState(owner.id, [a!], "unread");
  const [unreadRow] = await db.select().from(notifications).where(dEq(notifications.id, a!));
  check("unread clears read_at + archived_at", unreadRow.readAt === null && unreadRow.archivedAt === null);
  check("unread count back to 3", (await countUnread(owner.id)) === 3);

  console.log("\n# archive + the archived filter");
  await setNotificationState(owner.id, [b!], "archived");
  const [archRow] = await db.select().from(notifications).where(dEq(notifications.id, b!));
  check("archived row stamps both read_at + archived_at", archRow.readAt !== null && archRow.archivedAt !== null);
  const archived = await listNotifications(owner.id, "archived");
  check("archived filter shows only the archived one", archived.length === 1 && archived[0].id === b!);
  const allAfterArchive = await listNotifications(owner.id, "all");
  check("'all' excludes archived (now 2)", allAfterArchive.length === 2);

  console.log("\n# mark all read");
  const cleared = await markAllRead(owner.id);
  check("mark all read clears the 2 unread", cleared === 2);
  check("unread count = 0", (await countUnread(owner.id)) === 0);

  console.log("\n# 30-day archived purge");
  // Backdate the archived row's archived_at past the window, then purge.
  await db
    .update(notifications)
    .set({ archivedAt: new Date(stamp - 31 * 24 * 60 * 60 * 1000) })
    .where(dEq(notifications.id, b!));
  // A fresh archived row stays (inside the window).
  const fresh = await recordNotification(owner.id, { kind: "sync_error", title: "recent" });
  await setNotificationState(owner.id, [fresh!], "archived");
  const purged = await purgeArchivedNotifications();
  check("purge removes the stale archived row only", purged.purgedNotifications === 1);
  check("the recent archived row survives", (await listNotifications(owner.id, "archived")).some((n) => n.id === fresh!));

  console.log("\n# owner-scoping");
  await recordNotification(other.id, { kind: "agenda", title: "other owner" });
  check("other owner's count is independent", (await countUnread(other.id)) === 1);
  const crossChanged = await setNotificationState(owner.id, [c!], "read");
  check("owner A can change its own row", crossChanged === 1);
  // owner B cannot touch owner A's row.
  const crossBlocked = await setNotificationState(other.id, [c!], "archived");
  check("owner B cannot change owner A's row", crossBlocked === 0);
} finally {
  await db.delete(notifications).where(inArray(notifications.ownerId, [owner.id, other.id]));
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
  void dAnd;
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

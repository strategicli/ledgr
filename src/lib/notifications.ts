// Notification center (ADR-129): owner-scoped CRUD over the notifications table.
// recordNotification is the one write path (called wherever a push fires); the
// read/state helpers back the /notifications page, the unread badge, and the
// bulk actions. Per-source toggles (users.settings.notificationPrefs) gate the
// write, so one switch silences both the persisted row and the push. The
// 30-day archived purge runs from the daily machine/purge cron.
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { getSettings, notificationEnabled, type NotificationKind } from "@/lib/settings";

// Notification center paused (ADR-130). The flag lives in its own db-free leaf
// module so client components can read it too; re-exported here for the server
// callers that already import from this file. See notifications-enabled.ts for
// the full rationale + how to re-enable.
export { NOTIFICATION_CENTER_ENABLED } from "@/lib/notifications-enabled";

// The lifecycle states (notifications.state). Linear: unread → read → archived,
// with unread reachable again via "mark unread".
export const NOTIFICATION_STATES = ["unread", "read", "archived"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export function isNotificationState(v: unknown): v is NotificationState {
  return (NOTIFICATION_STATES as readonly string[]).includes(v as string);
}

export type NotificationRecord = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  relatedItemId: string | null;
  state: NotificationState;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
};

export type NewNotification = {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  url?: string | null;
  relatedItemId?: string | null;
};

// Write one notification row, unless the owner has turned this source off
// (default-on). Returns the new row's id, or null when the source is disabled
// (so callers can treat a silenced source as a clean no-op). One row per call —
// callers that have N events to report call this N times (ADR-129).
export async function recordNotification(
  ownerId: string,
  n: NewNotification
): Promise<string | null> {
  const settings = await getSettings(ownerId);
  if (!notificationEnabled(settings.notificationPrefs, n.kind)) return null;
  const [row] = await getDb()
    .insert(notifications)
    .values({
      ownerId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      url: n.url ?? null,
      relatedItemId: n.relatedItemId ?? null,
    })
    .returning({ id: notifications.id });
  return row?.id ?? null;
}

const SELECT = {
  id: notifications.id,
  kind: notifications.kind,
  title: notifications.title,
  body: notifications.body,
  url: notifications.url,
  relatedItemId: notifications.relatedItemId,
  state: notifications.state,
  readAt: notifications.readAt,
  archivedAt: notifications.archivedAt,
  createdAt: notifications.createdAt,
};

// The page filter: a single state, or "all" = unread + read (NOT archived;
// archived is its own tab). Newest first.
export type ListFilter = NotificationState | "all";

export async function listNotifications(
  ownerId: string,
  filter: ListFilter = "all",
  limit = 200,
  offset = 0
): Promise<NotificationRecord[]> {
  const where =
    filter === "all"
      ? and(
          eq(notifications.ownerId, ownerId),
          inArray(notifications.state, ["unread", "read"])
        )
      : and(eq(notifications.ownerId, ownerId), eq(notifications.state, filter));
  const rows = await getDb()
    .select(SELECT)
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500))
    .offset(Math.max(offset, 0));
  return rows as NotificationRecord[];
}

// Unread count for the nav bell + the PWA app-icon badge. Indexed
// (owner_id, state, created_at), so this is a cheap covered count.
export async function countUnread(ownerId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(notifications)
    .where(
      and(eq(notifications.ownerId, ownerId), eq(notifications.state, "unread"))
    );
  return row?.n ?? 0;
}

// Per-tab counts for the filter strip (one round-trip).
export async function notificationCounts(
  ownerId: string
): Promise<{ unread: number; all: number; archived: number }> {
  const rows = await getDb()
    .select({ state: notifications.state, n: count() })
    .from(notifications)
    .where(eq(notifications.ownerId, ownerId))
    .groupBy(notifications.state);
  let unread = 0;
  let read = 0;
  let archived = 0;
  for (const r of rows) {
    if (r.state === "unread") unread = r.n;
    else if (r.state === "read") read = r.n;
    else if (r.state === "archived") archived = r.n;
  }
  return { unread, all: unread + read, archived };
}

// The stamps that go with a state. read_at marks when it left unread; arrived at
// archived keeps read_at and adds archived_at; going back to unread clears both.
function stampsFor(state: NotificationState, now: Date) {
  switch (state) {
    case "unread":
      return { state, readAt: null, archivedAt: null };
    case "read":
      return { state, readAt: now, archivedAt: null };
    case "archived":
      return { state, readAt: now, archivedAt: now };
  }
}

// Set one or many notifications to a state, owner-scoped (a caller can only
// touch its own). Returns the number of rows changed.
export async function setNotificationState(
  ownerId: string,
  ids: string[],
  state: NotificationState,
  now = new Date()
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await getDb()
    .update(notifications)
    .set(stampsFor(state, now))
    .where(
      and(
        eq(notifications.ownerId, ownerId),
        inArray(notifications.id, ids)
      )
    )
    .returning({ id: notifications.id });
  return rows.length;
}

// "Mark all read": every currently-unread notification → read. Returns the
// count marked.
export async function markAllRead(
  ownerId: string,
  now = new Date()
): Promise<number> {
  const rows = await getDb()
    .update(notifications)
    .set({ state: "read", readAt: now })
    .where(
      and(eq(notifications.ownerId, ownerId), eq(notifications.state, "unread"))
    )
    .returning({ id: notifications.id });
  return rows.length;
}

// 30-day purge of archived notifications (ADR-129), run from machine/purge.
// Matches Trash's retention posture: an archived notification is the owner's
// "done with it" signal, so it's safe to hard-delete after the window.
export async function purgeArchivedNotifications(
  retentionDays = 30,
  now = new Date()
): Promise<{ purgedNotifications: number }> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .delete(notifications)
    .where(
      and(
        eq(notifications.state, "archived"),
        lt(notifications.archivedAt, cutoff)
      )
    )
    .returning({ id: notifications.id });
  return { purgedNotifications: rows.length };
}

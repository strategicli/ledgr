// The two things Claude Runs does (ADR-286): notify once when a run asks for
// it (retrying when nothing got through), and move old runs to Trash. Deterministic, no model (Principle 3).
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { softDeleteItem } from "@/lib/item-mutations";
import { captureError } from "@/lib/log";
import { countUnread, recordNotification } from "@/lib/notifications";
import { notificationCenterOn } from "@/lib/notifications-enabled";
import { sendToOwner } from "@/lib/push/notify";
import { getWebPushSender } from "@/lib/push/web-push";

import { summaryLine } from "./summary";

export const RUN_TYPE = "claude_run";
export const RETENTION_DAYS = 60;

// "Notify me" ticked and not yet delivered. Ledgr lowercases property keys, so
// the checkbox is `notifyme`; the camel-case spelling the first release told
// Claude to use is still honored so a run written that way notifies too.
const pending = sql`(${items.properties}->>'notifyme' = 'true' or ${items.properties}->>'notifyMe' = 'true') and not (${items.properties} ? 'notifiedAt')`;

// How many times one copy tries before it gives up and says so. The retry job
// runs every 15 minutes, so this is roughly two hours of trying.
export const MAX_NOTIFY_ATTEMPTS = 8;

type RetryMark = { on: string; attempts: number };

// This copy's own id, so a retry is only ever picked up by the copy whose send
// failed. Every copy keeps its own push sign-ups and its own inbox, and the run
// syncs everywhere, so a retry any copy could take would notify twice.
async function thisCopy(): Promise<string> {
  const { readLocalDeviceId } = await import("@/lib/sync/client");
  return (await readLocalDeviceId()) ?? "this-copy";
}

// Deliver a run's notification once, the first time it has "Notify me" ticked:
// a row in the notification inbox (the bell and the phone app read it) while
// the Notification center module is on, plus a push to every device signed up
// for push on this copy. The claim (stamping notifiedAt only where it is
// absent) happens before sending, so two saves racing can never notify twice.
// Delivered means the inbox row landed or at least one device took the push.
// When neither happened the claim is released and the run is marked for this
// copy to retry (retryPendingNotifications), never dropped silently.
export async function notifyIfAsked(ownerId: string, itemId: string): Promise<void> {
  const db = getDb();
  const where = and(
    eq(items.id, itemId),
    eq(items.ownerId, ownerId),
    eq(items.type, RUN_TYPE),
    isNull(items.deletedAt),
    pending
  );
  const [hit] = await db
    .update(items)
    .set({
      properties: sql`coalesce(${items.properties}, '{}'::jsonb) || jsonb_build_object('notifiedAt', now())`,
      updatedAt: sql`now()`,
    })
    .where(where)
    .returning({ title: items.title, body: items.body, properties: items.properties });
  if (!hit) return;

  const title = hit.title || "Claude Run";
  const body = summaryLine(hit.body);
  const url = `/items/${itemId}`;
  const problems: string[] = [];

  let inboxed = false;
  if (await notificationCenterOn(ownerId)) {
    inboxed = (await recordNotification(ownerId, { kind: "claude_run", title, body, url, relatedItemId: itemId })) !== null;
  }

  const sender = getWebPushSender();
  let pushed = 0;
  if (!sender) {
    problems.push("push is not set up on this copy (VAPID keys)");
  } else {
    const tally = await sendToOwner(ownerId, sender, {
      title,
      body,
      url,
      tag: `claude-run-${itemId}`,
      ...(inboxed ? { count: await countUnread(ownerId) } : {}),
    });
    pushed = tally.sent;
    if (tally.sent === 0) problems.push(`the push reached no device (${JSON.stringify(tally)})`);
  }

  if (problems.length > 0) {
    await captureError("claude-runs", new Error(`Claude Run notification: ${problems.join("; ")}`), {
      detail: { itemId, inboxed, pushed },
    });
  }
  if (inboxed || pushed > 0) return;

  // Nothing reached the owner. Release the claim and queue a retry on this
  // copy, or, past the attempt cap, leave it claimed and say it gave up.
  const props = (hit.properties ?? {}) as Record<string, unknown>;
  const prev = props.notifyRetry as RetryMark | undefined;
  const attempts = (prev?.attempts ?? 0) + 1;
  if (attempts >= MAX_NOTIFY_ATTEMPTS) {
    await captureError(
      "claude-runs",
      new Error(`gave up notifying about a Claude Run after ${attempts} tries`),
      { detail: { itemId } }
    );
    return;
  }
  const mark: RetryMark = { on: await thisCopy(), attempts };
  await db
    .update(items)
    .set({
      properties: sql`(coalesce(${items.properties}, '{}'::jsonb) - 'notifiedAt') || jsonb_build_object('notifyRetry', ${JSON.stringify(mark)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
}

// Try again for every run whose notification failed on THIS copy. Called by
// the claude-run-notify job every 15 minutes. Returns how many it retried.
export async function retryPendingNotifications(ownerId: string): Promise<number> {
  const me = await thisCopy();
  const rows = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, RUN_TYPE),
        isNull(items.deletedAt),
        pending,
        sql`${items.properties} #>> '{notifyRetry,on}' = ${me}`
      )
    );
  for (const { id } of rows) await notifyIfAsked(ownerId, id);
  return rows.length;
}

// Move runs older than the retention window to Trash (which purges itself 30
// days later). Owner-scoped; returns how many went.
export async function trashOldRuns(ownerId: string, days = RETENTION_DAYS): Promise<number> {
  const old = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, RUN_TYPE),
        isNull(items.deletedAt),
        lt(items.createdAt, sql`now() - make_interval(days => ${days})`)
      )
    );
  let trashed = 0;
  for (const { id } of old) {
    // A run another copy already trashed may be gone by the time we reach it.
    trashed += await softDeleteItem(ownerId, id).then(
      () => 1,
      () => 0
    );
  }
  return trashed;
}

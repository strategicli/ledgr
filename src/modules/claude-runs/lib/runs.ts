// The two things Claude Runs does (ADR-284): ping once when a run asks for it,
// and move old runs to Trash. Deterministic, no model (Principle 3).
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { softDeleteItem } from "@/lib/item-mutations";
import { captureError } from "@/lib/log";
import { sendToOwner } from "@/lib/push/notify";
import { getWebPushSender } from "@/lib/push/web-push";

import { summaryLine } from "./summary";

export const RUN_TYPE = "claude_run";
export const RETENTION_DAYS = 60;

// "Notify me" ticked and not yet pinged.
const pending = sql`${items.properties}->>'notifyMe' = 'true' and not (${items.properties} ? 'notifiedAt')`;

// Ping the owner's phones once, the first time a run has "Notify me" ticked.
// The claim (stamping notifiedAt only where it is absent) happens before the
// send, so two saves racing can never ping twice. When push is not set up the
// run is left unclaimed and the gap goes to Build -> Errors, never silent.
export async function notifyIfAsked(ownerId: string, itemId: string): Promise<void> {
  const db = getDb();
  const where = and(
    eq(items.id, itemId),
    eq(items.ownerId, ownerId),
    eq(items.type, RUN_TYPE),
    isNull(items.deletedAt),
    pending
  );
  const [row] = await db.select({ id: items.id }).from(items).where(where);
  if (!row) return;
  const sender = getWebPushSender();
  if (!sender) {
    await captureError(
      "claude-runs",
      new Error("a Claude Run asked to notify, but push is not set up on this copy (VAPID keys)"),
      { detail: { itemId } }
    );
    return;
  }
  const [hit] = await db
    .update(items)
    .set({
      properties: sql`coalesce(${items.properties}, '{}'::jsonb) || jsonb_build_object('notifiedAt', now())`,
      updatedAt: sql`now()`,
    })
    .where(where)
    .returning({ title: items.title, body: items.body });
  if (!hit) return;
  const tally = await sendToOwner(ownerId, sender, {
    title: hit.title || "Claude Run",
    body: summaryLine(hit.body),
    url: `/items/${itemId}`,
    tag: `claude-run-${itemId}`,
  });
  if (tally.sent === 0) {
    await captureError("claude-runs", new Error("a Claude Run notification reached no device"), {
      detail: { itemId, ...tally },
    });
  }
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

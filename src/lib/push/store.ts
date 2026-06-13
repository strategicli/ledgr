// Owner-scoped CRUD for push subscriptions (slice 30). Subscribe is an upsert
// on the unique endpoint (re-subscribing the same browser is idempotent and
// re-points it at the current owner); prune removes dead endpoints the push
// service reported Gone.
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import type { PushSubscriptionRecord } from "./types";

export async function saveSubscription(
  ownerId: string,
  sub: PushSubscriptionRecord
): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({
      ownerId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { ownerId, p256dh: sub.p256dh, auth: sub.auth },
    });
}

// Unsubscribe by endpoint, owner-scoped (a caller can only drop its own).
export async function deleteSubscription(
  ownerId: string,
  endpoint: string
): Promise<void> {
  await getDb()
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.ownerId, ownerId),
        eq(pushSubscriptions.endpoint, endpoint)
      )
    );
}

export async function listSubscriptions(
  ownerId: string
): Promise<PushSubscriptionRecord[]> {
  const rows = await getDb()
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.ownerId, ownerId));
  return rows;
}

export async function countSubscriptions(ownerId: string): Promise<number> {
  return (await listSubscriptions(ownerId)).length;
}

// Prunes an endpoint the push service reported dead (404/410). Not
// owner-scoped: a Gone endpoint is dead for everyone, and the endpoint is
// globally unique.
export async function pruneSubscription(endpoint: string): Promise<void> {
  await getDb()
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

// Owner-scoped CRUD for push subscriptions (slice 30). Subscribe is an upsert
// on the unique endpoint (re-subscribing the same browser is idempotent and
// re-points it at the current owner); prune removes dead endpoints the push
// service reported Gone.
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import type { PushSubscriptionRecord } from "./types";

export async function saveSubscription(
  ownerId: string,
  sub: PushSubscriptionRecord,
  label: string | null = null
): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({
      ownerId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      label,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { ownerId, p256dh: sub.p256dh, auth: sub.auth, ...(label ? { label } : {}) },
    });
}

// One signed-up device, as Settings > Notifications lists it.
export type PushDevice = {
  id: string;
  label: string | null;
  endpoint: string;
  createdAt: Date;
};

export async function listDevices(ownerId: string): Promise<PushDevice[]> {
  return getDb()
    .select({
      id: pushSubscriptions.id,
      label: pushSubscriptions.label,
      endpoint: pushSubscriptions.endpoint,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.ownerId, ownerId))
    .orderBy(desc(pushSubscriptions.createdAt));
}

// The full record for one device (to send it a test), owner-scoped.
export async function getDevice(
  ownerId: string,
  id: string
): Promise<PushSubscriptionRecord | null> {
  const [row] = await getDb()
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.ownerId, ownerId), eq(pushSubscriptions.id, id)));
  return row ?? null;
}

export async function deleteDevice(ownerId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.ownerId, ownerId), eq(pushSubscriptions.id, id)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
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

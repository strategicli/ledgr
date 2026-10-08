// The db half of the drift watch: remember each hub's sync history across
// restarts, decide what is news, and tell the owner. The rules are in drift.ts
// (pure, verify-tested); the sync loop calls watchDrift every few minutes.
//
// WHY PERSIST. The loop's own record of the last successful sync lives in
// process memory, so a restart erased it, and a hub that had been failing for
// a week looked brand new the moment the service came back. The memory row is
// one job_state key per hub, written at most once per check.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState, users } from "@/db/schema";
import { createLogger } from "@/lib/log";
import { notificationCenterOn } from "@/lib/notifications-enabled";
import { countUnread, recordNotification } from "@/lib/notifications";
import { resolveNotifyOwner } from "@/lib/push/owner";
import { sendToOwner } from "@/lib/push/notify";
import { getWebPushSender } from "@/lib/push/web-push";
import {
  decideDrift,
  evaluateDrift,
  hostOf,
  type DriftMemory,
  type HubDriftInput,
} from "./drift";

const log = createLogger("sync-drift");

const memoryKey = (url: string) => `sync:drift:${url}`;

/** What the loop knows about a hub since this process started. */
export type HubDriftLive = Omit<
  HubDriftInput,
  "lastSuccessAt" | "trackedSince" | "undrainedStreak"
> & {
  /** Epoch ms of a success seen by this process, or null. */
  liveSuccessAt: number | null;
  /** Null until this process has finished an exchange with the hub. */
  liveUndrained: number | null;
};

async function readMemory(url: string, now: number): Promise<DriftMemory> {
  const [row] = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, memoryKey(url)));
  const v = (row?.value ?? {}) as Partial<DriftMemory>;
  return {
    lastSuccessAt: typeof v.lastSuccessAt === "number" ? v.lastSuccessAt : null,
    trackedSince: typeof v.trackedSince === "number" ? v.trackedSince : now,
    undrainedStreak: typeof v.undrainedStreak === "number" ? v.undrainedStreak : 0,
    open: v.open && typeof v.open === "object" ? v.open : {},
  };
}

async function writeMemory(url: string, value: DriftMemory): Promise<void> {
  await getDb()
    .insert(jobState)
    .values({ key: memoryKey(url), value })
    .onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date() } });
}

async function notifyOwnerId(): Promise<string | null> {
  const viaUpn = await resolveNotifyOwner();
  if (viaUpn) return viaUpn;
  // Single-owner install without the mailbox setting: the only users row.
  const [row] = await getDb().select({ id: users.id }).from(users).limit(1);
  return row?.id ?? null;
}

async function tellOwner(ownerId: string, title: string, body: string, url: string): Promise<void> {
  if (!(await notificationCenterOn(ownerId))) return;
  // Null means the owner switched "Sync & system errors" off: silence the push too.
  const recorded = await recordNotification(ownerId, { kind: "sync_error", title, body, url });
  if (recorded === null) return;
  const sender = getWebPushSender();
  if (!sender) return;
  await sendToOwner(ownerId, sender, {
    title,
    body,
    url,
    tag: `ledgr-sync-${title}`,
    count: await countUnread(ownerId),
  });
}

export async function watchDrift(hubs: HubDriftLive[], now = Date.now()): Promise<void> {
  let ownerId: string | null | undefined;
  for (const live of hubs) {
    const mem = await readMemory(live.url, now);
    const lastSuccessAt =
      live.liveSuccessAt !== null && live.liveSuccessAt > (mem.lastSuccessAt ?? 0)
        ? live.liveSuccessAt
        : mem.lastSuccessAt;
    const undrainedStreak = live.liveUndrained ?? mem.undrainedStreak;
    const problems = evaluateDrift({ ...live, lastSuccessAt, trackedSince: mem.trackedSince, undrainedStreak }, now);
    const decision = decideDrift(problems, mem.open, now);

    for (const p of problems) log.warn("sync drift", { hub: live.url, code: p.code, title: p.title });
    if (decision.announce.length > 0 || decision.recovered) {
      ownerId ??= await notifyOwnerId();
      if (ownerId) {
        for (const p of decision.announce) await tellOwner(ownerId, p.title, p.body, "/build/network");
        if (decision.recovered) {
          await tellOwner(
            ownerId,
            `Back in sync with ${hostOf(live.url)}`,
            "The sync problem reported earlier has cleared.",
            "/build/network"
          );
        }
      } else {
        log.warn("sync drift: no owner to notify", { hub: live.url });
      }
    }

    await writeMemory(live.url, {
      lastSuccessAt,
      trackedSince: mem.trackedSince,
      undrainedStreak,
      open: decision.open,
    });
  }
}

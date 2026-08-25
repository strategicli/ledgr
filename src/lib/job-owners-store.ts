// The db side of job ownership: read the slot, claim it, release it, and stamp
// a run. The decisions all live in src/lib/job-owners.ts (pure, CI-tested);
// this is the part that touches settings and the device identity.
//
// Split for the same reason snapshot-settings.ts is split from snapshots.ts: the
// pure half has to stay importable by a verify script that runs with no
// database.
import { hostname } from "node:os";
import { getSettings, updateSettings } from "@/lib/settings";
import { readLocalDeviceId } from "@/lib/sync/client";
import {
  claimFor,
  MOVABLE_JOBS,
  ownershipOf,
  shouldRunHere,
  type JobOwners,
  type MovableJob,
} from "@/lib/job-owners";

/**
 * What this machine goes by, in one phrase, for the claim it writes.
 *
 * A hostname is the right answer on a machine under a desk (it is what the
 * owner already calls it, and what `npm run local:status` prints). A Vercel
 * deploy has a meaningless container hostname, so it says "Cloud" — which is
 * also exactly the word the owner uses for it.
 */
export function installLabel(): string {
  if (process.env.VERCEL_ENV) return "Cloud";
  const name = (process.env.LEDGR_INSTALL_LABEL ?? hostname() ?? "").trim();
  return name || "This machine";
}

export async function readJobOwners(ownerId: string): Promise<JobOwners> {
  return (await getSettings(ownerId)).jobOwners;
}

/**
 * THE GATE, as one call a route can make. Returns the verdict plus enough
 * context to log or report it honestly.
 *
 * Reads settings fresh (getSettings is request-cached, not process-cached), so
 * a machine that lost the job between runs sees that on its next run.
 */
export async function jobRunVerdict(
  ownerId: string,
  job: MovableJob
): Promise<{ run: boolean; reason: "unset" | "owner" | "not-owner" | "nobody"; ownerLabel: string | null }> {
  const owners = await readJobOwners(ownerId);
  const selfDeviceId = await readLocalDeviceId();
  const verdict = shouldRunHere({ owners, job, selfDeviceId });
  const state = ownershipOf(owners, job);
  return {
    ...verdict,
    ownerLabel: state.state === "claimed" ? state.claim.label : null,
  };
}

/**
 * Record that the owner actually ran the job. This is what makes the liveness
 * warning mean "the work is happening" rather than "that device is online".
 *
 * Throttled to once an hour: the write goes through `users.settings`, which
 * SYNCS, so stamping every run of a 15-minute job would put a settings op on
 * the wire four times an hour for no added truth. Nothing reads this at finer
 * resolution than days.
 */
export async function stampJobRun(ownerId: string, job: MovableJob, now = new Date()): Promise<void> {
  const owners = await readJobOwners(ownerId);
  const state = ownershipOf(owners, job);
  if (state.state !== "claimed") return; // nothing to stamp: nobody claimed it
  const last = state.claim.lastRunAt ? Date.parse(state.claim.lastRunAt) : 0;
  if (Number.isFinite(last) && now.getTime() - last < 3_600_000) return;
  await updateSettings(ownerId, {
    jobOwners: { ...owners, [job]: { ...state.claim, lastRunAt: now.toISOString() } },
  });
}

export type ClaimAction = "claim" | "nobody" | "default";

/**
 * Move a job, from the machine the request is running on.
 *
 * `claim` is deliberately only ever "run it HERE": the slot has to carry a real
 * `sync_device` id, and this install only knows its own (see job-owners.ts's
 * header on the two id spaces). `nobody` and `default` work from anywhere,
 * which is what makes a job recoverable when the machine holding it is gone.
 */
export async function setJobOwner(
  ownerId: string,
  job: MovableJob,
  action: ClaimAction,
  now = new Date()
): Promise<{ owners: JobOwners; error?: string }> {
  const owners = await readJobOwners(ownerId);
  if (action === "default") {
    // Absent, not null: "as before this feature existed".
    const next = { ...owners };
    delete next[job];
    return { owners: (await updateSettings(ownerId, { jobOwners: next })).jobOwners };
  }
  if (action === "nobody") {
    const next: JobOwners = { ...owners, [job]: null };
    return { owners: (await updateSettings(ownerId, { jobOwners: next })).jobOwners };
  }
  if (!MOVABLE_JOBS[job].movable) {
    return { owners, error: MOVABLE_JOBS[job].blocked ?? "This one cannot be moved yet." };
  }
  const deviceId = await readLocalDeviceId();
  if (!deviceId) {
    return {
      owners,
      error:
        "This copy has no device identity yet, so it cannot take the job. It gets one the first time it syncs.",
    };
  }
  const previous = owners[job] ?? null;
  const next: JobOwners = {
    ...owners,
    [job]: claimFor({ deviceId, label: installLabel(), now, previous }),
  };
  return { owners: (await updateSettings(ownerId, { jobOwners: next })).jobOwners };
}

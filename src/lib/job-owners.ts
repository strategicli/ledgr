// Which install runs a scheduled job (the exclusive-jobs picker).
//
// THE PROBLEM. ADR-214 wrote down which scheduled jobs are EXCLUSIVE: exactly
// one install may run them, because each writes into something shared. Two
// installs exporting means two writers on one OneDrive folder, and because
// `items.exported_at` is itself synced, a double export is corrupting rather
// than merely wasteful. Two installs reading the mailbox means whichever gets
// there first is the only one that sees a message. Until now the rule was
// enforced by the owner remembering it: a config file per machine, each with
// its own on/off switch, and nothing anywhere that could see the conflict.
//
// THE FIX (exploration `sync-node-maturity.md` §1). Make two owners
// UNREPRESENTABLE rather than detectable: ownership is a SINGLE SLOT per job,
// held in `users.settings` — already in ADR-206's synced set, so every install
// sees the same answer and choosing a new owner IS removing the old one. There
// is no per-machine toggle to get out of step, because there is no per-machine
// toggle. Then two cheaper layers on top:
//
//   1. the slot (here) — a conflict cannot be stored
//   2. re-read before every run (`shouldRunHere`) — the one unpreventable race,
//      two installs claiming while partitioned and resolved by last-writer-wins
//      when they reconnect, costs at most ONE duplicated run, after which the
//      loser sees it lost and stands down with nobody reconfiguring anything
//   3. liveness (`ownershipWarning`) — a slot naming a machine that has not
//      actually RUN the job in days is a job silently not running, which is the
//      failure that hurts
//
// WHY CLAIMING IS PER-MACHINE, AND NOT THE DROPDOWN THE DOC SKETCHED. The
// exploration assumed any install could pick any other from a list, because
// "every install already has a stable device identity from `sync_device`". It
// does — but the hub's list of OTHER installs (`sync_peers`) is keyed by a
// uuid the HUB minted at add-device time, which is unrelated to that peer's own
// `sync_device.id` and is never reconciled with it. There is no registry that
// holds both, so "assign the job to that row over there" cannot be expressed
// without either a new synced table or a wire change, both of which are core.
// So: **the slot carries the claiming machine's own id AND the label it goes
// by**, a machine claims the job on itself ("Run it here"), and every other
// install can still read who owns it, release it, or hand it back to the
// default — from anywhere, because the label travels with the slot. The
// exactly-one guarantee is untouched; only the gesture changed.
//
// ABSENT IS NOT "NOBODY". An absent slot means "behave exactly as before this
// feature existed": every install runs the job on its own schedule, which for a
// local peer means the supervisor's `crons` default (off for every exclusive
// job) and for the cloud means its Vercel/Actions schedule. So an owner who
// never opens the picker changes nothing, and Tyler's instance is untouched.
// `null` is different and deliberate: it means the owner said NOBODY, and the
// surfaces say so out loud.
//
// Pure on purpose (no db, no fs, no env): the callers pass in what they read,
// so `scripts/verify-job-owners.mts` can exercise every branch in CI.

/** The jobs this picker can move. Keyed by the ADR-214 job name. */
export type MovableJob =
  | "export"
  | "calendar-sync"
  | "email-import"
  | "todoist-sync"
  | "transcription-poll"
  | "health-check";

export type JobDef = {
  /** What the job is, in the owner's words. No "cron", no "target". */
  label: string;
  /** One sentence: what this job does and why it matters. */
  what: string;
  /**
   * Can the owner move it TODAY?
   *
   * Moving a job is only safe when the new owner can pick up where the old one
   * left off, and that is a per-job fact about where the job keeps its place in
   * the queue. `export` hands off cleanly because `items.exported_at` is synced
   * — the new owner already knows what has been exported. The others keep their
   * place in per-instance `job_state`, which does NOT sync, so a new owner
   * starts from scratch: harmless for some, a silently consumed mailbox for
   * others. Each becomes claimable when its handoff has been proven, not before.
   */
  movable: boolean;
  /** Why not, shown beside the disabled control. Required when !movable. */
  blocked?: string;
  /**
   * The reliability trade, said out loud when the owner claims it on a machine
   * that sleeps. Null when a late run is harmlessly recoverable.
   */
  consequence: string | null;
};

export const MOVABLE_JOBS: Record<MovableJob, JobDef> = {
  export: {
    label: "Offline backup",
    what:
      "Writes a copy of everything to OneDrive as plain files. That copy is what you would open if the internet were down.",
    movable: true,
    consequence:
      "A backup that runs late is harmless: the next run catches up on everything that changed.",
  },
  "calendar-sync": {
    label: "Calendar sync",
    what: "Turns your calendar events into meeting records here.",
    // PROVEN 2026-08-25 (ADR-221). The worry was a second copy of the same
    // meeting, and it cannot happen: "have I already made a record for this
    // event?" is answered from `items.ms_event_id`, which SYNCS, so a machine
    // that has never run this job still knows every meeting every other copy
    // made. There is no place-in-the-queue to lose either, because each run
    // pulls the whole window fresh. `calendar_events` is a per-copy cache of
    // what is on offer, and a new owner refills it on its first run
    // (`verify-calendar-sync.mts` empties it and proves the next run creates
    // nothing).
    movable: true,
    consequence:
      "Meetings already brought in stay correct everywhere. The list of meetings waiting to be added only refreshes on the machine that runs it.",
  },
  "email-import": {
    label: "Email capture",
    what: "Turns messages you forward into items here.",
    // PROVEN 2026-08-25 (ADR-221). "Reading the mailbox consumes it" was true;
    // the conclusion drawn from it was not. What consumes a message is MOVING
    // it out of the pickup folder, and that move happens in the mailbox itself,
    // where every copy can see it. A new owner starting fresh lists the
    // folder's current contents, which is exactly the messages nobody has
    // brought in yet. The per-copy record is only an optimization on top of
    // that. The second guard is `items.properties.email.internetMessageId`,
    // which syncs, so even a message created but not yet moved is recognized
    // elsewhere (`verify-email-in.mts` hands the job over mid-flight and proves
    // it).
    movable: true,
    consequence:
      "Nothing is missed while it waits. A forwarded message stays in the folder until it has been brought in.",
  },
  "todoist-sync": {
    label: "Todoist sync",
    what: "Keeps tasks in step with Todoist, in both directions.",
    movable: false,
    blocked: "Moving this needs one check first: it writes to Todoist as well as reading from it.",
    consequence: null,
  },
  "transcription-poll": {
    label: "Transcription",
    what: "Collects finished transcripts of meeting recordings.",
    movable: false,
    blocked: "Moving this needs one check first: two machines would race for the same job.",
    consequence: null,
  },
  "health-check": {
    label: "Weekly check-up",
    what: "Looks everything over once a week and notifies you only if something needs attention.",
    movable: false,
    blocked:
      "Moving this needs one check first: notifications are registered per machine, so it would reach different devices.",
    consequence: null,
  },
};

export const MOVABLE_JOB_NAMES = Object.keys(MOVABLE_JOBS) as MovableJob[];

export function isMovableJob(name: string): name is MovableJob {
  return Object.hasOwn(MOVABLE_JOBS, name);
}

/**
 * One claim. The label travels with the id precisely so that an install which
 * has never met the owner can still name it in a sentence (see the header).
 */
export type JobClaim = {
  /** The claiming install's own `sync_device.id`. */
  deviceId: string;
  /** What that machine goes by. Its hostname, or "Cloud". */
  label: string;
  /** When it claimed the job, ISO. */
  claimedAt: string;
  /**
   * When the owner last actually RAN it, ISO. Stamped by the run itself, so
   * liveness here means "the work is happening", which is a stronger and more
   * useful claim than "that device is online".
   */
  lastRunAt: string | null;
};

/** `null` = the owner said nobody. Absent = as before this feature. */
export type JobOwners = Partial<Record<MovableJob, JobClaim | null>>;

function parseClaim(raw: unknown): JobClaim | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const deviceId = typeof o.deviceId === "string" ? o.deviceId.trim() : "";
  if (!deviceId) return undefined;
  const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : deviceId.slice(0, 8);
  return {
    deviceId,
    label,
    claimedAt: typeof o.claimedAt === "string" ? o.claimedAt : new Date(0).toISOString(),
    lastRunAt: typeof o.lastRunAt === "string" ? o.lastRunAt : null,
  };
}

/**
 * Tolerant read of `users.settings.jobOwners`. Anything unusable is dropped
 * rather than thrown: this is read before every scheduled run, and a settings
 * blob mangled by a future version must not stop the backup — it must fall back
 * to the old behavior, which absence already means.
 */
export function parseJobOwners(raw: unknown): JobOwners {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: JobOwners = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMovableJob(key)) continue;
    const claim = parseClaim(value);
    if (claim !== undefined) out[key] = claim;
  }
  return out;
}

/** What the record says about one job. */
export type Ownership =
  | { state: "unset" } // as before this feature: everyone runs it on their own schedule
  | { state: "nobody" } // the owner said nobody
  | { state: "claimed"; claim: JobClaim };

export function ownershipOf(owners: JobOwners, job: MovableJob): Ownership {
  if (!Object.hasOwn(owners, job)) return { state: "unset" };
  const claim = owners[job];
  return claim ? { state: "claimed", claim } : { state: "nobody" };
}

/**
 * THE GATE, called by the job's own route immediately before it does any work.
 *
 * One read, three answers, and the middle one is the whole point: a machine
 * that WAS the owner and no longer is stands down on its very next run without
 * anybody reconfiguring it.
 *
 * Note this can only ever REDUCE the set of installs that run a job, never
 * expand it — an unset slot is "as today" — which is why it is safe to apply
 * uniformly to every exclusive job, including the ones not yet claimable.
 */
export function shouldRunHere(opts: {
  owners: JobOwners;
  job: MovableJob;
  /** This install's own `sync_device` id. Null when it has none. */
  selfDeviceId: string | null;
}): { run: boolean; reason: "unset" | "owner" | "not-owner" | "nobody" } {
  const owner = ownershipOf(opts.owners, opts.job);
  if (owner.state === "unset") return { run: true, reason: "unset" };
  if (owner.state === "nobody") return { run: false, reason: "nobody" };
  return owner.claim.deviceId === opts.selfDeviceId
    ? { run: true, reason: "owner" }
    : { run: false, reason: "not-owner" };
}

/** Build the claim this install would write for itself. */
export function claimFor(opts: {
  deviceId: string;
  label: string;
  now: Date;
  /** Carried over when re-claiming a job this machine already had. */
  previous?: JobClaim | null;
}): JobClaim {
  const same = opts.previous && opts.previous.deviceId === opts.deviceId;
  return {
    deviceId: opts.deviceId,
    label: opts.label,
    claimedAt: same ? opts.previous!.claimedAt : opts.now.toISOString(),
    lastRunAt: same ? opts.previous!.lastRunAt : null,
  };
}

// ── Liveness: is the claim still true? ──────────────────────────────────────

/**
 * How long a claimed job may go without a run before the surfaces call it out.
 * Every claimable job runs at least daily, so three days is "something is
 * wrong" rather than "it is not due yet".
 */
export const OWNER_STALE_DAYS = 3;

export type OwnershipWarning =
  | { kind: "nobody"; text: string }
  | { kind: "never-ran"; text: string }
  | { kind: "stale"; days: number; text: string };

/**
 * The one sentence a surface shows when a job's ownership has gone bad, or null
 * when it is fine. Every case here is a job SILENTLY not running, which is
 * exactly the failure the picker exists to prevent, so none of them may be
 * inferred from silence (Principle 9).
 *
 * `unset` is deliberately not a warning: it is the old behavior, not a fault.
 */
export function ownershipWarning(opts: {
  owners: JobOwners;
  job: MovableJob;
  now: Date;
}): OwnershipWarning | null {
  const { label } = MOVABLE_JOBS[opts.job];
  const owner = ownershipOf(opts.owners, opts.job);
  if (owner.state === "unset") return null;
  if (owner.state === "nobody") {
    return { kind: "nobody", text: `${label} is not running anywhere. Nothing is set to do it.` };
  }
  const { claim } = owner;
  const claimed = Date.parse(claim.claimedAt);
  const ran = claim.lastRunAt ? Date.parse(claim.lastRunAt) : NaN;
  if (!Number.isFinite(ran)) {
    // Give a fresh claim a day before complaining: a nightly job has not missed
    // anything until a night has passed.
    const sinceClaim = Number.isFinite(claimed)
      ? Math.floor((opts.now.getTime() - claimed) / 86_400_000)
      : 0;
    if (sinceClaim < 1) return null;
    return {
      kind: "never-ran",
      text: `${label} is set to run on ${claim.label}, but it has not run once since you moved it there ${sinceClaim} ${sinceClaim === 1 ? "day" : "days"} ago.`,
    };
  }
  const days = Math.floor((opts.now.getTime() - ran) / 86_400_000);
  if (days >= OWNER_STALE_DAYS) {
    return {
      kind: "stale",
      days,
      text: `${label} last ran ${days} days ago on ${claim.label}. That machine is probably switched off.`,
    };
  }
  return null;
}

/**
 * How a job's owner reads in a status line, from any install. Deliberately
 * never says "cron" or "target", and names the machine rather than making the
 * reader map an id to a place.
 */
export function ownerLine(opts: {
  owners: JobOwners;
  job: MovableJob;
  selfDeviceId: string | null;
}): string {
  const owner = ownershipOf(opts.owners, opts.job);
  if (owner.state === "unset") return "Runs wherever it is switched on";
  if (owner.state === "nobody") return "Not running anywhere";
  return owner.claim.deviceId === opts.selfDeviceId
    ? "Runs on this machine"
    : `Runs on ${owner.claim.label}`;
}

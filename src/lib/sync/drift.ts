// Is this copy actually drifting from a copy it syncs with? (2026-10-08)
//
// THE GAP. A once-a-day sync means the other copy is up to a day behind, and
// that is the schedule working, not a fault. Nothing told the owner the
// difference: a sync that failed every round, a change the other copy refused
// for good, or a backlog that never cleared all looked exactly like the normal
// daily lag until someone opened Build → Network and read it. The "Sync &
// system errors" notification switch existed and nothing ever sent one.
//
// THE RULE. Alert only on drift BEYOND the schedule, so a daily hub never cries
// wolf. Five conditions, each measured against the hub's own sync window:
//
//   missed          no successful sync in twice the window
//   failing         the other copy turned us away several times in a row
//   refused         the other copy could not apply a change and parked it
//   not-catching-up two syncs in a row ended with changes still waiting
//   waiting         a change has waited more than twice the window to go out
//
// One notification when a problem starts, one when everything clears; never
// one per retry. Pure on purpose (no db): `scripts/verify-sync-drift.mts`
// exercises every branch. The db half is drift-watch.ts.

export type DriftCode = "missed" | "failing" | "refused" | "not-catching-up" | "waiting";

export type HubDriftInput = {
  url: string;
  cadenceMs: number;
  /** "Only when there are changes": a quiet hub legitimately goes unsynced
   *  until the liveness floor forces a round, so `missed` waits that long. */
  onChange: boolean;
  livenessFloorMs: number;
  /** Epoch ms of the last successful exchange, or null if none recorded. */
  lastSuccessAt: number | null;
  /** When this copy started watching the hub; the baseline before any success. */
  trackedSince: number;
  consecutiveFails: number;
  lastError: string | null;
  undrainedStreak: number;
  /** Changes the hub parked since the last check (an event, not a state). */
  parked: { count: number; first: string | null };
  /** Epoch ms of the oldest local change not yet sent to this hub. */
  oldestWaitingAt: number | null;
  /** False in pull-only mode, where nothing is ever sent. */
  pushing: boolean;
};

export type DriftProblem = { code: DriftCode; title: string; body: string };

/** A continuous hub's window is seconds; doubling that would page on a blip. */
export const MIN_WINDOW_MS = 30 * 60_000;
export const FAILS_BEFORE_ALERT = 3;
export const UNDRAINED_BEFORE_ALERT = 2;

export function driftWindowMs(cadenceMs: number): number {
  return Math.max(cadenceMs, MIN_WINDOW_MS);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "5 hours", "2 days": how a span reads in a sentence. */
export function spanText(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} minutes`;
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.floor(hours / 24)} days`;
}

export function evaluateDrift(h: HubDriftInput, now: number): DriftProblem[] {
  const host = hostOf(h.url);
  const windowMs = driftWindowMs(h.cadenceMs);
  const problems: DriftProblem[] = [];

  const since = h.lastSuccessAt ?? h.trackedSince;
  const missedLimit = h.onChange ? h.livenessFloorMs + windowMs : 2 * windowMs;
  if (now - since > missedLimit) {
    problems.push({
      code: "missed",
      title: `Not synced with ${host} in ${spanText(now - since)}`,
      body: h.lastSuccessAt
        ? `The last successful sync was ${spanText(now - since)} ago, more than twice the schedule. Open Network and press Check in now; any error shows there.`
        : `No sync has succeeded since this copy started watching ${spanText(now - since)} ago. Open Network and press Check in now; any error shows there.`,
    });
  }

  if (h.consecutiveFails >= FAILS_BEFORE_ALERT) {
    problems.push({
      code: "failing",
      title: `Syncing with ${host} keeps failing`,
      body: `${h.consecutiveFails} tries in a row failed${h.lastError ? `. The last one said: ${h.lastError}` : "."}`,
    });
  }

  if (h.parked.count > 0) {
    problems.push({
      code: "refused",
      title: `${host} refused ${h.parked.count} ${h.parked.count === 1 ? "change" : "changes"}`,
      body: `${h.parked.count === 1 ? "That change" : "Those changes"} will not reach it, and the rest of the sync went through.${h.parked.first ? ` The first: ${h.parked.first}` : ""}`,
    });
  }

  if (h.undrainedStreak >= UNDRAINED_BEFORE_ALERT) {
    problems.push({
      code: "not-catching-up",
      title: `${host} is not catching up`,
      body: `The last ${h.undrainedStreak} syncs each ended with changes still waiting, so the backlog is not clearing.`,
    });
  }

  if (h.pushing && h.oldestWaitingAt !== null && now - h.oldestWaitingAt > 2 * windowMs) {
    problems.push({
      code: "waiting",
      title: `A change has waited ${spanText(now - h.oldestWaitingAt)} to reach ${host}`,
      body: `That is more than twice the sync schedule. Open Network and press Check in now; any error shows there.`,
    });
  }

  return problems;
}

/** What the watcher remembers per hub between checks, and across restarts. */
export type DriftMemory = {
  lastSuccessAt: number | null;
  trackedSince: number;
  undrainedStreak: number;
  /** Problems already announced, code → when it started (ISO). */
  open: Partial<Record<DriftCode, string>>;
};

export type DriftDecision = {
  /** Problems to announce now: new ones, plus every refusal (each is news). */
  announce: DriftProblem[];
  /** True when something was open and now nothing is. */
  recovered: boolean;
  open: Partial<Record<DriftCode, string>>;
};

/** Which problems are news. A standing problem is announced once. */
export function decideDrift(
  problems: DriftProblem[],
  prevOpen: Partial<Record<DriftCode, string>>,
  now: number
): DriftDecision {
  const open: Partial<Record<DriftCode, string>> = {};
  const announce: DriftProblem[] = [];
  for (const p of problems) {
    if (p.code === "refused") {
      announce.push(p);
      continue;
    }
    open[p.code] = prevOpen[p.code] ?? new Date(now).toISOString();
    if (!prevOpen[p.code]) announce.push(p);
  }
  const wasOpen = Object.keys(prevOpen).length > 0;
  return { announce, recovered: wasOpen && Object.keys(open).length === 0, open };
}

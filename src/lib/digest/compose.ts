// Digest / check-ins (Project Type, ADR-111/PJ7) — the PURE engine. The Digest
// is a BEHAVIOR, not a widget (PRD §7): it surfaces nothing on the canvas; it
// pings you about projects that have gone QUIET (staleness) or have a milestone
// coming up. Deterministic — no model in the loop (Principle 3). This module is
// the testable decision + payload; the cron (digest/notify.ts) supplies the data
// and pushes the result.
const DAY_MS = 86_400_000;

export type DigestTrigger = "staleness" | "upcoming_milestone" | null;

export type DigestStatus = {
  trigger: DigestTrigger;
  // Whole days since the last activity / last review (the "quiet" clock).
  // Infinity when the project has never had any activity (we don't nag those).
  daysQuiet: number;
};

// Decide whether a project should ping, and why. Staleness wins over an upcoming
// milestone when both fire (the quiet project is the one you've forgotten). A
// project with no activity at all is skipped — it's empty/new, not neglected.
export function digestStatus(input: {
  lastActivityAt: Date | null;
  lastReviewedAt: Date | null;
  stalenessDays: number;
  // Days-until for each contained milestone with a future-or-today date (>= 0).
  upcomingMilestoneDays: number[];
  upcomingDays: number;
  now: Date;
}): DigestStatus {
  const ref = Math.max(
    input.lastActivityAt?.getTime() ?? 0,
    input.lastReviewedAt?.getTime() ?? 0
  );
  const daysQuiet = ref === 0 ? Infinity : Math.floor((input.now.getTime() - ref) / DAY_MS);
  const stale = ref !== 0 && daysQuiet >= input.stalenessDays;
  const hasUpcoming = input.upcomingMilestoneDays.some(
    (d) => d >= 0 && d <= input.upcomingDays
  );
  if (stale) return { trigger: "staleness", daysQuiet };
  if (hasUpcoming) return { trigger: "upcoming_milestone", daysQuiet };
  return { trigger: null, daysQuiet };
}

// Compose the deterministic payload from the three inputs the model already has
// (PRD §7): Recent Activity + Milestones + Next Action. Mirrors the PRD example
// "3 tasks closed this week, booklet-to-printer in 4 days, no notes in 9 days."
export function composeDigest(input: {
  title: string;
  tasksClosed: number;
  daysQuiet: number;
  nextActionText: string | null;
  upcoming?: { label: string; daysUntil: number } | null;
}): { title: string; body: string } {
  const bits: string[] = [];
  if (input.tasksClosed > 0) {
    bits.push(`${input.tasksClosed} task${input.tasksClosed === 1 ? "" : "s"} closed`);
  }
  if (input.upcoming) {
    const d = input.upcoming.daysUntil;
    const when = d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`;
    bits.push(`${input.upcoming.label} ${when}`);
  }
  if (Number.isFinite(input.daysQuiet) && input.daysQuiet > 0) {
    bits.push(`no activity in ${input.daysQuiet} day${input.daysQuiet === 1 ? "" : "s"}`);
  }
  if (input.nextActionText) bits.push(`next: ${input.nextActionText}`);
  return {
    title: input.title || "Project",
    body: bits.length ? bits.join(" · ") : "Time to check in.",
  };
}

// Days from `now` (UTC calendar day) to a milestone's UTC-midnight date; negative
// = already passed. Used to find "upcoming within N days".
export function daysUntil(date: Date, now: Date): number {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((d - todayUtc) / DAY_MS);
}

// Digest cron runner (Project Type, ADR-111/PJ7). Selects projects whose Digest
// behavior is on and that have gone quiet (staleness) or have a milestone coming
// up, composes a deterministic payload (Recent Activity + Milestones + Next
// Action — no model, Principle 3), and PUSHES it (push is the built, reachable
// channel; email is a flagged fast-follow behind a future MailSender seam). The
// review-resets-clock loop is already first-class: responding writes a
// `checkin_reviewed` event (reviewCheckin, PJ1), which advances last_reviewed_at,
// so the next run sees the project as fresh.
//
// Persistence note: at integration with origin/main this will also record into
// Brandon's existing `notifications` table (ADR-129/130) instead of only pushing
// + stamping the project; the compose/select logic here is channel-agnostic and
// stays.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityEvents, items, relations } from "@/db/schema";
import { lastActivityAt, lastReviewedAt } from "@/lib/activity";
import { composeDigest, daysUntil, digestStatus } from "@/lib/digest/compose";
import { resolveComposition, DEFAULT_DIGEST } from "@/lib/composition";
import { getType } from "@/lib/types";
import { sendToOwner, type SendTally } from "@/lib/push/notify";
import type { PushSender } from "@/lib/push/types";

const DAY_MS = 86_400_000;

export async function runDigestNotify(
  ownerId: string,
  sender: PushSender,
  now = new Date()
): Promise<{ checked: number; notified: number; tally: SendTally }> {
  const db = getDb();
  const tally: SendTally = { sent: 0, pruned: 0, failed: 0 };
  let notified = 0;

  const projectType = await getType("project").catch(() => null);
  const projects = await db
    .select({
      id: items.id,
      title: items.title,
      properties: items.properties,
      nextActionText: items.nextActionText,
      composition: items.composition,
    })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "project"),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );

  for (const p of projects) {
    const { composition } = resolveComposition(p.composition, projectType?.defaultWidgets, "project");
    const digest = composition.behaviors.digest ?? DEFAULT_DIGEST;
    if (!digest.enabled) continue;

    const [lastActivity, lastReviewed, milestones] = await Promise.all([
      lastActivityAt(ownerId, p.id),
      lastReviewedAt(ownerId, p.id),
      db
        .select({ title: items.title, dueDate: items.dueDate })
        .from(items)
        .innerJoin(
          relations,
          and(
            eq(relations.sourceId, items.id),
            eq(relations.targetId, p.id),
            eq(relations.home, true),
            eq(relations.matchState, "confirmed")
          )
        )
        .where(
          and(
            eq(items.ownerId, ownerId),
            eq(items.type, "milestone"),
            isNull(items.deletedAt)
          )
        ),
    ]);

    const upcoming = milestones
      .filter((m) => m.dueDate)
      .map((m) => ({ label: m.title || "Milestone", daysUntil: daysUntil(m.dueDate as Date, now) }))
      .filter((m) => m.daysUntil >= 0)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    const status = digestStatus({
      lastActivityAt: lastActivity,
      lastReviewedAt: lastReviewed,
      stalenessDays: digest.stalenessDays,
      upcomingMilestoneDays: upcoming.map((m) => m.daysUntil),
      upcomingDays: digest.upcomingDays,
      now,
    });
    if (!status.trigger) continue;

    // Dedup: at most one ping per staleness window. A review (which resets the
    // clock and clears the stamp) lets it ping again sooner.
    const props = (p.properties ?? {}) as Record<string, unknown>;
    const notify = (props.notify ?? {}) as Record<string, unknown>;
    const lastNotified = typeof notify.digestNotifiedAt === "string" ? new Date(notify.digestNotifiedAt) : null;
    if (lastNotified && now.getTime() - lastNotified.getTime() < digest.stalenessDays * DAY_MS) {
      continue;
    }

    const sinceTasks = new Date(now.getTime() - digest.stalenessDays * DAY_MS);
    const closedRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.ownerId, ownerId),
          eq(activityEvents.subjectId, p.id),
          eq(activityEvents.kind, "task_completed"),
          gt(activityEvents.occurredAt, sinceTasks)
        )
      );

    const message = composeDigest({
      title: p.title || "Project",
      tasksClosed: closedRows[0]?.n ?? 0,
      daysQuiet: status.daysQuiet,
      nextActionText: p.nextActionText ?? null,
      upcoming: status.trigger === "upcoming_milestone" || upcoming.length > 0 ? upcoming[0] : null,
    });

    const t = await sendToOwner(ownerId, sender, {
      title: message.title,
      body: message.body,
      url: `/items/${p.id}`,
      tag: `ledgr-digest-${p.id}`,
    });
    tally.sent += t.sent;
    tally.pruned += t.pruned;
    tally.failed += t.failed;
    notified += 1;

    await db
      .update(items)
      .set({ properties: { ...props, notify: { ...notify, digestNotifiedAt: now.toISOString() } } })
      .where(and(eq(items.id, p.id), eq(items.ownerId, ownerId)));
  }

  return { checked: projects.length, notified, tally };
}

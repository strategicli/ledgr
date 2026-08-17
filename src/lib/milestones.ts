// Milestone completion + progress parts (ADR-196). A milestone used to have NO
// done-state (0044: upcoming/passed derived from its date). Now it completes
// three ways, resolved here in one place so the Milestones widget, the record
// progress bar, and the project cards all agree:
//
//   1. manual — its own status is in the done category (the checkbox);
//   2. task — its "Completes with task" relation field (edges with role 'task')
//      points at a task whose status is done. Derived at read time, never
//      written back, so reopening the task reopens the milestone for free;
//   3. date — a DATED milestone with NO task link still "arrives whether you
//      act or not" (the original PRD §6 semantic): its date passing completes
//      it. A task-linked milestone's date is a target, not a trigger.
//
// Server-only (one batched relations query per widget/card load — never per
// milestone).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import {
  milestonePoints,
  milestoneSharePct,
  type MilestoneShare,
  type PointProgress,
} from "@/lib/project-progress";

export type MilestoneListRow = {
  id: string;
  statusCategory: string;
  dueDate: Date | null;
  properties: unknown;
};

export type MilestoneState = {
  done: boolean;
  // How it completed (null = not complete). "date" also drives the widget's
  // "passed" badge vs the checked-off "done" ones.
  via: "manual" | "task" | "date" | null;
  // The linked task, when the relation field is set (for the widget's context).
  task: { id: string; title: string; done: boolean } | null;
  // Explicit share of the project bar (percent, 0 = pooled default weight).
  pct: number;
};

function todayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Resolve every milestone's completion state in one pass: one query fetches all
// 'task'-role edges (milestone -> task, the typed relation field's shape,
// ADR-067) with the target task's status.
export async function milestoneStates(
  ownerId: string,
  rows: MilestoneListRow[]
): Promise<Map<string, MilestoneState>> {
  const out = new Map<string, MilestoneState>();
  if (rows.length === 0) return out;
  const linked = new Map<string, { id: string; title: string; done: boolean }>();
  const edges = await getDb()
    .select({
      sourceId: relations.sourceId,
      id: items.id,
      title: items.title,
      statusCategory: items.statusCategory,
    })
    .from(relations)
    .innerJoin(items, eq(items.id, relations.targetId))
    .where(
      and(
        inArray(relations.sourceId, rows.map((r) => r.id)),
        eq(relations.role, "task"),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  for (const e of edges) {
    // cardinality is single; if extra edges exist, first one wins.
    if (!linked.has(e.sourceId)) {
      linked.set(e.sourceId, { id: e.id, title: e.title, done: e.statusCategory === "done" });
    }
  }
  const today = todayUtcMs();
  for (const m of rows) {
    const task = linked.get(m.id) ?? null;
    const via: MilestoneState["via"] =
      m.statusCategory === "done"
        ? "manual"
        : task?.done
          ? "task"
          : !task && m.dueDate && m.dueDate.getTime() < today
            ? "date"
            : null;
    out.set(m.id, { done: via !== null, via, task, pct: milestoneSharePct(m.properties) });
  }
  return out;
}

// The two progress inputs a record's milestones contribute (ADR-196): pooled
// 5-point parts for unweighted milestones, explicit percent shares for weighted
// ones. Callers combine the pool with their task/meeting parts, then overlay
// the shares via applyMilestoneShares.
export async function milestoneProgressParts(
  ownerId: string,
  rows: MilestoneListRow[]
): Promise<{ pool: PointProgress[]; shares: MilestoneShare[] }> {
  const states = await milestoneStates(ownerId, rows);
  const pool: PointProgress[] = [];
  const shares: MilestoneShare[] = [];
  for (const m of rows) {
    const s = states.get(m.id);
    if (!s) continue;
    if (s.pct > 0) shares.push({ pct: s.pct, done: s.done });
    else pool.push(milestonePoints(s.done));
  }
  return { pool, shares };
}

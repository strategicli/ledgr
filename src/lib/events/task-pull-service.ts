// Configurable event task-pull — the DB side (ADR-094 E4). Reads an event's
// taskPull rule, expands "@people" to the event's related people, queries the
// active tasks related to each seed (any-role confirmed edges, both directions —
// so a `tags`-role edge counts), and combines them by the rule. Owner-scoped,
// body-free (rides queryViewItems). The pure shape/combine logic is in
// task-pull.ts.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { queryViewItems } from "@/lib/views";
import {
  combineTaskIds,
  effectiveTaskPull,
  expandSeeds,
  EVENT_PEOPLE_SEED,
  type TaskPull,
} from "./task-pull";

type ListRow = Awaited<ReturnType<typeof queryViewItems>>[number];

// The active tasks an event's prep should show, per its taskPull rule (or the
// default = tasks related to anyone on the event). peopleIds expands "@people".
export async function resolveEventTaskPull(
  ownerId: string,
  rawRule: unknown,
  peopleIds: string[]
): Promise<ListRow[]> {
  const rule = effectiveTaskPull(rawRule);
  const statusCategory = rule.statusScope === "all" ? undefined : ("active" as const);
  const expandedGroups = rule.groups.map((g) => ({
    match: g.match,
    seedIds: expandSeeds(g.seeds, peopleIds),
  }));
  const allSeedIds = [...new Set(expandedGroups.flatMap((g) => g.seedIds))];
  if (allSeedIds.length === 0) return [];

  // One body-free query per distinct seed (seeds are few). Each returns the
  // active tasks related to that seed; the pure combiner does any/all + OR.
  const perSeed = await Promise.all(
    allSeedIds.map((sid) =>
      queryViewItems(
        ownerId,
        { type: "task", statusCategory, relatedTo: sid },
        { field: "dueDate", dir: "asc" },
        100
      )
    )
  );
  const tasksBySeed = new Map<string, string[]>();
  const rowById = new Map<string, ListRow>();
  allSeedIds.forEach((sid, i) => {
    tasksBySeed.set(
      sid,
      perSeed[i].map((r) => r.id)
    );
    for (const r of perSeed[i]) rowById.set(r.id, r);
  });

  return combineTaskIds(expandedGroups, tasksBySeed)
    .map((id) => rowById.get(id))
    .filter((r): r is ListRow => !!r)
    .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
}

// Labels for a rule's concrete (non-"@people") seed ids, for the control's
// chips. Owner-scoped; missing/foreign/trashed ids are dropped.
export async function taskPullSeedLabels(
  ownerId: string,
  rule: TaskPull
): Promise<{ id: string; title: string; type: string }[]> {
  const ids = [
    ...new Set(rule.groups.flatMap((g) => g.seeds).filter((s) => s !== EVENT_PEOPLE_SEED)),
  ];
  if (ids.length === 0) return [];
  return getDb()
    .select({ id: items.id, title: items.title, type: items.type })
    .from(items)
    .where(and(eq(items.ownerId, ownerId), inArray(items.id, ids), isNull(items.deletedAt)));
}

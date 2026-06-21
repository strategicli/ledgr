// Configurable event task-pull (ADR-094 E4). An event decides which tasks its
// prep panel shows via properties.taskPull: a set of GROUPS combined by OR;
// within a group the seeds combine by ANY (union) or ALL (intersection). A seed
// is an item id (a person, a tag, anything) or the sentinel "@people" = the
// event's related people. Default (no rule): one ANY group of ["@people"], i.e.
// active tasks related to anyone on the event — today's behavior, zero config.
//
// Pure shape + combine logic here (client-safe, node-testable); the DB query
// lives in task-pull-service.ts. v1 UI authors exactly one flat group (chips +
// an Any/All toggle), but the model + combiner already handle N groups, so a
// nested "(A AND B) OR (C AND D)" is an additive "+ group" later, no migration.

export const EVENT_PEOPLE_SEED = "@people";

export type TaskPullMatch = "any" | "all";
export type TaskPullGroup = { match: TaskPullMatch; seeds: string[] };
export type TaskPull = { groups: TaskPullGroup[]; statusScope: "active" | "all" };

export const DEFAULT_TASK_PULL: TaskPull = {
  groups: [{ match: "any", seeds: [EVENT_PEOPLE_SEED] }],
  statusScope: "active",
};

// Tolerant parse of properties.taskPull (jsonb). Bad shape => null (the caller
// falls back to DEFAULT_TASK_PULL). Drops empty groups and non-string seeds.
export function parseTaskPull(raw: unknown): TaskPull | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.groups)) return null;
  const groups: TaskPullGroup[] = [];
  for (const g of r.groups) {
    if (!g || typeof g !== "object") continue;
    const gg = g as Record<string, unknown>;
    const match: TaskPullMatch = gg.match === "all" ? "all" : "any";
    const seeds = Array.isArray(gg.seeds)
      ? [...new Set(gg.seeds.filter((s): s is string => typeof s === "string" && s.length > 0))]
      : [];
    if (seeds.length > 0) groups.push({ match, seeds });
  }
  if (groups.length === 0) return null;
  return { groups, statusScope: r.statusScope === "all" ? "all" : "active" };
}

// The rule actually in effect: the parsed rule, or the default when unset/empty.
export function effectiveTaskPull(raw: unknown): TaskPull {
  return parseTaskPull(raw) ?? DEFAULT_TASK_PULL;
}

// True when the event is just using the zero-config default (no stored rule).
export function isDefaultTaskPull(raw: unknown): boolean {
  return parseTaskPull(raw) === null;
}

// Expand a group's seeds to concrete item ids: "@people" => the event's people,
// every other seed kept as-is; deduped, order-stable.
export function expandSeeds(seeds: string[], peopleIds: string[]): string[] {
  const out = new Set<string>();
  for (const s of seeds) {
    if (s === EVENT_PEOPLE_SEED) for (const p of peopleIds) out.add(p);
    else out.add(s);
  }
  return [...out];
}

function intersect(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  return sets.reduce((acc, s) => new Set([...acc].filter((id) => s.has(id))));
}

// Combine per-seed task-id lists into the final set. Within a group: ANY = union
// of its seeds' tasks, ALL = intersection. Across groups: union. `tasksBySeed`
// maps a (already-expanded) seed id to the ids of the active tasks related to it.
export function combineTaskIds(
  groups: { match: TaskPullMatch; seedIds: string[] }[],
  tasksBySeed: Map<string, string[]>
): string[] {
  const final = new Set<string>();
  for (const g of groups) {
    if (g.seedIds.length === 0) continue;
    const sets = g.seedIds.map((s) => new Set(tasksBySeed.get(s) ?? []));
    const groupIds = g.match === "all" ? intersect(sets) : new Set(sets.flatMap((s) => [...s]));
    for (const id of groupIds) final.add(id);
  }
  return [...final];
}

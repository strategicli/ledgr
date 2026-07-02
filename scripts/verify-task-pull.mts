// E4 (ADR-094) verification: the configurable event task-pull. Pure shape +
// combine logic, then the live resolver against Neon (any/all within a group,
// OR across groups, the @people default, statusScope, owner-scoping). Run with:
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/verify-task-pull.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const {
  parseTaskPull,
  effectiveTaskPull,
  expandSeeds,
  combineTaskIds,
  DEFAULT_TASK_PULL,
  EVENT_PEOPLE_SEED,
} = await import("../src/lib/events/task-pull");
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/item-mutations");
const { relateItems } = await import("../src/lib/relations");
const { resolveEventTaskPull } = await import("../src/lib/events/task-pull-service");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

// ---- pure shape + combine -------------------------------------------------
check("parse: bad shape => null", parseTaskPull(null) === null && parseTaskPull(42) === null && parseTaskPull({}) === null);
check("parse: empty/seedless groups => null", parseTaskPull({ groups: [{ match: "any", seeds: [] }] }) === null);
check("parse: drops bad seeds, keeps valid group", JSON.stringify(parseTaskPull({ groups: [{ match: "all", seeds: ["a", "", 3, "a"] }] })) === JSON.stringify({ groups: [{ match: "all", seeds: ["a"] }], statusScope: "active" }));
check("effective: unset => default (@people, any)", JSON.stringify(effectiveTaskPull(undefined)) === JSON.stringify(DEFAULT_TASK_PULL));
check("expandSeeds: @people expands + dedupes", sameSet(expandSeeds([EVENT_PEOPLE_SEED, "x"], ["p1", "p2", "x"]), ["p1", "p2", "x"]));
const tbs = new Map<string, string[]>([
  ["r", ["tA", "tC"]],
  ["m", ["tB", "tC"]],
  ["g", ["tA", "tD"]],
]);
check("combine: ANY = union", sameSet(combineTaskIds([{ match: "any", seedIds: ["r", "m"] }], tbs), ["tA", "tB", "tC"]));
check("combine: ALL = intersection", sameSet(combineTaskIds([{ match: "all", seedIds: ["r", "m"] }], tbs), ["tC"]));
check("combine: groups OR together", sameSet(combineTaskIds([{ match: "all", seedIds: ["r", "m"] }, { match: "any", seedIds: ["g"] }], tbs), ["tC", "tA", "tD"]));

// ---- live resolver --------------------------------------------------------
const db = getDb();
const [u] = await db.insert(users).values({ email: `verify-pull-${Date.now()}@example.invalid` }).returning({ id: users.id });
const ownerId = u.id;
let otherId: string | null = null;
const created: string[] = [];
const mk = async (type: string, title: string) => {
  const it = await createItem(ownerId, { type, title });
  created.push(it.id);
  return it.id;
};

try {
  const roger = await mk("person", "Roger");
  const megan = await mk("person", "Megan");
  const pastors = await mk("tag", "Pastors");
  const tA = await mk("task", "tA roger+pastors");
  const tB = await mk("task", "tB megan");
  const tC = await mk("task", "tC roger+megan");
  const tD = await mk("task", "tD pastors only");
  const tE = await mk("task", "tE roger DONE");

  await relateItems(ownerId, tA, roger, "related");
  await relateItems(ownerId, tA, pastors, "tags");
  await relateItems(ownerId, tB, megan, "related");
  await relateItems(ownerId, tC, roger, "related");
  await relateItems(ownerId, tC, megan, "related");
  await relateItems(ownerId, tD, pastors, "tags");
  await relateItems(ownerId, tE, roger, "related");
  await db.update(items).set({ status: "done", statusCategory: "done" }).where(eq(items.id, tE));

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const people = [roger, megan];

  // default (@people, any): union of the people's active tasks; excludes the
  // pastors-only task (no person link) and the done one.
  const def = await resolveEventTaskPull(ownerId, undefined, people);
  check("default pulls anyone-on-the-event's active tasks", sameSet(ids(def), [tA, tB, tC]), ids(def).join(","));
  check("default excludes a done task (statusScope active)", !ids(def).includes(tE));
  check("default excludes a tag-only task (nobody on the event)", !ids(def).includes(tD));

  // a tag seed: tasks tagged Pastors.
  const byTag = await resolveEventTaskPull(ownerId, { groups: [{ match: "any", seeds: [pastors] }] }, people);
  check("a tag seed pulls that tag's tasks", sameSet(ids(byTag), [tA, tD]), ids(byTag).join(","));

  // ALL of {Roger, Megan}: the intersection (the one task involving both).
  const both = await resolveEventTaskPull(ownerId, { groups: [{ match: "all", seeds: [roger, megan] }] }, people);
  check("ALL of two people = intersection", sameSet(ids(both), [tC]), ids(both).join(","));

  // a mixed ANY group (tag + a person), still union.
  const mixed = await resolveEventTaskPull(ownerId, { groups: [{ match: "any", seeds: [pastors, megan] }] }, people);
  check("ANY of {tag, person} = union", sameSet(ids(mixed), [tA, tD, tB, tC]), ids(mixed).join(","));

  // statusScope all: includes the done task related to Roger.
  const all = await resolveEventTaskPull(ownerId, { groups: [{ match: "any", seeds: [roger] }], statusScope: "all" }, people);
  check("statusScope=all includes the done task", ids(all).includes(tE));

  // owner scoping: another owner resolves nothing from our items.
  const [other] = await db.insert(users).values({ email: `verify-pull-other-${Date.now()}@example.invalid` }).returning({ id: users.id });
  otherId = other.id;
  const foreign = await resolveEventTaskPull(otherId, { groups: [{ match: "any", seeds: [pastors] }] }, people);
  check("a foreign owner pulls nothing from our items", foreign.length === 0);
} finally {
  if (created.length) await db.delete(items).where(inArray(items.id, created));
  await db.delete(users).where(eq(users.id, ownerId));
  if (otherId) await db.delete(users).where(eq(users.id, otherId));
  console.log("cleanup done");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

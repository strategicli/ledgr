// ADR-144 follow-up: seed the Pastors group's roster (its Members) from the
// clear attendance evidence — the people who appear across the recent All
// Pastors / Campus Pastors meetings. This is the ONLY group with reliable
// individual-attendance data; Elders / Staff / Finance Team have none (their
// historical meetings linked the group as a tag, never the individuals), so
// their rosters are left for hand-entry on each group's page.
//
// Idempotent: relateItems upserts on the (source,target,role) unique, so
// re-running never duplicates. Additive + reversible (un-relate on the group's
// Members field). Run: npx tsx scripts/seed-pastors-roster.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { relateItems } = await import("../src/lib/relations");
const { GROUP_MEMBERS_ROLE } = await import("../src/lib/events/people");
const { eq } = await import("drizzle-orm");

const PASTORS_GROUP = "ea39920a-0c52-4e4c-ad41-aa4e5e4a232d";
// The 8 people on >=2 of the Pastors group's recent meetings (attendance
// evidence). Brandon's "~12 pastors" may need a few hand-added on the group
// page. Resolved by exact title so a stale id can't seed the wrong person.
const MEMBER_TITLES = [
  "James Schwindt",
  "Mike Giebink",
  "Mitchell Olthoff",
  "Noah Cupery",
  "Roger Knowlton",
  "Timothy Sandberg",
  "Zach Samz",
  "Erich Beyersdorf",
];

const db = getDb();
const { items } = await import("../src/db/schema");
const { and, inArray, isNull } = await import("drizzle-orm");

// Derive the owner from the group item itself (not users.limit(1) — leftover
// throwaway verify-* users exist), so members + group are guaranteed same-owner.
const [grp] = await db
  .select({ ownerId: items.ownerId })
  .from(items)
  .where(eq(items.id, PASTORS_GROUP));
if (!grp) throw new Error("Pastors group not found");
const owner = { id: grp.ownerId };

const people = await db
  .select({ id: items.id, title: items.title })
  .from(items)
  .where(
    and(
      eq(items.type, "person"),
      eq(items.ownerId, owner.id),
      isNull(items.deletedAt),
      eq(items.isTemplate, false),
      inArray(items.title, MEMBER_TITLES)
    )
  );

let added = 0;
for (const title of MEMBER_TITLES) {
  const person = people.find((p) => p.title === title);
  if (!person) {
    console.log(`!  no person titled "${title}" — skipped`);
    continue;
  }
  await relateItems(owner.id, PASTORS_GROUP, person.id, GROUP_MEMBERS_ROLE);
  console.log(`+  ${title} → Pastors members`);
  added++;
}
console.log(`\ndone: ${added}/${MEMBER_TITLES.length} members ensured on the Pastors group.`);
process.exit(0);

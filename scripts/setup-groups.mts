// ADR-144 setup: the first-class `group` type + the hand-picked conversions.
//
// 1. Registers the `group` type (a types-registry ROW — no schema migration)
//    with one Members relation field (group→person, role 'members').
// 2. Converts the three category tags Brandon confirmed are really groups —
//    Pastors, Elders, Staff — by retyping the tag item to `group`. Their edges
//    are generic relations rows, so 136/73/… historical event+task links keep
//    working untouched.
// 3. Merges the group-impersonating person items: "elders" (its event edges
//    become event→group 'group' edges, its tagged/task edges move to the
//    group, then the person is soft-deleted), the unused "Pastors" person
//    (soft-deleted), and "Finance Team" (retyped person→group in place).
//
// Rosters (who's IN each group) are NOT seeded here — add members on each
// group's page (the Members field). Idempotent: re-running skips work already
// done. Writes a JSON backup of every row it will touch to scripts/backups/.
//
// Run: npx tsx scripts/setup-groups.mts [--dry-run]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { sql } = await import("drizzle-orm");

const dryRun = process.argv.includes("--dry-run");
const db = getDb();
const backup: Record<string, unknown[]> = {};

const TAGS_TO_CONVERT = ["Pastors", "Elders", "Staff"];

// --- 1. the group type ------------------------------------------------------
const existingType = await db.execute(sql`select key from types where key = 'group'`);
if (existingType.rows.length > 0) {
  console.log("· type 'group' already exists");
} else if (!dryRun) {
  await db.execute(sql`
    insert into types (key, label, icon, is_system, property_schema, show_in_quick_capture)
    values ('group', 'Group', 'people', false,
            '[{"key":"members","kind":"relation","label":"Members","targetType":"person","cardinality":"many"}]'::jsonb,
            false)
  `);
  console.log("+ created type 'group' (Members relation field → person)");
} else {
  console.log("[dry-run] would create type 'group'");
}

// --- 2. tag → group conversions ---------------------------------------------
for (const title of TAGS_TO_CONVERT) {
  const rows = await db.execute(sql`
    select id, type, title from items
    where type = 'tag' and lower(title) = ${title.toLowerCase()}
      and deleted_at is null and is_template = false
  `);
  if (rows.rows.length === 0) {
    console.log(`· no live tag "${title}" (already converted?)`);
    continue;
  }
  backup[`tag:${title}`] = rows.rows;
  for (const r of rows.rows as { id: string }[]) {
    if (!dryRun) await db.execute(sql`update items set type = 'group' where id = ${r.id}`);
    console.log(`${dryRun ? "[dry-run] would retype" : "retyped"} tag "${title}" → group (${r.id})`);
  }
}

// --- 3a. merge the "elders" person into the Elders group --------------------
const eldersGroup = await db.execute(sql`
  select id from items where type in ('group','tag') and lower(title) = 'elders'
    and deleted_at is null and is_template = false limit 1
`);
const eldersPerson = await db.execute(sql`
  select id from items where type = 'person' and lower(title) = 'elders'
    and deleted_at is null and is_template = false limit 1
`);
if (eldersPerson.rows.length > 0 && eldersGroup.rows.length > 0) {
  const pid = (eldersPerson.rows[0] as { id: string }).id;
  const gid = (eldersGroup.rows[0] as { id: string }).id;
  const edges = await db.execute(sql`
    select r.id, r.source_id, r.target_id, r.role, r.match_state,
           s.type as source_type, t.type as target_type
    from relations r join items s on s.id = r.source_id join items t on t.id = r.target_id
    where r.source_id = ${pid} or r.target_id = ${pid}
  `);
  backup["elders-person-edges"] = edges.rows;
  backup["elders-person"] = [{ id: pid }];
  for (const e of edges.rows as {
    id: string;
    source_id: string;
    target_id: string;
    role: string;
    source_type: string;
    target_type: string;
  }[]) {
    const otherId = e.source_id === pid ? e.target_id : e.source_id;
    const otherType = e.source_id === pid ? e.target_type : e.source_type;
    // An event that had "elders" attending was really FOR the elders: the edge
    // becomes event→group 'group' (normalized to that direction). Everything
    // else keeps its role and direction, with the person swapped for the group.
    const eventSide = otherType === "event";
    const newRole = eventSide && e.role === "attending" ? "group" : e.role;
    const newSource = eventSide ? otherId : e.source_id === pid ? gid : e.source_id;
    const newTarget = eventSide ? gid : e.target_id === pid ? gid : e.target_id;
    const dupe = await db.execute(sql`
      select 1 from relations where source_id = ${newSource} and target_id = ${newTarget} and role = ${newRole}
    `);
    if (dupe.rows.length > 0) {
      if (!dryRun) await db.execute(sql`delete from relations where id = ${e.id}`);
      console.log(`${dryRun ? "[dry-run] would drop" : "dropped"} duplicate elders edge (${e.role})`);
    } else if (!dryRun) {
      await db.execute(sql`
        update relations set source_id = ${newSource}, target_id = ${newTarget}, role = ${newRole}
        where id = ${e.id}
      `);
    }
  }
  if (!dryRun) await db.execute(sql`update items set deleted_at = now() where id = ${pid}`);
  console.log(
    `${dryRun ? "[dry-run] would merge" : "merged"} person "elders" → Elders group (${edges.rows.length} edge(s)) and trashed the person`
  );
} else {
  console.log("· no live 'elders' person to merge");
}

// --- 3b. trash the unused "Pastors" person -----------------------------------
const pastorsPerson = await db.execute(sql`
  select i.id, (select count(*) from relations r where r.source_id = i.id or r.target_id = i.id)::int as edges
  from items i where i.type = 'person' and lower(i.title) = 'pastors'
    and i.deleted_at is null and i.is_template = false
`);
for (const p of pastorsPerson.rows as { id: string; edges: number }[]) {
  if (p.edges > 0) {
    console.log(`! person "Pastors" (${p.id}) has ${p.edges} edge(s) now — left alone, review by hand`);
    continue;
  }
  backup["pastors-person"] = [p];
  if (!dryRun) await db.execute(sql`update items set deleted_at = now() where id = ${p.id}`);
  console.log(`${dryRun ? "[dry-run] would trash" : "trashed"} the edge-less "Pastors" person (${p.id})`);
}

// --- 3c. "Finance Team" person → group, in place -----------------------------
const finance = await db.execute(sql`
  select id from items where type = 'person' and lower(title) = 'finance team'
    and deleted_at is null and is_template = false
`);
for (const f of finance.rows as { id: string }[]) {
  backup["finance-team"] = [f];
  if (!dryRun) await db.execute(sql`update items set type = 'group' where id = ${f.id}`);
  console.log(`${dryRun ? "[dry-run] would retype" : "retyped"} "Finance Team" person → group (${f.id})`);
}

if (!dryRun && Object.keys(backup).length > 0) {
  mkdirSync("scripts/backups", { recursive: true });
  const file = `scripts/backups/setup-groups-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`backup written: ${file}`);
}
console.log("done. next: open each group and add its Members.");
process.exit(0);

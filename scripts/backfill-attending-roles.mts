// ADR-144 backfill: unify event↔person edge roles on 'attending'.
//
// Why: template prototypes historically pre-related people with role='related'
// while the Attending field wrote role='attending' — the single mismatch behind
// the old three-list People/Attending/Linked-here split. Going forward every
// attendance write uses 'attending' (people.ts, pin.ts); this converts the
// existing 'related' event↔person edges, normalizing direction to event→person
// (the relation-field direction) and deduping against already-present
// attending edges. Template prototypes are included on purpose — that's what
// makes existing pinned rules pre-relate attendees correctly.
//
// Safety: production data. Writes a full JSON backup of every affected row to
// scripts/backups/ BEFORE touching anything; restore = re-insert/re-update
// from that file. Run with --dry-run first to see the plan.
//
// Run: npx tsx scripts/backfill-attending-roles.mts [--dry-run]
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

type EdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  role: string;
  match_state: string;
  home: boolean;
  event_id: string;
  person_id: string;
};

// Every 'related' edge with an event on one side and a person on the other
// (both directions; prototypes included; trashed endpoints excluded — a
// trashed pair restores as-is and is out of scope here).
const res = await db.execute(sql`
  select r.id, r.source_id, r.target_id, r.role, r.match_state, r.home,
         case when s.type = 'event' then s.id else t.id end as event_id,
         case when s.type = 'person' then s.id else t.id end as person_id
  from relations r
  join items s on s.id = r.source_id
  join items t on t.id = r.target_id
  where r.role = 'related'
    and ((s.type = 'event' and t.type = 'person') or (s.type = 'person' and t.type = 'event'))
    and s.deleted_at is null and t.deleted_at is null
`);
const edges = res.rows as EdgeRow[];
console.log(`found ${edges.length} event↔person 'related' edge(s)`);

if (edges.length > 0 && !dryRun) {
  mkdirSync("scripts/backups", { recursive: true });
  const file = `scripts/backups/backfill-attending-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(edges, null, 2));
  console.log(`backup written: ${file}`);
}

let updated = 0;
let flipped = 0;
let dropped = 0;
for (const e of edges) {
  // Already covered by an attending edge in the canonical direction? Then this
  // 'related' edge is redundant — drop it instead of tripping the unique index.
  const dupe = await db.execute(sql`
    select 1 from relations
    where source_id = ${e.event_id} and target_id = ${e.person_id} and role = 'attending'
  `);
  if (dupe.rows.length > 0) {
    if (!dryRun) await db.execute(sql`delete from relations where id = ${e.id}`);
    dropped++;
    continue;
  }
  if (e.source_id === e.event_id) {
    if (!dryRun) {
      await db.execute(sql`update relations set role = 'attending' where id = ${e.id}`);
    }
    updated++;
  } else {
    // person→event: normalize to event→person so the relation-field read path
    // (outgoing edges from the event) sees it too.
    if (!dryRun) {
      await db.execute(sql`
        update relations
        set source_id = ${e.event_id}, target_id = ${e.person_id}, role = 'attending'
        where id = ${e.id}
      `);
    }
    flipped++;
  }
}

console.log(
  `${dryRun ? "[dry-run] would convert" : "converted"}: ${updated} in place, ${flipped} direction-normalized, ${dropped} redundant dropped`
);
process.exit(0);

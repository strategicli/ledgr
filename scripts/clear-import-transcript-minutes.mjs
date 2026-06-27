// One-off (2026-06-27): clear the Notion-import "awaiting minutes" backlog.
// The importer stamped every transcript minutes="none" (the per-meeting work
// queue), correct for a freshly recorded meeting but wrong for ~263 historical
// transcripts whose meeting notes were already imported into the event body.
// They flooded the "Transcripts awaiting minutes" view. Flip them to "done"
// (reviewed, no further work) so they drop out of the queue; the transcripts
// themselves are untouched.
//
// Pure property merge (jsonb ||), deliberately NOT bumping updated_at: this is a
// silent backfill, not a user edit, so the items keep their chronological place
// and don't trigger spurious re-exports. Scoped to exactly the queue rows.
// Reversible: the affected ids are written to _cleared-transcript-ids.json.
//   node --env-file-if-exists=.env.local scripts/clear-import-transcript-minutes.mjs
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

const target = await sql`
  SELECT id, title FROM items
  WHERE type = 'transcript' AND deleted_at IS NULL
    AND properties->>'minutes' = 'none'
  ORDER BY created_at`;
console.log(`Found ${target.length} transcripts with minutes=none.`);
writeFileSync(
  "scripts/_cleared-transcript-ids.json",
  JSON.stringify(target.map((r) => r.id), null, 2)
);

const updated = await sql`
  UPDATE items
  SET properties = coalesce(properties, '{}'::jsonb) || '{"minutes":"done"}'::jsonb
  WHERE type = 'transcript' AND deleted_at IS NULL
    AND properties->>'minutes' = 'none'
  RETURNING id`;
console.log(`Updated ${updated.length} → minutes="done".`);

const remaining = await sql`
  SELECT count(*)::int AS n FROM items
  WHERE type = 'transcript' AND deleted_at IS NULL
    AND properties->>'minutes' = 'none'`;
console.log(`Remaining minutes=none: ${remaining[0].n} (expect 0).`);

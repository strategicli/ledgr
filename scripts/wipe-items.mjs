// Dev maintenance: report (default) or wipe ALL items for the owner.
// Wipes items only; relations/revisions/attachments/share_tokens cascade.
// Types, views, dashboards, nav, and the user row are PRESERVED.
//
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/wipe-items.mjs            # dry-run report
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/wipe-items.mjs --confirm   # actually delete
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set."); process.exit(1); }
const hostname = new URL(url).hostname;
if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
  console.error("DATABASE_URL must be the Neon pooler string."); process.exit(1);
}
console.log("DB host:", hostname);
const sql = neon(url);

const [owner] = await sql`SELECT id, email FROM users WHERE email = 'brandoncollins@edgewoodcommunity.org'`;
if (!owner) { console.error("No owner user found."); process.exit(1); }
console.log("Owner:", owner.email, owner.id);

const byType = await sql`SELECT type, count(*)::int AS n FROM items WHERE owner_id = ${owner.id} GROUP BY type ORDER BY n DESC`;
const total = byType.reduce((s, r) => s + r.n, 0);
console.log(`\nItems for owner: ${total}`);
for (const r of byType) console.log(`  ${String(r.n).padStart(4)}  ${r.type}`);

const sample = await sql`SELECT type, title FROM items WHERE owner_id = ${owner.id} ORDER BY updated_at DESC LIMIT 12`;
console.log("\nMost recent titles (sanity-check this is the right instance):");
for (const r of sample) console.log(`  [${r.type}] ${r.title || "(untitled)"}`);

if (process.argv.includes("--confirm")) {
  const { rowCount } = await sql`DELETE FROM items WHERE owner_id = ${owner.id}`;
  console.log(`\nDELETED ${rowCount ?? 0} items. relations/revisions/attachments/share_tokens cascaded. Types/views/dashboards/nav preserved.`);
} else {
  console.log("\n(dry-run; nothing changed) Re-run with --confirm to delete the above.");
}

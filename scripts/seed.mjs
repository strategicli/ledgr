// Idempotent seed: the five system type rows and the single v1 user row.
// Run via: npm run db:seed (loads .env / .env.local if present).
// Safe to re-run; every insert is ON CONFLICT DO NOTHING.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const hostname = new URL(url).hostname;
if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
  console.error(
    "DATABASE_URL must be the Neon pooler connection string (runbook.md §1)."
  );
  process.exit(1);
}

const sql = neon(url);

const systemTypes = [
  ["task", "Task", "check-square"],
  ["event", "Event", "users"],
  ["note", "Note", "file-text"],
  ["link", "Link", "link"],
  ["person", "Person", "user"],
];

for (const [key, label, icon] of systemTypes) {
  await sql`
    INSERT INTO types (key, label, icon, is_system)
    VALUES (${key}, ${label}, ${icon}, true)
    ON CONFLICT (key) DO NOTHING
  `;
}

// The `transcript` child type (meeting recording v1a, ADR-087): a meeting's
// transcript is its own item (parent_id = the meeting), is_system + visible but
// show_in_quick_capture=false. Its `minutes` select (none|draft|done) is the
// "needs minutes" signal the awaiting-minutes view filters on. Mirrors
// drizzle/0023_meeting_transcript_type.sql for fresh databases.
await sql`
  INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, property_schema)
  VALUES (
    'transcript', 'Transcript', 'file-text', true, false,
    '[{"key": "minutes", "label": "Minutes", "kind": "select", "options": ["none", "draft", "done"]}]'::jsonb
  )
  ON CONFLICT (key) DO NOTHING
`;

// The `unmarked` placeholder type (ADR-067): hidden + system, label is a glyph.
// create-on-miss makes items of this type (inbox=true) when the target type is
// unknown; the user never reads the word "unmarked" (the key is code-facing).
// Mirrors drizzle/0018_unmarked_type.sql for fresh databases.
await sql`
  INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden)
  VALUES ('unmarked', '◌', NULL, true, false, true)
  ON CONFLICT (key) DO NOTHING
`;

await sql`
  INSERT INTO users (email)
  VALUES ('brandoncollins@edgewoodcommunity.org')
  ON CONFLICT (email) DO NOTHING
`;

const typeRows = await sql`SELECT key FROM types ORDER BY key`;
const userRows = await sql`SELECT email FROM users`;
console.log(`Seed complete. types: ${typeRows.map((r) => r.key).join(", ")}`);
console.log(`users: ${userRows.map((r) => r.email).join(", ")}`);

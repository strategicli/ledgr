// Seeds the `mindmap` types row the Mindmap module needs (items.type -> types.key
// is an FK, so the row must exist before any mindmap item is created). Module-
// contributed type, so is_system=false (deletable, unlike the five core types).
// Idempotent. Run: node --env-file-if-exists=.env.local scripts/seed-mindmap.mjs
//
// No property_schema: a mindmap is just a markdown nested list (its body), so the
// type carries no special properties — the user can add their own. The canvas and
// canonical format come from the module manifest (src/lib/modules/mindmap.ts), not
// from this row; this only satisfies the FK and gives the type a label + icon.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const hostname = new URL(url).hostname;
if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
  console.error("DATABASE_URL must be the Neon pooler connection string.");
  process.exit(1);
}

const sql = neon(url);

await sql`
  INSERT INTO types (key, label, icon, is_system)
  VALUES ('mindmap', 'Mindmap', 'mindmap', false)
  ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon
`;

const rows = await sql`SELECT key, label, is_system FROM types WHERE key = 'mindmap'`;
console.log("mindmap type seeded:", rows[0] ?? "(none)");

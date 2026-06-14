// Seeds the `song` types row the Songs module needs (items.type → types.key is
// an FK, so the row must exist before any song item is created). Module-
// contributed type, so is_system=false (deletable, unlike the five core types).
// Idempotent. Run: node --env-file-if-exists=.env.local scripts/seed-songs.mjs
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
  VALUES ('song', 'Song', 'music', false)
  ON CONFLICT (key) DO NOTHING
`;

const rows = await sql`SELECT key, label, is_system FROM types WHERE key = 'song'`;
console.log("song type seeded:", rows[0] ?? "(none)");

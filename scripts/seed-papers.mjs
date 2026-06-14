// Seeds the `paper` types row the Papers module needs (items.type -> types.key
// is an FK, so the row must exist before any paper item is created). Module-
// contributed type, so is_system=false (deletable, unlike the five core types).
// Idempotent. Run: node --env-file-if-exists=.env.local scripts/seed-papers.mjs
//
// property_schema declares the title-page meta + workflow stage the paper canvas
// reads (the docx renderer builds the MSM title page from these). The canvas
// writes these keys directly under items.properties; the schema here is the data-
// model declaration. Stage options mirror PAPER_STAGES in src/lib/papers/types.ts
// (source of truth) — keep them in sync.
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

const propertySchema = [
  { key: "school", label: "School", kind: "text" },
  { key: "paper_type", label: "Paper type", kind: "text" },
  { key: "course", label: "Course", kind: "text" },
  { key: "author", label: "Author", kind: "text" },
  { key: "location", label: "Location", kind: "text" },
  { key: "paper_date", label: "Date", kind: "text" },
  {
    key: "stage",
    label: "Stage",
    kind: "select",
    options: ["shaping", "quote-gathering", "outlining", "drafting", "editing", "done"],
  },
];

await sql`
  INSERT INTO types (key, label, icon, is_system, property_schema)
  VALUES ('paper', 'Paper', 'file-text', false, ${JSON.stringify(propertySchema)}::jsonb)
  ON CONFLICT (key) DO UPDATE SET property_schema = EXCLUDED.property_schema
`;

const rows = await sql`SELECT key, label, is_system FROM types WHERE key = 'paper'`;
console.log("paper type seeded:", rows[0] ?? "(none)");

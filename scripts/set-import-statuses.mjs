// One-off: set custom status lifecycles for the migration's media + prayer types.
// MCP create_type can't set status, so we write status_schema + status_mode directly.
//   node --env-file-if-exists=.env.local scripts/set-import-statuses.mjs
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

const media = [
  { key: "curious", label: "Curious", category: "not_started", color: "#64748b", isDefault: true },
  { key: "selected", label: "Selected", category: "not_started", color: "#64748b" },
  { key: "started", label: "Started", category: "in_progress", color: "#d97706", isDefault: true },
  { key: "finished", label: "Finished", category: "done", color: "#16a34a", isDefault: true },
  { key: "abandoned", label: "Abandoned", category: "archived", color: "#6b7280", isDefault: true },
];
const prayer = [
  { key: "open", label: "Open", category: "not_started", color: "#64748b", isDefault: true },
  { key: "answered", label: "Answered", category: "done", color: "#16a34a", isDefault: true },
  { key: "archived", label: "Archived", category: "archived", color: "#6b7280", isDefault: true },
];

await sql`UPDATE types SET status_schema = ${JSON.stringify(media)}::jsonb, status_mode = 'select' WHERE key = 'media'`;
await sql`UPDATE types SET status_schema = ${JSON.stringify(prayer)}::jsonb, status_mode = 'select' WHERE key = 'prayer'`;

const rows = await sql`SELECT key, status_mode, jsonb_path_query_array(status_schema, '$[*].key') AS keys FROM types WHERE key IN ('media','prayer')`;
for (const r of rows) console.log(`${r.key}: mode=${r.status_mode} statuses=${JSON.stringify(r.keys)}`);

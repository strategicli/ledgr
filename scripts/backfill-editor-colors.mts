// Backfill: rewrite the old editor color palette to the retuned one in stored
// item bodies (custom editor palette ADR, 2026-07-16 — see src/lib/colors.ts).
//
// Why: text colors round-trip via their exact hex, and highlight backgrounds
// changed from near-white hex to rgba() washes. Bodies saved under the old
// palette carry the old inline values (color:#e03e3e, background-color:#fbe4e4).
// Left alone, an old text-color hex no longer matches the new table, so on the
// next rich edit it fails to map back to a palette name and gets stripped to
// plain text. This rewrites every old value to its new one in items.body.text
// so existing colored text keeps its color and stays editable. Highlights also
// round-trip via the hl-* class (unchanged), so their spans survive regardless;
// this just refreshes the visible background to match the new palette.
//
// Scope: current bodies only. `revisions` are historical snapshots — left as-is.
//
// Safety: production data. Writes a full JSON backup of every row it touches to
// scripts/backups/ BEFORE writing; restore = re-apply body.text from that file.
// Run with --dry-run first. .env.local points at the dev branch by default.
//
// Run: npx tsx scripts/backfill-editor-colors.mts [--dry-run]
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

// old value → new value. Old hexes are the pre-2026-07-16 BLOCKNOTE_COLORS
// table (9 text + 9 background); new values are the current table. The two old
// hex sets are disjoint, so a flat map is unambiguous.
const REPLACEMENTS: Array<[RegExp, string]> = [
  // text colors (hex → hex)
  ["#9b9a97", "#a1a1aa"],
  ["#64473a", "#c08552"],
  ["#e03e3e", "#f23a4a"],
  ["#d9730d", "#fb923c"],
  ["#dfab01", "#facc15"],
  ["#4d6461", "#4ade80"],
  ["#0b6e99", "#60a5fa"],
  ["#6940a5", "#c084fc"],
  ["#ad1a72", "#f472b6"],
  // highlight backgrounds (old near-white hex → new rgba wash)
  ["#ebeced", "rgba(148,148,148,0.40)"],
  ["#e9e5e3", "rgba(150,95,55,0.45)"],
  ["#fbe4e4", "rgba(242,58,74,0.42)"],
  ["#f6e9d9", "rgba(249,115,22,0.42)"],
  ["#fbf3db", "rgba(234,179,8,0.45)"],
  ["#ddedea", "rgba(34,197,94,0.42)"],
  ["#ddebf1", "rgba(59,130,246,0.42)"],
  ["#eae4f2", "rgba(168,85,247,0.42)"],
  ["#f4dfeb", "rgba(236,72,153,0.42)"],
  // The `hl-*` class is unchanged, so no class rewrite is needed. The old
  // near-white hex only ever appears as a color value, so a bounded hex match
  // (no trailing hex digit) is safe against prose.
].map(([oldHex, next]) => [new RegExp(`${oldHex}(?![0-9a-fA-F])`, "gi"), next]);

type BodyRow = { id: string; body: { format?: string; text?: string } | null };

// Only rows whose body text mentions one of the old values. body is jsonb
// {format, text}; the color HTML lives in .text.
const anyOld = [
  "#9b9a97", "#64473a", "#e03e3e", "#d9730d", "#dfab01", "#4d6461",
  "#0b6e99", "#6940a5", "#ad1a72", "#ebeced", "#e9e5e3", "#fbe4e4",
  "#f6e9d9", "#fbf3db", "#ddedea", "#ddebf1", "#eae4f2", "#f4dfeb",
].join("|");
const res = await db.execute(sql`
  select id, body from items
  where body ->> 'text' ~* ${anyOld}
`);
const rows = res.rows as unknown as BodyRow[];
console.log(`found ${rows.length} item(s) with old palette values`);

if (rows.length > 0 && !dryRun) {
  mkdirSync("scripts/backups", { recursive: true });
  const file = `scripts/backups/backfill-editor-colors-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`backup written: ${file}`);
}

let changed = 0;
for (const row of rows) {
  const text = row.body?.text;
  if (typeof text !== "string") continue;
  let next = text;
  for (const [re, to] of REPLACEMENTS) next = next.replace(re, to);
  if (next === text) continue;
  changed++;
  if (!dryRun) {
    const nextBody = { ...row.body, text: next };
    await db.execute(
      sql`update items set body = ${JSON.stringify(nextBody)}::jsonb where id = ${row.id}`
    );
  }
}

console.log(`${dryRun ? "[dry-run] would rewrite" : "rewrote"}: ${changed} item body(ies)`);
process.exit(0);

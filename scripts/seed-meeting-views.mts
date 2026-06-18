// Seed the owner's "Transcripts awaiting minutes" saved view (meeting recording
// v1a, ADR-087). The Claude-over-MCP minutes automation runs this view (via
// list_views → run_view) to find transcripts with no minutes yet, so it needs
// to exist as a real saved view. Idempotent by name: re-running is safe and
// never duplicates. One user in v1, but it ensures the view for every user row.
//
// Run: npx tsx scripts/seed-meeting-views.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { users } = await import("../src/db/schema");
const { listViews, createView } = await import("../src/lib/views");

const VIEW_NAME = "Transcripts awaiting minutes";

const db = getDb();
const userRows = await db.select({ id: users.id, email: users.email }).from(users);

for (const u of userRows) {
  const existing = (await listViews(u.id)).find((v) => v.name === VIEW_NAME);
  if (existing) {
    console.log(`· ${u.email}: already has "${VIEW_NAME}" (${existing.id})`);
    continue;
  }
  const view = await createView(u.id, {
    name: VIEW_NAME,
    // Transcripts whose minutes are still "none" — the automation's work queue.
    // draft/done drop out (already processed / reviewed).
    filter: { type: "transcript", propertyFilters: [{ key: "minutes", value: "none" }] },
    sort: { field: "updatedAt", dir: "desc" },
    grouping: null,
    columns: null,
    layout: "list",
    dateProperty: null,
  });
  console.log(`✓ ${u.email}: created "${VIEW_NAME}" (${view.id})`);
}

console.log("Done.");

import { getDb } from "@/db";
import { types } from "@/db/schema";

// The core system/starter types, seeded on a fresh LOCAL (desktop) database so
// it's usable without running scripts/seed.mjs (the cloud seed path). This
// MIRRORS scripts/seed.mjs — keep the two in sync when a core type changes.
// Fields are baked to their final state (property_schema / status_mode) because
// a fresh DB has no prior rows to UPDATE. Idempotent (ON CONFLICT DO NOTHING).
const TAGS_FIELD = {
  key: "tags",
  label: "Tags",
  kind: "relation",
  targetType: "tag",
  cardinality: "many",
};
const WORKFLOW_STATUS = [
  { key: "planning", label: "Planning", category: "not_started", color: "#64748b", isDefault: true },
  { key: "active", label: "Active", category: "in_progress", color: "#d97706" },
  { key: "on_hold", label: "On Hold", category: "not_started", color: "#6b7280" },
  { key: "done", label: "Done", category: "done", color: "#16a34a", isDefault: true },
];

const CORE_TYPES: (typeof types.$inferInsert)[] = [
  {
    key: "task",
    label: "Task",
    icon: "check-square",
    isSystem: true,
    statusMode: "checkbox",
    propertySchema: [
      TAGS_FIELD,
      { key: "project", label: "Project", kind: "relation", targetType: "project", cardinality: "single" },
    ],
  },
  { key: "event", label: "Event", icon: "users", isSystem: true, propertySchema: [TAGS_FIELD] },
  { key: "note", label: "Note", icon: "file-text", isSystem: true, propertySchema: [TAGS_FIELD] },
  { key: "link", label: "Link", icon: "link", isSystem: true },
  { key: "person", label: "Person", icon: "user", isSystem: true },
  {
    key: "transcript",
    label: "Transcript",
    icon: "file-text",
    isSystem: true,
    showInQuickCapture: false,
    propertySchema: [{ key: "minutes", label: "Minutes", kind: "select", options: ["none", "draft", "done"] }],
  },
  { key: "unmarked", label: "◌", icon: null, isSystem: true, hidden: true },
  { key: "tag", label: "Tag", icon: "tag", isSystem: false },
  {
    key: "project",
    label: "Project",
    icon: "project",
    isSystem: false,
    hidden: true,
    statusMode: "select",
    statusSchema: WORKFLOW_STATUS,
    propertySchema: [
      { key: "repo", label: "Repo URL", kind: "url" },
      { key: "liveurl", label: "Live URL", kind: "url" },
      { key: "stack", label: "Stack", kind: "text" },
    ],
    capability: "widget-home",
  },
  { key: "milestone", label: "Milestone", icon: "flag", isSystem: true, hidden: true, statusMode: "none", propertySchema: [] },
  {
    key: "pursuit",
    label: "Pursuit",
    icon: "target",
    isSystem: false,
    hidden: true,
    statusMode: "select",
    statusSchema: WORKFLOW_STATUS,
    capability: "widget-home",
  },
  {
    key: "memory",
    label: "Memory",
    icon: "sparkles",
    isSystem: false,
    hidden: true,
    propertySchema: [
      { key: "kind", label: "Kind", kind: "select", options: ["user", "feedback", "project", "reference"] },
      { key: "horizon", label: "Horizon", kind: "select", options: ["evergreen", "seasonal", "episodic"] },
      { key: "pinned", label: "Pinned", kind: "checkbox" },
    ],
  },
];

// Ensure the core types exist. Safe to run every boot (per-row ON CONFLICT DO
// NOTHING), so a user's edits to a type are never clobbered.
export async function seedCoreTypes(): Promise<void> {
  const db = getDb();
  for (const t of CORE_TYPES) {
    await db.insert(types).values(t).onConflictDoNothing();
  }
}

-- Meeting recording v1a (ADR-087): the `transcript` child type. A meeting's
-- transcript lives as its own item (parent_id = the meeting), not crammed into
-- the meeting body — so a 20k–35k-word transcript never swamps the human-facing
-- doc, and a meeting can carry several. It is is_system (not user-deletable) and
-- visible (browsable), but show_in_quick_capture=false: you never quick-capture a
-- transcript, you create one from its meeting.
--
-- property_schema carries one select field, `minutes` (none|draft|done): the
-- "needs minutes" signal the "Transcripts awaiting minutes" view filters on and
-- the Claude-over-MCP automation advances (none → draft on processing, done once
-- reviewed). Per-item values live in items.properties; new transcripts are
-- created with minutes=none so the index-backed `properties @>` filter matches.
--
-- Data-only migration (no schema-shape change), so the 0023 snapshot is
-- structurally identical to 0022. Idempotent; scripts/seed.mjs inserts the same
-- row for fresh databases.
INSERT INTO "types" ("key", "label", "icon", "is_system", "show_in_quick_capture", "property_schema")
VALUES (
  'transcript',
  'Transcript',
  'file-text',
  true,
  false,
  '[{"key": "minutes", "label": "Minutes", "kind": "select", "options": ["none", "draft", "done"]}]'::jsonb
)
ON CONFLICT ("key") DO NOTHING;

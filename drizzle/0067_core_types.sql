-- The four core content types a fresh database needs before anything can be
-- captured: task, event, note, link (ADR-282). Migration 0000 created the
-- `types` table but never inserted these rows; only scripts/seed.mjs did. That
-- was fine while every instance was made by hand (new-instance.mjs: migrate,
-- then seed), but an installed copy (the Windows installer, install.sh, the
-- supervisor's first run) applies migrations only and then makes its owner on
-- /setup, so it came up with person/project/tag/... and no task or note:
-- POST /api/items answered 400 "unknown type 'note'" (found 2026-09-25).
--
-- Each row is inserted in the shape seed.mjs leaves it in after the later
-- guarded appends (0028 tags field, 0031 project field, 0032 checkbox status),
-- so a migrated-only install and a seeded one converge. ON CONFLICT DO NOTHING
-- leaves every existing install byte-identical, including an owner's own edits
-- to these rows. seed.mjs stays as it is: its own inserts and appends are
-- already idempotent against these rows.
INSERT INTO types (key, label, icon, is_system, status_mode, property_schema)
VALUES (
  'task', 'Task', 'check-square', true, 'checkbox',
  '[{"key":"tags","label":"Tags","kind":"relation","targetType":"tag","cardinality":"many"},{"key":"project","label":"Project","kind":"relation","targetType":"project","cardinality":"single"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
INSERT INTO types (key, label, icon, is_system, property_schema)
VALUES (
  'event', 'Event', 'users', true,
  '[{"key":"tags","label":"Tags","kind":"relation","targetType":"tag","cardinality":"many"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
INSERT INTO types (key, label, icon, is_system, property_schema)
VALUES (
  'note', 'Note', 'file-text', true,
  '[{"key":"tags","label":"Tags","kind":"relation","targetType":"tag","cardinality":"many"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
INSERT INTO types (key, label, icon, is_system)
VALUES ('link', 'Link', 'link', true)
ON CONFLICT (key) DO NOTHING;

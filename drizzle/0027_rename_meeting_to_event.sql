-- Rename the `meeting` type to `event` (ADR-094). A calendar item isn't always
-- a meeting (a conference session, a time-block, notes against a date), so the
-- umbrella type is now `event`; "meeting-ness" (the prep panel + people) just
-- shows when an event has people related to it.
--
-- items.type -> types.key is an FK with no ON UPDATE CASCADE, so we can't rename
-- the key in place. Insert the new key (carrying every attribute of the old
-- row), repoint the referencing rows (items, templates, and any view filter that
-- targeted the type), then drop the old key. Idempotent + safe on a fresh DB
-- (where no `meeting` row exists yet, every statement is a no-op and seed.mjs
-- inserts `event` directly). Statements are split for the neon-http migrator.

INSERT INTO types (
  key, label, icon, is_system, property_schema, status_schema,
  show_in_quick_capture, hidden, capability, canvas_layout, default_view_id,
  deleted_at, created_at
)
SELECT
  'event', 'Event', icon, is_system, property_schema, status_schema,
  show_in_quick_capture, hidden, capability, canvas_layout, default_view_id,
  deleted_at, created_at
FROM types WHERE key = 'meeting'
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
UPDATE items SET type = 'event' WHERE type = 'meeting';
--> statement-breakpoint
UPDATE templates SET type = 'event' WHERE type = 'meeting';
--> statement-breakpoint
UPDATE views SET filter = jsonb_set(filter, '{type}', '"event"') WHERE filter->>'type' = 'meeting';
--> statement-breakpoint
DELETE FROM types WHERE key = 'meeting';

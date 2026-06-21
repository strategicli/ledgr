-- Tags (ADR-094 E2). A `tag` is an ordinary, non-privileged item type, seeded
-- like the base types but special-cased nowhere in code: tagging a task/event/
-- note is just a `relations` edge pointed at a tag item (the schema already
-- frames "tagging a task with a person is an edge"). People stay their own
-- calendar-matchable type; a tag is a pure grouping (no identity/email).
--
-- is_system = false so the type is fully user-controllable (rename to "Topic",
-- delete when it has no items, etc.); the delete guard (countLiveItemsOfType)
-- still protects a tag type that's in use. show_in_quick_capture = false keeps
-- the capture dropdown clean (tags are created while tagging, via create-on-miss
-- on the relation field below), hidden = false so it lists + can be a nav slot.
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden)
VALUES ('tag', 'Tag', 'tag', false, false, false)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- A built-in `tags` relation field on the three content types, so tagging is a
-- chip box with typeahead + create-on-miss (ADR-067's typed relation kind:
-- targetType = tag means create-on-miss makes a tag, not an unmarked stub). The
-- field's value is `relations` edges with role = "tags". Merge-safe + idempotent:
-- append only when the type has no `tags` field yet (so an instance that already
-- added custom properties keeps them, and a re-run is a no-op).
UPDATE types
SET property_schema = COALESCE(property_schema, '[]'::jsonb)
  || '[{"key":"tags","label":"Tags","kind":"relation","targetType":"tag","cardinality":"many"}]'::jsonb
WHERE key IN ('task', 'event', 'note')
  AND NOT (COALESCE(property_schema, '[]'::jsonb) @> '[{"key":"tags"}]'::jsonb);

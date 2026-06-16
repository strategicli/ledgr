-- ADR-067 R3: the `unmarked` placeholder type. A hidden, system type that
-- create-on-miss uses when the target type isn't known (free-text @-mention,
-- generic +Relate): the new item is `unmarked` + inbox=true, then triaged later
-- by retyping it out of the Inbox. Its label is a glyph so the user never reads
-- the word "unmarked" (the key is code-facing only; glyph is Brandon's to pick).
-- It is is_system (not user-deletable) and hidden (drops out of quick capture,
-- +New menus, list tabs, nav options — ADR-059). Idempotent so re-running is
-- safe; scripts/seed.mjs inserts the same row for fresh databases.
INSERT INTO "types" ("key", "label", "icon", "is_system", "show_in_quick_capture", "hidden")
VALUES ('unmarked', '◌', NULL, true, false, true)
ON CONFLICT ("key") DO NOTHING;

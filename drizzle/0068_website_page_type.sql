-- Website Page type (explorations/website-pages.md, ADR-284 for its block
-- syntax). A markdown item whose share link opens as a designed web page; the
-- website-pages module routes it (its manifest declares the type) and hides it
-- while the module is off (typeKeysOfDisabledModules), so an install that never
-- turns the module on never sees it. No done-state (status_mode='none'), out of
-- quick capture (a page is composed, not jotted), is_system=false so the owner
-- may rename or retire it. A migration, not seed.mjs, per ADR-283: a type the
-- module needs must exist on a migrated-only install.
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden, status_mode, property_schema)
VALUES ('website-page', 'Website Page', 'globe', false, false, false, 'none', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

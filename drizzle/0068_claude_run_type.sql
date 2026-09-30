-- The `claude_run` type (ADR-284): one record per scheduled Claude run that has
-- something worth keeping. Claude writes the report as the body at the END of a
-- run and ticks "Notify me" only when the owner should hear about it; the
-- claude-runs module then sends one Web Push and stamps properties.notifiedAt so
-- it never pings twice. Runs are ephemeral by design: a nightly job moves runs
-- older than 60 days to Trash. Visible (hidden=false) so the list is scannable,
-- kept out of quick capture (Claude files these, not the owner). Additive and
-- idempotent; mirrors the seed.mjs entry.
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden, property_schema)
VALUES (
  'claude_run', 'Claude Run', 'robot', false, false, false,
  '[{"key":"notifyMe","label":"Notify me","kind":"checkbox"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

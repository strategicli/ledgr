-- Pursuit type (Project Type, ADR-111/PJ9): a widget-composed Type one scope up
-- (PRD §1) — a Pursuit contains Projects exactly as a Project contains tasks
-- (the same containment primitive, the same widget canvas). Not special-cased:
-- it carries the widget-home capability and is a tracked subject, so its derived
-- widgets roll up its projects almost for free. status mirrors project.
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden, status_mode, status_schema, capability)
VALUES (
  'pursuit', 'Pursuit', 'target', false, true, false, 'select',
  '[{"key":"planning","label":"Planning","category":"not_started","color":"#64748b","isDefault":true},{"key":"active","label":"Active","category":"in_progress","color":"#d97706"},{"key":"on_hold","label":"On Hold","category":"not_started","color":"#6b7280"},{"key":"done","label":"Done","category":"done","color":"#16a34a","isDefault":true}]'::jsonb,
  'widget-home'
)
ON CONFLICT (key) DO NOTHING;

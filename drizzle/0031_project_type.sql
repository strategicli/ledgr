-- Project type (Tasks redesign, the hub that gates the Tasks → Projects tab).
-- A bespoke, user-controllable type (is_system=false). Uses the DEFAULT markdown
-- canvas for now — the Related panel already surfaces its related tasks / notes /
-- events, and custom properties give it repo/live-URL/stack. The polished board
-- hub is a later deep-dive (explorations/tasks-redesign.md). Statuses seed from
-- Tyler's Todoist buckets (configurable via the type's status editor, ADR-082);
-- all non-done buckets are the "active" category so a new project = "Ongoing".
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden, status_schema, property_schema)
VALUES (
  'project', 'Project', 'folder', false, true, false,
  '[{"key":"ongoing","label":"Ongoing","category":"not_started","color":"#d97706","isDefault":true},{"key":"waiting","label":"Waiting for Others","category":"not_started","color":"#64748b"},{"key":"paused","label":"Paused","category":"not_started","color":"#6b7280"},{"key":"future","label":"Future","category":"not_started","color":"#475569"},{"key":"done","label":"Done","category":"done","color":"#16a34a","isDefault":true}]'::jsonb,
  '[{"key":"repo","label":"Repo URL","kind":"url"},{"key":"liveurl","label":"Live URL","kind":"url"},{"key":"stack","label":"Stack","kind":"text"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- A built-in `project` relation field on `task` (ADR-067 typed relation;
-- targetType=project, single) — a task's "Project" picker, create-on-miss makes
-- a project. The value is a `relations` edge with role="project", so an event's
-- E4 task-pull can seed by a project and pull "tasks for Project X" for free
-- (its relatedTo query counts the edge). Merge-safe + idempotent.
UPDATE types
SET property_schema = COALESCE(property_schema, '[]'::jsonb)
  || '[{"key":"project","label":"Project","kind":"relation","targetType":"project","cardinality":"single"}]'::jsonb
WHERE key = 'task'
  AND NOT (COALESCE(property_schema, '[]'::jsonb) @> '[{"key":"project"}]'::jsonb);

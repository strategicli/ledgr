-- ADR-175: person connections are generic edges. The task type's user-created
-- "People" relation field (key `people`) read only role='people' edges, while
-- every other writer (inbox chip, MCP relateTo, promoted action items) writes
-- the default role='related' — so the field disagreed with Linked Here. Retire
-- the field: fold its edges into 'related' and drop it from the task schema.
-- Idempotent and a no-op on an instance that never created the field.

-- Rewrite role='people' edges to 'related' where no 'related' twin exists…
UPDATE relations r SET role = 'related'
WHERE r.role = 'people'
  AND NOT EXISTS (
    SELECT 1 FROM relations d
    WHERE d.source_id = r.source_id AND d.target_id = r.target_id AND d.role = 'related'
  );--> statement-breakpoint

-- …and drop the duplicates that do (the (source, target, role) unique blocks
-- rewriting those in place).
DELETE FROM relations WHERE role = 'people';--> statement-breakpoint

-- Remove the field from the task type's property_schema, preserving order.
UPDATE types
SET property_schema = COALESCE(
  (
    SELECT jsonb_agg(p ORDER BY ord)
    FROM jsonb_array_elements(property_schema) WITH ORDINALITY AS t(p, ord)
    WHERE NOT (p->>'kind' = 'relation' AND p->>'key' = 'people')
  ),
  '[]'::jsonb
)
WHERE key = 'task'
  AND property_schema @> '[{"kind":"relation","key":"people"}]';

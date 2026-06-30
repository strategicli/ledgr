ALTER TABLE "items" ADD COLUMN "next_action_task_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "next_action_text" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "composition" jsonb;--> statement-breakpoint
ALTER TABLE "types" ADD COLUMN "default_widgets" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_next_action_task_id_items_id_fk" FOREIGN KEY ("next_action_task_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Project status (ADR-111/PJ2). Fresh / unused instances (still on the 0031
-- bucket set, no project items) adopt the PRD §5 default Planning/Active/On
-- Hold/Done; a project then starts at Planning (initialStatusKey). Idempotent.
UPDATE "types" SET "status_schema" = '[{"key":"planning","label":"Planning","category":"not_started","color":"#64748b","isDefault":true},{"key":"active","label":"Active","category":"in_progress","color":"#d97706"},{"key":"on_hold","label":"On Hold","category":"not_started","color":"#6b7280"},{"key":"done","label":"Done","category":"done","color":"#16a34a","isDefault":true}]'::jsonb
WHERE "key" = 'project'
  AND "status_schema" @> '[{"key":"ongoing"}]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM "items" WHERE "items"."type" = 'project' AND "items"."deleted_at" IS NULL);
--> statement-breakpoint
-- In-use instances keep their own buckets but get the category-mapping bug fixed:
-- "Ongoing" moves not_started -> in_progress (so a project can read as active and
-- still starts at "Ongoing" via initialStatusKey). Only fires while the bug is
-- present, so it's idempotent and non-destructive to existing project items.
UPDATE "types" SET "status_schema" = '[{"key":"ongoing","label":"Ongoing","category":"in_progress","color":"#d97706","isDefault":true},{"key":"waiting","label":"Waiting for Others","category":"not_started","color":"#64748b"},{"key":"paused","label":"Paused","category":"not_started","color":"#6b7280"},{"key":"future","label":"Future","category":"not_started","color":"#475569"},{"key":"done","label":"Done","category":"done","color":"#16a34a","isDefault":true}]'::jsonb
WHERE "key" = 'project'
  AND "status_schema" @> '[{"key":"ongoing","category":"not_started"}]'::jsonb;

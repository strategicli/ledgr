ALTER TABLE "types" ADD COLUMN "status_mode" text;
--> statement-breakpoint
-- Per-type status display mode (ADR-106). Backfill existing rows; everything left
-- NULL resolves to 'none' via src/lib/status.ts resolveStatusMode (status is
-- opt-in, so person/note/link/event/etc. show no status affordance). `task`
-- becomes the new binary default; any type that already defines custom statuses
-- (project + any user type) is 'select' so it keeps its statuses. The 'checkbox'
-- UPDATE runs first so a schema-bearing task still lands on checkbox (its new
-- default), not select.
UPDATE "types" SET "status_mode" = 'checkbox' WHERE "key" = 'task';
--> statement-breakpoint
UPDATE "types" SET "status_mode" = 'select' WHERE "status_schema" IS NOT NULL AND "status_mode" IS NULL;

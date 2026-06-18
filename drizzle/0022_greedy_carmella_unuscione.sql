-- Tasks Polish S2 (ADR-082): configurable, category-backed statuses.
-- items.status becomes free text (a user-defined status key; open/done/archived
-- are preserved verbatim). A new items.status_category enum is the fixed bucket
-- the hot queries / the done-checkbox / recurrence key off; it's backfilled from
-- the existing status. types.status_schema holds a type's custom statuses (null
-- = inherit the system default). The status column is dropped-default → retyped
-- with an explicit cast → re-defaulted (an enum→text change can't carry its old
-- enum-typed default through the type swap).
CREATE TYPE "public"."status_category" AS ENUM('not_started', 'in_progress', 'done', 'archived');--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "status_category" "status_category" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
UPDATE "items" SET "status_category" = CASE "status" WHEN 'done' THEN 'done'::status_category WHEN 'archived' THEN 'archived'::status_category ELSE 'not_started'::status_category END;--> statement-breakpoint
ALTER TABLE "types" ADD COLUMN "status_schema" jsonb;--> statement-breakpoint
CREATE INDEX "items_status_category_idx" ON "items" USING btree ("status_category");

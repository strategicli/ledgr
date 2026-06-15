-- entity → person (ADR-055): the single bespoke "person" type replaces the
-- entity meta-type. Insert person, repoint any items/templates that referenced
-- entity, then drop the now-unreferenced entity type row.
INSERT INTO "types" ("key", "label", "icon", "is_system")
  VALUES ('person', 'Person', 'user', true)
  ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "items" SET "type" = 'person' WHERE "type" = 'entity';--> statement-breakpoint
UPDATE "templates" SET "type" = 'person' WHERE "type" = 'entity';--> statement-breakpoint
DELETE FROM "types" WHERE "key" = 'entity';--> statement-breakpoint
-- Drop the entity-only `kind` column. The generated FTS document referenced
-- it, so rebuild `search` (and its GIN index, which the column drop removes)
-- without the kind term.
ALTER TABLE "items" drop column "search";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("items"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("items"."body_text", '')), 'B') || setweight(to_tsvector('english', regexp_replace(coalesce("items"."url", ''), '[^a-zA-Z0-9]+', ' ', 'g')), 'C') || setweight(jsonb_to_tsvector('english', coalesce("items"."properties", '{}'::jsonb), '["string"]'), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "items_search_gin" ON "items" USING gin ("search");--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "kind";
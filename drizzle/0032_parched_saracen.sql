ALTER TABLE "items" ADD COLUMN "note_date" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "items_note_date_idx" ON "items" USING btree ("note_date");--> statement-breakpoint
-- ADR-100 backfill: seed each existing note's "date taken" from its creation
-- day, stored UTC-midnight to match the calendar-day convention (ADR-008).
UPDATE "items" SET "note_date" = date_trunc('day', "created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' WHERE "type" = 'note' AND "note_date" IS NULL;
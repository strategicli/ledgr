ALTER TABLE "items" ADD COLUMN "scheduled_date" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "items_scheduled_date_idx" ON "items" USING btree ("scheduled_date");
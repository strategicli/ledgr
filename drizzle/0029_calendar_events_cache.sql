CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"ms_event_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"meta" jsonb,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"promoted_item_id" uuid,
	"last_modified" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_promoted_item_id_items_id_fk" FOREIGN KEY ("promoted_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_owner_idx" ON "calendar_events" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_owner_event_uq" ON "calendar_events" USING btree ("owner_id","ms_event_id");--> statement-breakpoint
CREATE INDEX "calendar_events_feed_idx" ON "calendar_events" USING btree ("owner_id","start_at");
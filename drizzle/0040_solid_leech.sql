CREATE TYPE "public"."activity_kind" AS ENUM('record_created', 'status_changed', 'task_added', 'task_completed', 'note_added', 'meeting_held', 'milestone_added', 'milestone_passed', 'record_related', 'checkin_reviewed', 'overview_woven');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" "activity_kind" NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relations" ADD COLUMN "home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_subject_id_items_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_items_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_subject_idx" ON "activity_events" USING btree ("subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_owner_idx" ON "activity_events" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_checkin_idx" ON "activity_events" USING btree ("subject_id","occurred_at") WHERE "activity_events"."kind" = 'checkin_reviewed';--> statement-breakpoint
CREATE UNIQUE INDEX "relations_one_home_per_source_uq" ON "relations" USING btree ("source_id") WHERE "relations"."home";
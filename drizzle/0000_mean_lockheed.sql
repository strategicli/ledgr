CREATE TYPE "public"."item_status" AS ENUM('open', 'done', 'archived');--> statement-breakpoint
CREATE TYPE "public"."match_state" AS ENUM('confirmed', 'suggested');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."view_layout" AS ENUM('list', 'table', 'board', 'calendar', 'agenda');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_item_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" text,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" jsonb,
	"body_text" text,
	"status" "item_status" DEFAULT 'open' NOT NULL,
	"due_date" timestamp with time zone,
	"urgency" "urgency",
	"meeting_at" timestamp with time zone,
	"url" text,
	"kind" text,
	"todoist_id" text,
	"ms_event_id" text,
	"parent_id" uuid,
	"properties" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("items"."title", '') || ' ' || coalesce("items"."body_text", ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"role" text DEFAULT 'related' NOT NULL,
	"match_state" "match_state" DEFAULT 'confirmed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "types" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"icon" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"property_schema" jsonb,
	"default_view_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"filter" jsonb,
	"sort" jsonb,
	"grouping" jsonb,
	"layout" "view_layout" DEFAULT 'list' NOT NULL,
	"date_property" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_parent_item_id_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_type_types_key_fk" FOREIGN KEY ("type") REFERENCES "public"."types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_source_id_items_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_target_id_items_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "types" ADD CONSTRAINT "types_default_view_id_views_id_fk" FOREIGN KEY ("default_view_id") REFERENCES "public"."views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_parent_idx" ON "attachments" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "items_owner_idx" ON "items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "items_type_idx" ON "items" USING btree ("type");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "items_due_date_idx" ON "items" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "items_parent_idx" ON "items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "items_properties_gin" ON "items" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "items_search_gin" ON "items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "relations_source_idx" ON "relations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "relations_target_idx" ON "relations" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relations_source_target_role_uq" ON "relations" USING btree ("source_id","target_id","role");--> statement-breakpoint
CREATE INDEX "revisions_item_idx" ON "revisions" USING btree ("item_id");
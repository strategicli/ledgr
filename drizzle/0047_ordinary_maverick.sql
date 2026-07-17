-- Live editing context (ADR-162): one ephemeral "what am I looking at now" row
-- per owner, so Claude (over MCP, via get_active_context) can resolve "this
-- note" / "this sentence" to the item the owner currently has open and their
-- current text selection. Transient UI state, not user content (rule 2): stays
-- out of `items`, never exported/searched/revisioned. owner_id is unique (one
-- upserted row per owner; device clobbering is intended). item_id cascades so a
-- purged item can't leave a dangling pointer.
CREATE TABLE "active_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"item_id" uuid,
	"title" text,
	"selection_text" text,
	"selection_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_context" ADD CONSTRAINT "active_context_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_context" ADD CONSTRAINT "active_context_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "active_context_owner_uq" ON "active_context" USING btree ("owner_id");

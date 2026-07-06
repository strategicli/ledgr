CREATE TABLE "passage_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_item_id" uuid NOT NULL,
	"start_ref" integer NOT NULL,
	"end_ref" integer NOT NULL,
	"role" text DEFAULT 'passage' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passage_refs" ADD CONSTRAINT "passage_refs_source_item_id_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passage_refs_source_idx" ON "passage_refs" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "passage_refs_start_idx" ON "passage_refs" USING btree ("start_ref");--> statement-breakpoint
CREATE INDEX "passage_refs_end_idx" ON "passage_refs" USING btree ("end_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "passage_refs_source_interval_role_uq" ON "passage_refs" USING btree ("source_item_id","start_ref","end_ref","role");
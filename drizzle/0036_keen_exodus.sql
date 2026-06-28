CREATE TABLE "item_relatedness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"score" real NOT NULL,
	"signals" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_relatedness" ADD CONSTRAINT "item_relatedness_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_relatedness" ADD CONSTRAINT "item_relatedness_candidate_id_items_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_relatedness_item_candidate_uq" ON "item_relatedness" USING btree ("item_id","candidate_id");--> statement-breakpoint
CREATE INDEX "item_relatedness_candidate_idx" ON "item_relatedness" USING btree ("candidate_id");
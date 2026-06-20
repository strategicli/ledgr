-- Templates redesign (ADR-093): the registry now points at a prototype item,
-- so old config-blob rows can't be carried over. Alpha posture (ADR-039 — no
-- data to protect): reseed. This empties the table before the NOT NULL
-- prototype_item_id is added; re-author templates in the UI afterward.
DELETE FROM "templates";--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "prototype_item_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "apply_config" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_prototype_item_id_items_id_fk" FOREIGN KEY ("prototype_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_one_default_per_type" ON "templates" USING btree ("owner_id","type") WHERE "templates"."is_default";
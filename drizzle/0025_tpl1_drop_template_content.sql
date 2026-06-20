ALTER TABLE "items" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "body";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "property_defaults";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "relation_defaults";
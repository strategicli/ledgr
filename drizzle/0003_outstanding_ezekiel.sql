CREATE TABLE "job_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "export_path" text;
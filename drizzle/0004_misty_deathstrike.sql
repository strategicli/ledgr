-- pg_trgm powers the fuzzy title-similarity matcher (similarity()), the last-
-- resort condition (PRD §5.1). Built-in extension, no new dependency (rule 5).
-- Added by hand: drizzle-kit doesn't emit CREATE EXTENSION (cf. ADR-014's
-- hand-added GIN index).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "matchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"condition" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matchers" ADD CONSTRAINT "matchers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matchers_owner_priority_idx" ON "matchers" USING btree ("owner_id","priority");
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"body" jsonb,
	"property_defaults" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_type_types_key_fk" FOREIGN KEY ("type") REFERENCES "public"."types"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templates_owner_type_idx" ON "templates" USING btree ("owner_id","type");
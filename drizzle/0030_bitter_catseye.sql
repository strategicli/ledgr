-- Priority P1–P6 (ADR-096): urgency enum → smallint 1..6.
-- Map the old 4 levels: critical→1, high→2, normal→4, low→6 (null stays null).
ALTER TABLE "items" ALTER COLUMN "urgency" SET DATA TYPE integer USING (
  CASE "urgency"::text
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 4
    WHEN 'low' THEN 6
    ELSE NULL
  END
);--> statement-breakpoint
DROP TYPE "public"."urgency";

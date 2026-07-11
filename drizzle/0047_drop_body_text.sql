-- Lever C (ADR-153): drop the app-maintained body_text column and regenerate the
-- FTS tsvector from the canonical body markdown (body->>'text') instead. body_text
-- duplicated body.text purely to feed the generated `search` column, costing ~40%
-- of each item's storage.
--
-- Ordering matters: the generated `search` column DEPENDS ON body_text, so `search`
-- must be dropped before body_text. Recreating `search` as a STORED generated column
-- rewrites the items table — that rewrite is what actually reclaims the freed
-- body_text (and old-tsvector) bytes.
--
-- OPS WARNINGS (see decisions.md ADR-153 + runbook.md):
--   1. The table rewrite briefly holds a SECOND physical copy of the items heap
--      (~+250MB transient). On a storage-capped instance this can spike over the
--      cap mid-migration; run it with headroom (upgrade to Launch first, or run
--      off-peak on a plan without a hard cap).
--   2. The rewrite recomputes to_tsvector over every body (some up to ~2.4M chars),
--      so run this over a connection with a generous statement timeout — the
--      UNPOOLED/direct connection or psql — NOT a short-timeout Neon HTTP call.
--      (The neon-http migrator may time out on the ADD COLUMN step.)

ALTER TABLE "items" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "body_text";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("items"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("items"."body" ->> 'text', '')), 'B') || setweight(to_tsvector('english', regexp_replace(coalesce("items"."url", ''), '[^a-zA-Z0-9]+', ' ', 'g')), 'C') || setweight(jsonb_to_tsvector('english', coalesce("items"."properties", '{}'::jsonb), '["string"]'), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "items_search_gin" ON "items" USING gin ("search");

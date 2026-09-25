-- Share links sync between copies (ADR-277). Additive: two triggers and the
-- version stamp, nothing else. The shared trigger function already takes the
-- owner from an `owner_id` column and the row id from an `id` column, which is
-- exactly this table's shape, so it needs no change (0058's precedent).
--
-- Why: a hub that keeps a copy in the cloud makes its share links there (the
-- public address, settings.publicUrl), and the cloud can only open a link it
-- has heard of. Rows that already exist on both sides are untouched; only
-- links made or revoked from now on travel.
CREATE TRIGGER share_tokens_sync_id AFTER INSERT OR DELETE ON share_tokens
  FOR EACH ROW EXECUTE FUNCTION sync_log_op();--> statement-breakpoint
CREATE TRIGGER share_tokens_sync_u AFTER UPDATE ON share_tokens
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION sync_log_op();--> statement-breakpoint
-- A new table joins the synced set, so peers must both take this update before
-- they exchange ops again (the version gate, 0058 and 0065's precedent).
UPDATE "sync_schema_ver" SET "ver" = '0066_share_tokens_sync';

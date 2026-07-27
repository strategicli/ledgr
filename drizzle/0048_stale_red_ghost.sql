-- The range rule (ADR-timeline): a real end instant paired with meeting_at, so a
-- timed item (an event) can span hours or days. Additive + nullable; null = a
-- single-anchor item. The rest of this migration's autogen diff was spurious
-- (stale drizzle meta snapshots on main re-emitted already-applied 0041/0042/0046
-- objects); trimmed to the one true delta. See decisions.md ADR-timeline.
ALTER TABLE "items" ADD COLUMN "end_at" timestamp with time zone;

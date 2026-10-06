-- Push device names (ADR-290 follow-up): each push sign-up records what the
-- device called itself ("Ledgr app on Android", "Chrome on Mac") so Settings >
-- Notifications can list devices by name, test one, and remove a stale one.
-- Additive and nullable; rows from before this read as "Unnamed device". The
-- table is per-install and not synced, so no sync trigger.
-- (drizzle-kit also re-emitted 0070's signin_sessions.kind, which its snapshot
-- had missed; that line is dropped here since 0070 already added the column.)
ALTER TABLE "push_subscriptions" ADD COLUMN "label" text;

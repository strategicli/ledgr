-- App sign-ins (ADR-289): a phone app that signs in through Ledgr's OAuth
-- server (scope `api`) gets one row in signin_sessions, so it shows up in
-- Settings > Sign-in and is revoked the same way a browser session is. `kind`
-- tells the two apart: 'browser' (every existing row, the cookie sessions) or
-- 'app' (a row whose id is carried inside the app's signed tokens; its
-- token_hash is a random value no cookie can match). Additive; the table is
-- per-install and not synced, so no sync trigger or schema-version change.
ALTER TABLE "signin_sessions" ADD COLUMN "kind" text DEFAULT 'browser' NOT NULL;

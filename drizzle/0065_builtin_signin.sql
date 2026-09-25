CREATE TABLE "signin_install" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"method" text,
	"cookie_secret" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"failed_at" timestamp with time zone,
	CONSTRAINT "signin_install_one_row" CHECK ("signin_install"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "signin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_codes" jsonb;--> statement-breakpoint
ALTER TABLE "signin_sessions" ADD CONSTRAINT "signin_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signin_sessions_token_uq" ON "signin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "signin_sessions_owner_idx" ON "signin_sessions" USING btree ("owner_id");--> statement-breakpoint
-- ── Hand-written from here down (ADR-274) ──────────────────────────────────
--
-- Built-in sign-in keeps the password hash and the recovery codes on the users
-- row, and both must SYNC, so one password works on every copy. Until now the
-- users trigger logged `settings` only (plan decision 14). It now also logs
-- those two columns, each only when it actually changed, beside the per-key
-- settings diff from 0060. Nothing else about the function changes; it is
-- restated whole because CREATE OR REPLACE FUNCTION has no other form.
-- The two per-install tables above are deliberately NOT synced (no trigger).
CREATE OR REPLACE FUNCTION sync_log_op() RETURNS trigger
LANGUAGE plpgsql AS $sync$
DECLARE
  v_row jsonb;
  v_changed jsonb;
  v_kind text;
  v_row_id uuid;
  v_owner uuid;
  v_settings jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_kind := 'insert';
    v_row := to_jsonb(NEW) - 'search';
    v_changed := v_row;
  ELSIF TG_OP = 'UPDATE' THEN
    v_kind := 'update';
    v_row := to_jsonb(NEW) - 'search';
    SELECT coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) INTO v_changed
    FROM jsonb_each(v_row) n
    WHERE (to_jsonb(OLD) - 'search') -> n.key IS DISTINCT FROM n.value;
    IF v_changed = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    v_kind := 'delete';
    v_row := to_jsonb(OLD) - 'search';
    v_changed := v_row;
  END IF;

  IF TG_TABLE_NAME = 'users' THEN
    -- The trigger on this table fires on UPDATE alone (users_sync_u), so OLD is
    -- always available; the ELSE arms are defensive only.
    IF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD);
    ELSE
      v_old := '{}'::jsonb;
    END IF;
    v_changed := '{}'::jsonb;
    IF v_old -> 'settings' IS DISTINCT FROM v_row -> 'settings' THEN
      -- Only the settings keys that moved (ADR-226).
      SELECT coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) INTO v_settings
      FROM jsonb_each(coalesce(v_row -> 'settings', '{}'::jsonb)) n
      WHERE coalesce(v_old -> 'settings', '{}'::jsonb) -> n.key IS DISTINCT FROM n.value;
      IF v_settings = '{}'::jsonb THEN
        -- Only a REMOVED top-level key lands here. Send the whole blob so the
        -- removal still travels. Coarser merge, never a lost change.
        v_settings := coalesce(v_row -> 'settings', '{}'::jsonb);
      END IF;
      v_changed := jsonb_build_object('settings', v_settings);
    END IF;
    IF v_old -> 'password_hash' IS DISTINCT FROM v_row -> 'password_hash' THEN
      v_changed := v_changed || jsonb_build_object('password_hash', v_row -> 'password_hash');
    END IF;
    IF v_old -> 'recovery_codes' IS DISTINCT FROM v_row -> 'recovery_codes' THEN
      v_changed := v_changed || jsonb_build_object('recovery_codes', v_row -> 'recovery_codes');
    END IF;
    IF v_changed = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    v_owner := (v_row ->> 'id')::uuid;
  ELSIF v_row ? 'owner_id' THEN
    v_owner := (v_row ->> 'owner_id')::uuid;
  ELSIF TG_TABLE_NAME = 'relations' THEN
    SELECT owner_id INTO v_owner FROM items WHERE id = (v_row ->> 'source_id')::uuid;
  ELSIF TG_TABLE_NAME = 'revisions' THEN
    SELECT owner_id INTO v_owner FROM items WHERE id = (v_row ->> 'item_id')::uuid;
  ELSE
    SELECT id INTO v_owner FROM users ORDER BY created_at LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_row ? 'id' THEN
    v_row_id := (v_row ->> 'id')::uuid;
  ELSE
    v_row_id := md5(TG_TABLE_NAME || ':' || (v_row ->> 'key'))::uuid;
  END IF;

  INSERT INTO sync_ops (device_id, origin_device_id, owner_id, tbl, row_id, kind, changed, schema_ver)
  VALUES (
    (SELECT id FROM sync_device LIMIT 1),
    nullif(current_setting('ledgr.sync_origin', true), '')::uuid,
    v_owner,
    TG_TABLE_NAME,
    v_row_id,
    v_kind,
    v_changed,
    (SELECT ver FROM sync_schema_ver LIMIT 1)
  );
  RETURN NULL;
END
$sync$;--> statement-breakpoint
-- The users trigger now fires when any of the three synced columns moves, and
-- still logs nothing for a write that changes none of them (a clerk_id
-- backfill, for example).
DROP TRIGGER IF EXISTS users_sync_u ON users;--> statement-breakpoint
CREATE TRIGGER users_sync_u AFTER UPDATE ON users
  FOR EACH ROW WHEN (
    OLD.settings IS DISTINCT FROM NEW.settings
    OR OLD.password_hash IS DISTINCT FROM NEW.password_hash
    OR OLD.recovery_codes IS DISTINCT FROM NEW.recovery_codes
  ) EXECUTE FUNCTION sync_log_op();--> statement-breakpoint
-- A synced table changed shape, so peers must both take this update before
-- they exchange ops again (the version gate, 0058's precedent).
UPDATE "sync_schema_ver" SET "ver" = '0065_builtin_signin';

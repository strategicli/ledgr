-- Scripture passages becomes default OFF for new installs (ADR-272), without
-- switching it off for anyone who has it today. Every owner that already
-- exists and has no explicit settings.modules.passages gets `true` written, so
-- the manifest default no longer decides for them. An owner who already chose
-- (true or false) is left alone, and running this twice changes nothing.
-- A new install runs migrations before its owner row exists (new-instance.mjs:
-- migrate, then seed), so its owner starts with the new default.
UPDATE users
SET settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object('modules', coalesce(settings -> 'modules', '{}'::jsonb) || '{"passages": true}'::jsonb)
WHERE NOT coalesce(settings -> 'modules', '{}'::jsonb) ? 'passages';

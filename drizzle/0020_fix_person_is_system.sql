-- Corrective data migration (ADR-070): mark the `person` type as a system type.
-- ADR-055 / migration 0013 intended person to be is_system = true (it's the
-- relational hub per ADR-055/ADR-060 and must not be user-deletable), but 0013's
-- INSERT used ON CONFLICT ("key") DO NOTHING, which silently kept an earlier
-- row whose is_system was false. The result: person was the only base type
-- flagged non-system, so the "system types can't be deleted" guards in
-- src/lib/types.ts didn't protect it. This converges every instance to the
-- intended value. Idempotent (no-op where already true); fresh seeds are already
-- correct (scripts/seed.mjs inserts person with is_system = true).
UPDATE "types" SET "is_system" = true WHERE "key" = 'person';

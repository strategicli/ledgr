-- Project Type (ADR-111/PJ4): route the `project` type's records through the
-- widget-composed canvas via the `widget-home` capability (registered in
-- coreModule). Data-only, idempotent — leaves a customized capability alone.
UPDATE "types" SET "capability" = 'widget-home' WHERE "key" = 'project' AND "capability" IS NULL;

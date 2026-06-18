// Server-side resolution of a type's status schema (Tasks Polish S2, ADR-082).
// Loads types.status_schema and runs it through the pure status.ts helpers. A
// separate, tiny server module so items.ts and recurrence-service.ts can resolve
// statuses without importing types.ts (which imports ItemError from items.ts —
// the cycle this avoids). The pure logic lives in status.ts; this only fetches.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import { parseStatusSchema, resolveStatusSchema, type StatusDef } from "@/lib/status";

// The effective, ordered, defaults-normalized status set for a type: its own
// status_schema, else the system default. One small indexed lookup; callers
// (createItem/updateItem/recurrence) resolve a status key's category from it.
export async function statusSchemaForType(typeKey: string): Promise<StatusDef[]> {
  const rows = await getDb()
    .select({ s: types.statusSchema })
    .from(types)
    .where(eq(types.key, typeKey));
  return resolveStatusSchema(rows.length ? parseStatusSchema(rows[0].s) : null);
}

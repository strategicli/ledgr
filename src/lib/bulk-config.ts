// Builds the BulkActionBar's config from a type (ADR-118). Server-safe (no
// client imports) so list pages can compute it and pass the plain, serializable
// result to the client bar. Centralizing it here means every surface offers the
// same, type-appropriate bulk Set… fields without each page re-deriving them.
import { resolveStatusSchema, type StatusDef } from "@/lib/status";
import type { TypeDefinition } from "@/lib/types";
import { propertyFilterOptions } from "@/lib/views";

export type BulkActionConfig = {
  propertyFields?: {
    key: string;
    label: string;
    kind: "select" | "multi_select";
    options: string[];
  }[];
  statuses?: StatusDef[];
  dateFields?: ("dueDate" | "scheduledDate")[];
  // A "✓ Triaged" button (clears the inbox flag on the selection). The Inbox
  // turns this on; ordinary lists leave it off (ADR-118 + the inbox slice).
  canTriage?: boolean;
  // A Priority (P1–P6) field in the Set… menu. `urgency` is a real column on
  // every type, so it's safe on a mixed-type selection like the Inbox.
  priorityField?: boolean;
};

// A type whose status mode is "none" (person, link, most notes) has no
// completion concept, so we offer neither the status setter nor the plan-date
// setters — matching what the type surfaces everywhere else (defer-by-hiding).
// select/multi_select properties are always offered.
export function bulkConfigForType(typeDef: TypeDefinition): BulkActionConfig {
  const propertyFields = propertyFilterOptions(typeDef.propertySchema).map((p) => {
    const kind =
      typeDef.propertySchema.find((d) => d.key === p.key)?.kind === "multi_select"
        ? ("multi_select" as const)
        : ("select" as const);
    return { key: p.key, label: p.label, kind, options: p.options };
  });

  const hasStatus = typeDef.statusMode !== "none";
  return {
    propertyFields,
    ...(hasStatus ? { statuses: resolveStatusSchema(typeDef.statusSchema) } : {}),
    ...(hasStatus
      ? { dateFields: ["dueDate", "scheduledDate"] as ("dueDate" | "scheduledDate")[] }
      : {}),
  };
}

// The type registry store (slice 33, PRD §3.6/§4.10): CRUD + validation for
// the `types` table the Build surface edits. Same discipline as views.ts —
// hand-rolled validation (the shapes are small; a schema lib isn't worth a
// dependency, rule 5), one place that turns request JSON into a well-formed
// definition, and a row->definition coercion so a hand-edited or legacy row
// still reads cleanly.
//
// Types are an instance-global registry, not owner-scoped (one user per
// deploy; the table has no owner_id). The mutations still run behind
// requireOwner in the API, and the items.type -> types.key FK keeps a type
// that's in use from being deleted. A user type is just a row: it inherits the
// default markdown canvas and markdown format from the module registry
// (modules.ts resolvers fall back for any unregistered type), so the builder
// never touches code — it writes label/icon/property_schema, and the registry
// owns code behavior (ADR-043).
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, types } from "@/db/schema";
import { ItemError } from "@/lib/items";

// The core property kinds (schema.md "Property kinds"). `relation` is
// deliberately omitted from the builder for now: item-to-item links already
// have the @-mention + Related panel, so a relation "property" would duplicate
// that surface. text/number/date/checkbox/url are scalar; select/multi_select
// carry an options list.
export const PROPERTY_KINDS = [
  "text",
  "number",
  "date",
  "checkbox",
  "url",
  "select",
  "multi_select",
] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

const KINDS_WITH_OPTIONS: PropertyKind[] = ["select", "multi_select"];

// One custom field on a type. `key` is the stable identifier used in
// items.properties (never changes once created, so renaming the label doesn't
// orphan values); `label` is the display name; `options` lists the choices for
// select/multi_select.
export type PropertyDef = {
  key: string;
  label: string;
  kind: PropertyKind;
  options?: string[];
};

export type TypeDefinition = {
  key: string;
  label: string;
  icon: string | null;
  isSystem: boolean;
  propertySchema: PropertyDef[];
  showInQuickCapture: boolean;
  createdAt: Date;
};

// The editable fields the builder submits. Create also carries `key` (the PK,
// immutable after create); patch never does.
export type TypeInput = {
  label: string;
  icon: string | null;
  propertySchema: PropertyDef[];
  showInQuickCapture: boolean;
};
export type TypeCreateInput = TypeInput & { key: string };

// Built-in entity kinds (schema.md items.kind), offered alongside whatever
// kinds the owner has already used so the Kind picker reuses an existing
// vocabulary instead of fragmenting it (exploration type-and-kind-ux §1).
export const DEFAULT_ENTITY_KINDS = [
  "person",
  "org",
  "project",
  "topic",
  "campus",
] as const;

// Lowercase slug: starts with a letter, then letters/digits/underscore. Used
// for both a type key and a property key (both end up as map keys / FK values,
// so they stay simple and stable). Hyphens are out so a key is a clean JS
// identifier in items.properties.
const SLUG_RE = /^[a-z][a-z0-9_]*$/;

function bad(message: string): never {
  throw new ItemError("bad_request", message);
}

function asTrimmedString(value: unknown, field: string): string {
  if (typeof value !== "string") bad(`${field} must be a string`);
  return value.trim();
}

// A type or property key: slug-shaped and length-capped, normalized to
// lowercase so "Author" and "author" can't both exist.
function parseKey(raw: unknown, field: string): string {
  const key = asTrimmedString(raw, field).toLowerCase();
  if (!key) bad(`${field} is required`);
  if (key.length > 40) bad(`${field} too long (40 max)`);
  if (!SLUG_RE.test(key)) {
    bad(`${field} must start with a letter and use only letters, digits, _`);
  }
  return key;
}

// Validate the property list: each def has a slug key, a label, a known kind,
// and (for select/multi_select) a non-empty options list. Duplicate keys are
// rejected so item values never collide. Returns a normalized PropertyDef[].
export function parsePropertySchema(raw: unknown): PropertyDef[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) bad("propertySchema must be an array");
  if (raw.length > 50) bad("a type can have at most 50 properties");
  const out: PropertyDef[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      bad("each property must be an object");
    }
    const e = entry as Record<string, unknown>;
    const key = parseKey(e.key, "property key");
    if (seen.has(key)) bad(`duplicate property key '${key}'`);
    seen.add(key);
    const label = asTrimmedString(e.label, "property label");
    if (!label) bad(`property '${key}' needs a label`);
    if (label.length > 80) bad(`property '${key}' label too long`);
    const kind = e.kind;
    if (!PROPERTY_KINDS.includes(kind as PropertyKind)) {
      bad(`property '${key}' has an unknown kind`);
    }
    const def: PropertyDef = { key, label, kind: kind as PropertyKind };
    if (KINDS_WITH_OPTIONS.includes(def.kind)) {
      if (!Array.isArray(e.options)) bad(`property '${key}' needs options`);
      const options = Array.from(
        new Set(
          (e.options as unknown[])
            .map((o) => asTrimmedString(o, `property '${key}' option`))
            .filter(Boolean)
        )
      );
      if (options.length === 0) bad(`property '${key}' needs at least one option`);
      if (options.length > 100) bad(`property '${key}' has too many options`);
      def.options = options;
    }
    out.push(def);
  }
  return out;
}

function parseCommon(raw: unknown): {
  r: Record<string, unknown>;
  label: string;
  icon: string | null;
  propertySchema: PropertyDef[];
  showInQuickCapture: boolean;
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad("request body must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const label = asTrimmedString(r.label, "label");
  if (!label) bad("label is required");
  if (label.length > 80) bad("label too long");
  const icon =
    r.icon == null || r.icon === "" ? null : asTrimmedString(r.icon, "icon");
  const propertySchema = parsePropertySchema(r.propertySchema);
  // Default true (a new type is capturable unless the builder opts it out).
  const showInQuickCapture = r.showInQuickCapture !== false;
  return { r, label, icon, propertySchema, showInQuickCapture };
}

export function parseTypeInput(raw: unknown, mode: "create"): TypeCreateInput;
export function parseTypeInput(raw: unknown, mode: "patch"): TypeInput;
export function parseTypeInput(
  raw: unknown,
  mode: "create" | "patch"
): TypeCreateInput | TypeInput {
  const { r, label, icon, propertySchema, showInQuickCapture } =
    parseCommon(raw);
  if (mode === "create") {
    return {
      key: parseKey(r.key, "key"),
      label,
      icon,
      propertySchema,
      showInQuickCapture,
    };
  }
  return { label, icon, propertySchema, showInQuickCapture };
}

// Drizzle returns property_schema as unknown; coerce through the parser so a
// legacy/hand-edited row still yields a well-formed definition (a malformed
// schema degrades to [] rather than throwing on read).
function rowToDefinition(row: typeof types.$inferSelect): TypeDefinition {
  let propertySchema: PropertyDef[] = [];
  try {
    propertySchema = parsePropertySchema(row.propertySchema);
  } catch {
    propertySchema = [];
  }
  return {
    key: row.key,
    label: row.label,
    icon: row.icon,
    isSystem: row.isSystem,
    propertySchema,
    showInQuickCapture: row.showInQuickCapture,
    createdAt: row.createdAt,
  };
}

// System types sort first, then alphabetical by label — the same order the nav
// uses (compareTypeKeys), so the Build list reads like the rest of the app.
export async function listTypes(): Promise<TypeDefinition[]> {
  const rows = await getDb().select().from(types);
  return rows
    .map(rowToDefinition)
    .sort(
      (a, b) =>
        Number(b.isSystem) - Number(a.isSystem) ||
        a.label.localeCompare(b.label)
    );
}

export async function getType(key: string): Promise<TypeDefinition> {
  const rows = await getDb().select().from(types).where(eq(types.key, key));
  if (rows.length === 0) throw new ItemError("not_found", "type not found");
  return rowToDefinition(rows[0]);
}

export async function createType(
  input: TypeCreateInput
): Promise<TypeDefinition> {
  // Friendly pre-check rather than surfacing a raw PK-conflict from the driver.
  const existing = await getDb()
    .select({ key: types.key })
    .from(types)
    .where(eq(types.key, input.key));
  if (existing.length > 0) bad(`a type with key '${input.key}' already exists`);

  const rows = await getDb()
    .insert(types)
    .values({
      key: input.key,
      label: input.label,
      icon: input.icon,
      isSystem: false, // the five system types are seeded, never built here
      propertySchema: input.propertySchema,
      showInQuickCapture: input.showInQuickCapture,
    })
    .returning();
  return rowToDefinition(rows[0]);
}

// Edits label/icon/property_schema/show-in-quick-capture. The key is the PK and
// FK target, so it's immutable (renaming it would orphan every item). System
// types are editable here (adding a property to "meeting" is harmless and
// useful); only delete is blocked for them.
export async function updateType(
  key: string,
  input: TypeInput
): Promise<TypeDefinition> {
  await getType(key); // existence
  const rows = await getDb()
    .update(types)
    .set({
      label: input.label,
      icon: input.icon,
      propertySchema: input.propertySchema,
      showInQuickCapture: input.showInQuickCapture,
    })
    .where(eq(types.key, key))
    .returning();
  return rowToDefinition(rows[0]);
}

// Blocked for system types, and for any type still in use — the FK would
// reject it anyway, but a counted pre-check gives a message that names how many
// items hold it. The count spans all owners because the type is instance-global
// (any item referencing it blocks the delete).
export async function deleteType(key: string): Promise<void> {
  const def = await getType(key);
  if (def.isSystem) bad("system types can't be deleted");
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.type, key));
  if (count > 0) {
    bad(`type '${key}' is used by ${count} item(s); reassign or trash them first`);
  }
  await getDb().delete(types).where(eq(types.key, key));
}

// The kinds offered in the entity Kind picker (exploration type-and-kind-ux
// §1): the built-in vocabulary merged with the distinct kinds this owner has
// already used, so the dropdown reuses kinds instead of fragmenting them.
// Owner-scoped (kinds live on the owner's items), live items only.
export async function distinctEntityKinds(ownerId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ kind: items.kind })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "entity"),
        isNull(items.deletedAt)
      )
    );
  const used = rows
    .map((r) => r.kind)
    .filter((k): k is string => !!k);
  return Array.from(new Set([...DEFAULT_ENTITY_KINDS, ...used])).sort();
}

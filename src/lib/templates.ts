// Per-type item templates (slice 34, PRD §4.3/§4.14): reusable starting points
// for new items — preset custom-property values + starter body content. Same
// store discipline as views.ts/types.ts: hand-rolled validation (the shapes are
// small; a schema lib isn't worth a dependency, rule 5), one parse path, and a
// row->definition coercion so a hand-edited or legacy row still reads cleanly.
//
// Owner-scoped (a template is personal config, like a view), keyed to a type.
// The Phase-2 meeting-prep agenda (src/lib/meetings/prep.ts) is the forerunner:
// a hardcoded default body for one type; this generalizes it so any type can
// carry named, editable starting points. Applying a template is just createItem
// with the body + property defaults filled in.
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { items, templates, types } from "@/db/schema";
import { isItemBody, makeMarkdownBody, type ItemBody } from "@/lib/body";
import { createItem, ItemError } from "@/lib/items";

export type ItemTemplate = {
  id: string;
  type: string;
  name: string;
  // Canonical { format, text } starter body, or null for "start blank".
  body: ItemBody | null;
  // Seeds items.properties on apply; the keys are a type's property_schema
  // keys (validated loosely here — it mirrors the freeform properties column).
  propertyDefaults: Record<string, unknown>;
  createdAt: Date;
};

// What the builder submits. `type` is set on create and immutable after (the
// defaults are keyed to that type's schema; re-pointing would orphan them).
export type TemplateCreateInput = {
  type: string;
  name: string;
  body: ItemBody | null;
  propertyDefaults: Record<string, unknown>;
};
export type TemplatePatchInput = Omit<TemplateCreateInput, "type">;

function bad(message: string): never {
  throw new ItemError("bad_request", message);
}

// A starter body: accept either a raw markdown string (wrapped into the
// { format, text } shape) or an already-shaped body; an empty body stores null.
function parseBody(raw: unknown): ItemBody | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    return raw.trim() ? makeMarkdownBody(raw) : null;
  }
  if (isItemBody(raw)) return raw.text.trim() ? raw : null;
  bad("body must be a markdown string or a { format, text } object");
}

function parseDefaults(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    bad("propertyDefaults must be an object");
  }
  // Drop null/undefined values so a default never writes an empty key.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null && v !== "") out[k] = v;
  }
  return out;
}

function parseName(raw: unknown): string {
  if (typeof raw !== "string") bad("name must be a string");
  const name = raw.trim();
  if (!name) bad("name is required");
  if (name.length > 120) bad("name too long (120 max)");
  return name;
}

export function parseTemplateInput(raw: unknown, mode: "create"): TemplateCreateInput;
export function parseTemplateInput(raw: unknown, mode: "patch"): TemplatePatchInput;
export function parseTemplateInput(
  raw: unknown,
  mode: "create" | "patch"
): TemplateCreateInput | TemplatePatchInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad("request body must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const common = {
    name: parseName(r.name),
    body: parseBody(r.body),
    propertyDefaults: parseDefaults(r.propertyDefaults),
  };
  if (mode === "create") {
    if (typeof r.type !== "string" || !r.type.trim()) bad("type is required");
    return { type: r.type.trim(), ...common };
  }
  return common;
}

async function assertTypeExists(type: string): Promise<void> {
  const rows = await getDb()
    .select({ key: types.key })
    .from(types)
    .where(eq(types.key, type));
  if (rows.length === 0) throw new ItemError("bad_request", `unknown type '${type}'`);
}

function rowToTemplate(row: typeof templates.$inferSelect): ItemTemplate {
  const defaults =
    row.propertyDefaults &&
    typeof row.propertyDefaults === "object" &&
    !Array.isArray(row.propertyDefaults)
      ? (row.propertyDefaults as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    body: isItemBody(row.body) ? row.body : null,
    propertyDefaults: defaults,
    createdAt: row.createdAt,
  };
}

// All of the owner's templates, optionally for one type; type then name order
// so the index reads grouped.
export async function listTemplates(
  ownerId: string,
  type?: string
): Promise<ItemTemplate[]> {
  const where = [eq(templates.ownerId, ownerId)];
  if (type) where.push(eq(templates.type, type));
  const rows = await getDb()
    .select()
    .from(templates)
    .where(and(...where))
    .orderBy(asc(templates.type), asc(templates.name));
  return rows.map(rowToTemplate);
}

export async function getTemplate(
  ownerId: string,
  id: string
): Promise<ItemTemplate> {
  const rows = await getDb()
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.ownerId, ownerId)));
  if (rows.length === 0) throw new ItemError("not_found", "template not found");
  return rowToTemplate(rows[0]);
}

export async function createTemplate(
  ownerId: string,
  input: TemplateCreateInput
): Promise<ItemTemplate> {
  await assertTypeExists(input.type);
  const rows = await getDb()
    .insert(templates)
    .values({
      ownerId,
      type: input.type,
      name: input.name,
      body: input.body,
      propertyDefaults: input.propertyDefaults,
    })
    .returning();
  return rowToTemplate(rows[0]);
}

export async function updateTemplate(
  ownerId: string,
  id: string,
  input: TemplatePatchInput
): Promise<ItemTemplate> {
  await getTemplate(ownerId, id); // ownership + existence
  const rows = await getDb()
    .update(templates)
    .set({
      name: input.name,
      body: input.body,
      propertyDefaults: input.propertyDefaults,
    })
    .where(and(eq(templates.id, id), eq(templates.ownerId, ownerId)))
    .returning();
  return rowToTemplate(rows[0]);
}

export async function deleteTemplate(ownerId: string, id: string): Promise<void> {
  await getTemplate(ownerId, id); // ownership + existence
  await getDb()
    .delete(templates)
    .where(and(eq(templates.id, id), eq(templates.ownerId, ownerId)));
}

// Apply a template: create a real item of its type seeded with the starter
// body + property defaults. Deliberate creation (like "+ New"), so it does not
// land in the Inbox (ADR-010 — inbox membership is an explicit arrival act).
// The title is left empty for the user to fill, matching the blank "+ New".
export async function createItemFromTemplate(ownerId: string, id: string) {
  const template = await getTemplate(ownerId, id);
  return createItem(ownerId, {
    type: template.type,
    body: template.body,
    properties: Object.keys(template.propertyDefaults).length
      ? template.propertyDefaults
      : null,
    inbox: false,
  });
}

// Per-type template counts for the owner, e.g. { task: 2, meeting: 1 }. Powers
// the "+ New" menu's decision to offer templates and the Build index badges.
export async function templateCountsByType(
  ownerId: string
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ type: templates.type })
    .from(templates)
    .where(eq(templates.ownerId, ownerId));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}

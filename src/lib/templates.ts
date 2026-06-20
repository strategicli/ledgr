// Per-type item templates — a thin REGISTRY over real prototype items (ADR-093,
// reverses ADR-045). A template's content is an ordinary item + subtree
// (is_template = true), authored in the same canvas as any item; this store
// holds only the metadata row (name, type, prototype, default flag, apply
// config) and the apply logic. Apply = cloneItemSubtree(prototype), which
// carries the prototype's body, properties, subtasks, and relation edges onto a
// fresh real item — so the prototype's own content subsumes the old
// body/property_defaults/relation_defaults blob (no second editor, no drift).
// Same owner-scoped, hand-rolled-validation discipline as views.ts/types.ts.
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items, templates, types } from "@/db/schema";
import { cloneItemSubtree } from "@/lib/clone";
import { createItem, getItem, ItemError, softDeleteItem } from "@/lib/items";

export type ItemTemplate = {
  id: string;
  type: string;
  name: string;
  // The hidden prototype item this template clones on apply. Author it by
  // opening /items/<prototypeItemId> in the normal canvas.
  prototypeItemId: string;
  // The type's default template (TPL4): "+ New" uses it automatically.
  isDefault: boolean;
  // Apply-time config (TPL3): date-field rules / variable defaults. Opaque
  // here; null until variable resolution lands.
  applyConfig: Record<string, unknown> | null;
  createdAt: Date;
};

// Create takes only name + type; the prototype is created empty and authored in
// the canvas afterwards. Type is immutable after create (the prototype is keyed
// to it). Patch edits the metadata only (name, default flag).
export type TemplateCreateInput = { type: string; name: string };
export type TemplatePatchInput = { name?: string; isDefault?: boolean };

function bad(message: string): never {
  throw new ItemError("bad_request", message);
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
  if (mode === "create") {
    if (typeof r.type !== "string" || !r.type.trim()) bad("type is required");
    return { type: r.type.trim(), name: parseName(r.name) };
  }
  const patch: TemplatePatchInput = {};
  if (r.name !== undefined) patch.name = parseName(r.name);
  if (r.isDefault !== undefined) {
    if (typeof r.isDefault !== "boolean") bad("isDefault must be a boolean");
    patch.isDefault = r.isDefault;
  }
  if (patch.name === undefined && patch.isDefault === undefined) {
    bad("nothing to update");
  }
  return patch;
}

async function assertTypeExists(type: string): Promise<void> {
  const rows = await getDb()
    .select({ key: types.key })
    .from(types)
    .where(and(eq(types.key, type), isNull(types.deletedAt)));
  if (rows.length === 0) throw new ItemError("bad_request", `unknown type '${type}'`);
}

function parseApplyConfig(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function rowToTemplate(row: typeof templates.$inferSelect): ItemTemplate {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    prototypeItemId: row.prototypeItemId,
    isDefault: row.isDefault,
    applyConfig: parseApplyConfig(row.applyConfig),
    createdAt: row.createdAt,
  };
}

// The owner's templates, optionally for one type; type then name order so the
// index reads grouped. Joined to items so a registry row whose prototype was
// soft-deleted directly (orphaning the row until the purge cascade clears it) is
// skipped defensively.
export async function listTemplates(
  ownerId: string,
  type?: string
): Promise<ItemTemplate[]> {
  const where = [eq(templates.ownerId, ownerId), isNull(items.deletedAt)];
  if (type) where.push(eq(templates.type, type));
  const rows = await getDb()
    .select({ t: templates })
    .from(templates)
    .innerJoin(items, eq(items.id, templates.prototypeItemId))
    .where(and(...where))
    .orderBy(asc(templates.type), asc(templates.name));
  return rows.map((r) => rowToTemplate(r.t));
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

// Create a template = a registry row + an empty hidden prototype item, authored
// afterwards in the normal canvas (ADR-093). The prototype is is_template=true
// with a blank body; the user opens /items/<prototypeItemId> to build it out
// (subtasks, body, properties, relations — all real).
export async function createTemplate(
  ownerId: string,
  input: TemplateCreateInput
): Promise<ItemTemplate> {
  await assertTypeExists(input.type);
  const prototype = await createItem(ownerId, {
    type: input.type,
    title: input.name,
    isTemplate: true,
    inbox: false,
  });
  const rows = await getDb()
    .insert(templates)
    .values({
      ownerId,
      type: input.type,
      name: input.name,
      prototypeItemId: prototype.id,
    })
    .returning();
  return rowToTemplate(rows[0]);
}

export async function updateTemplate(
  ownerId: string,
  id: string,
  input: TemplatePatchInput
): Promise<ItemTemplate> {
  const existing = await getTemplate(ownerId, id); // ownership + existence
  // Making this the type's default clears any other default for the same type
  // first (the partial unique index allows only one per owner+type).
  if (input.isDefault === true) {
    await getDb()
      .update(templates)
      .set({ isDefault: false })
      .where(
        and(
          eq(templates.ownerId, ownerId),
          eq(templates.type, existing.type),
          eq(templates.isDefault, true)
        )
      );
  }
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.isDefault !== undefined) set.isDefault = input.isDefault;
  const rows = await getDb()
    .update(templates)
    .set(set)
    .where(and(eq(templates.id, id), eq(templates.ownerId, ownerId)))
    .returning();
  return rowToTemplate(rows[0]);
}

// Delete = drop the registry row AND soft-delete its prototype subtree (the
// prototype is a real item; it goes to Trash like any other). Registry-aware so
// the FK can't dangle; best-effort on the prototype (an already-gone one mustn't
// block the registry delete).
export async function deleteTemplate(ownerId: string, id: string): Promise<void> {
  const tmpl = await getTemplate(ownerId, id); // ownership + existence
  await getDb()
    .delete(templates)
    .where(and(eq(templates.id, id), eq(templates.ownerId, ownerId)));
  try {
    await softDeleteItem(ownerId, tmpl.prototypeItemId);
  } catch (err) {
    if (!(err instanceof ItemError)) throw err;
  }
}

// Apply a template: deep-clone its prototype subtree into a fresh REAL item
// (cloneItemSubtree never copies is_template, so the clone and its children are
// is_template=false). Carries the prototype's body, properties, subtasks, and
// relation edges (carryRelations). Deliberate creation, so not an Inbox arrival
// (ADR-010). Returns the new root item. (TPL3 layers variable resolution and
// TPL4 the apply-to-existing merge on top of this.)
export async function createItemFromTemplate(ownerId: string, id: string) {
  const tmpl = await getTemplate(ownerId, id);
  const { rootId } = await cloneItemSubtree(ownerId, tmpl.prototypeItemId, {
    inbox: false,
  });
  return getItem(ownerId, rootId);
}

// Per-type template counts for the owner, e.g. { task: 2, meeting: 1 } — powers
// the "+ New" menu's decision to offer templates and the Build index badges.
// Counts only live-prototype templates.
export async function templateCountsByType(
  ownerId: string
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ type: templates.type })
    .from(templates)
    .innerJoin(items, eq(items.id, templates.prototypeItemId))
    .where(and(eq(templates.ownerId, ownerId), isNull(items.deletedAt)));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}

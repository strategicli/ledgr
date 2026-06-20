// Templates redesign verification (ADR-093, TPL1): templates are a thin registry
// over real prototype items. Covers parse/validate, registry CRUD + default
// uniqueness, the is_template subtree invariant, apply = cloneItemSubtree
// (produces REAL items), the FK/cascade rules, and — the heart of the slice —
// the EXCLUSION net: a prototype (and its subtree) must not appear in any
// owner-scoped enumeration (list/search/view/today/counts/related) while staying
// visible by id (getItem) for authoring/apply. Against live Neon under throwaway
// owners. Run: npx tsx scripts/verify-templates.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, templates, types, users } = await import("../src/db/schema");
const {
  parseTemplateInput,
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  createItemFromTemplate,
  templateCountsByType,
} = await import("../src/lib/templates");
const { createType, deleteType, countLiveItemsOfType } = await import("../src/lib/types");
const { ItemError, createItem, getItem, listItems, itemCountsByType, updateItem } =
  await import("../src/lib/items");
const { searchItems } = await import("../src/lib/search");
const { queryViewItems } = await import("../src/lib/views");
const { getTodayData } = await import("../src/lib/today");
const { listRelatedItems, relateItems } = await import("../src/lib/relations");
const { and, eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function throws(name: string, fn: () => Promise<unknown> | unknown, code?: string) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    const ok = err instanceof ItemError && (!code || err.code === code);
    check(name, ok, err instanceof Error ? err.message : String(err));
  }
}

const stamp = Date.now();
const typeKey = `vtmpl${stamp}`;
const typeKey2 = `vtmpl2_${stamp}`;

const db = getDb();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-templates-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-templates-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  // --- parseTemplateInput (now name + type on create; name/isDefault on patch) ---
  await throws("create rejects missing name", () => parseTemplateInput({ type: "task" }, "create"), "bad_request");
  await throws("create rejects missing type", () => parseTemplateInput({ name: "X" }, "create"), "bad_request");
  const created0 = parseTemplateInput({ type: "  task ", name: "  Weekly  " }, "create");
  check("create trims name + type", created0.type === "task" && created0.name === "Weekly");
  const patch0 = parseTemplateInput({ name: "Renamed" }, "patch");
  check("patch parses name only", !("type" in patch0) && patch0.name === "Renamed");
  const patchDef = parseTemplateInput({ isDefault: true }, "patch");
  check("patch parses isDefault", patchDef.isDefault === true);
  await throws("patch rejects empty", () => parseTemplateInput({}, "patch"), "bad_request");
  await throws("patch rejects bad isDefault", () => parseTemplateInput({ isDefault: "yes" }, "patch"), "bad_request");

  // --- a real type to hang templates on ---
  await createType({ key: typeKey, label: "WF Candidate", icon: null, showInQuickCapture: true, capability: null, propertySchema: [
    { key: "stage", label: "Stage", kind: "select", options: ["Applied", "Interview", "Offer"] },
  ] });
  await throws("createTemplate rejects an unknown type", () =>
    createTemplate(owner.id, { type: `nope${stamp}`, name: "Bad" }), "bad_request");

  // --- create = registry row + hidden prototype item ---
  const t1 = await createTemplate(owner.id, { type: typeKey, name: "Standard candidate" });
  check("createTemplate returns a registry row", !!t1.id && t1.type === typeKey && t1.name === "Standard candidate");
  check("createTemplate has a prototype + default false", !!t1.prototypeItemId && t1.isDefault === false);
  const proto = await getItem(owner.id, t1.prototypeItemId);
  check("the prototype is a real hidden item", proto.isTemplate === true && proto.type === typeKey && proto.title === "Standard candidate");

  // --- author the prototype in the real canvas: body + property + subtask + relation ---
  await updateItem(owner.id, proto.id, {
    body: { format: "markdown", text: "## Notes\n\n- [ ] Schedule screen" },
    propertyPatch: { stage: "Applied" },
  });
  const alice = await createItem(owner.id, { type: "person", title: "Alice" });
  await relateItems(owner.id, proto.id, alice.id);
  const sub = await createItem(owner.id, { type: typeKey, title: "Subtask one", parentId: proto.id });
  check("a child of a prototype inherits is_template (subtree invariant)", sub.isTemplate === true);

  // --- EXCLUSION net: prototype + subtask absent from every owner-scoped surface ---
  const listed = await listItems(owner.id, { type: typeKey });
  check("listItems excludes the prototype + subtask", !listed.some((i) => i.id === proto.id || i.id === sub.id));
  const searchedProto = await searchItems(owner.id, "candidate");
  check("search excludes the prototype", !searchedProto.some((r) => r.id === proto.id));
  const searchedSub = await searchItems(owner.id, "Subtask");
  check("search excludes a template subtask", !searchedSub.some((r) => r.id === sub.id));
  const viewed = await queryViewItems(owner.id, { type: typeKey }, { field: "updatedAt", dir: "desc" });
  check("the view engine excludes prototype + subtask", !viewed.some((i) => i.id === proto.id || i.id === sub.id));
  const today = await getTodayData(owner.id);
  check("Today (recent) excludes prototype + subtask", !today.recent.some((i) => i.id === proto.id || i.id === sub.id));
  const countsPre = await itemCountsByType(owner.id);
  check("Build type counts exclude templates (none real yet)", countsPre[typeKey] === undefined);
  const aliceRelated = await listRelatedItems(owner.id, alice.id);
  check("a prototype never shows as a related item", !aliceRelated.some((r) => r.id === proto.id));

  // --- KEEP-VISIBLE: the prototype's OWN related panel shows its (non-template) links ---
  const protoRelated = await listRelatedItems(owner.id, proto.id);
  check("the prototype's Related panel still shows its links (authoring)", protoRelated.some((r) => r.id === alice.id));

  // --- APPLY = cloneItemSubtree → fresh REAL items ---
  const applied = await createItemFromTemplate(owner.id, t1.id);
  check("apply makes a new item (not the prototype)", applied.id !== proto.id && applied.type === typeKey);
  check("apply is filed, not Inboxed", applied.inbox === false);
  check("apply copies the prototype title", applied.title === "Standard candidate");
  check("apply carries the body", (applied.body as { text?: string } | null)?.text?.includes("Schedule screen") === true);
  check("apply carries property values", (applied.properties as { stage?: string } | null)?.stage === "Applied");
  const appliedFull = await getItem(owner.id, applied.id);
  check("the applied item is REAL (is_template false)", appliedFull.isTemplate === false);
  const appliedChildren = await db
    .select({ id: items.id, title: items.title, isTemplate: items.isTemplate })
    .from(items)
    .where(and(eq(items.parentId, applied.id), eq(items.ownerId, owner.id)));
  check("apply cloned the subtask as a real child", appliedChildren.length === 1 && appliedChildren[0].title === "Subtask one" && appliedChildren[0].isTemplate === false);
  const appliedRelated = await listRelatedItems(owner.id, applied.id);
  check("apply carried the relation edge", appliedRelated.some((r) => r.id === alice.id));
  const listedAfter = await listItems(owner.id, { type: typeKey });
  check("the applied item DOES appear in lists", listedAfter.some((i) => i.id === applied.id));
  const countsPost = await itemCountsByType(owner.id);
  check("Build type counts include applied real items only", countsPost[typeKey] === 2);

  // --- registry CRUD + owner scoping ---
  const fetched = await getTemplate(owner.id, t1.id);
  check("getTemplate round-trips", fetched.id === t1.id && fetched.prototypeItemId === t1.prototypeItemId);
  await throws("getTemplate is owner-scoped", () => getTemplate(other.id, t1.id), "not_found");
  const t2 = await createTemplate(owner.id, { type: typeKey, name: "Referral" });
  const list = await listTemplates(owner.id, typeKey);
  check("listTemplates returns both for the type", list.length === 2 && list.every((t) => t.type === typeKey));
  check("listTemplates is owner-scoped", (await listTemplates(other.id)).length === 0);
  const renamed = await updateTemplate(owner.id, t1.id, { name: "Senior candidate" });
  check("updateTemplate renames", renamed.name === "Senior candidate");
  await throws("updateTemplate is owner-scoped", () => updateTemplate(other.id, t1.id, { name: "Hijack" }), "not_found");
  check("templateCountsByType counts per type", (await templateCountsByType(owner.id))[typeKey] === 2);

  // --- default flag: setting one clears the other (partial unique index) ---
  await updateTemplate(owner.id, t1.id, { isDefault: true });
  await updateTemplate(owner.id, t2.id, { isDefault: true });
  check("setting a new default clears the prior one", (await getTemplate(owner.id, t1.id)).isDefault === false && (await getTemplate(owner.id, t2.id)).isDefault === true);
  const defaults = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.ownerId, owner.id), eq(templates.type, typeKey), eq(templates.isDefault, true)));
  check("at most one default per type", defaults.length === 1);

  // --- delete = drop registry row + soft-delete prototype ---
  const t2proto = t2.prototypeItemId;
  await deleteTemplate(owner.id, t2.id);
  await throws("deleted template is gone from the registry", () => getTemplate(owner.id, t2.id), "not_found");
  const t2protoRow = await db.select({ deletedAt: items.deletedAt }).from(items).where(eq(items.id, t2proto));
  check("delete soft-deletes the prototype", t2protoRow.length === 1 && t2protoRow[0].deletedAt !== null);
  await throws("deleteTemplate is owner-scoped", () => deleteTemplate(other.id, t1.id), "not_found");

  // --- prototype cascade: hard-deleting the prototype drops the registry row ---
  const t3 = await createTemplate(owner.id, { type: typeKey, name: "Cascade" });
  await db.delete(items).where(eq(items.id, t3.prototypeItemId));
  const t3row = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, t3.id));
  check("hard-deleting the prototype cascades its registry row", t3row.length === 0);

  // --- FK safety: a prototype counts as a live item, so deleteType is blocked ---
  await createType({ key: typeKey2, label: "Cascade Type", icon: null, showInQuickCapture: true, capability: null, propertySchema: [] });
  await createTemplate(owner.id, { type: typeKey2, name: "Only template" });
  check("a prototype counts toward the type's live items", (await countLiveItemsOfType(typeKey2)) === 1);
  await throws("deleteType is blocked while a template prototype lives (FK safety)", () => deleteType(typeKey2), "bad_request");
} finally {
  // Deleting items cascades the templates rows (prototype_item_id FK) + relations.
  await db.delete(items).where(inArray(items.ownerId, [owner.id, other.id]));
  await db.delete(templates).where(inArray(templates.ownerId, [owner.id, other.id]));
  await db.delete(types).where(inArray(types.key, [typeKey, typeKey2]));
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

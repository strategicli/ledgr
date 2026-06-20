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
  getTemplateByPrototype,
  listTemplates,
  listTemplatesForPicker,
  updateTemplate,
  deleteTemplate,
  createItemFromTemplate,
  createTemplateFromItem,
  duplicateTemplate,
  applyTemplateToExisting,
  templateAskLabels,
  templateCountsByType,
} = await import("../src/lib/templates");
const { cloneItemSubtree } = await import("../src/lib/clone");
const { bodyMarkdown } = await import("../src/lib/body");
const { dateToYmdUtc } = await import("../src/lib/recurrence");
const { createType, deleteType, countLiveItemsOfType } = await import("../src/lib/types");
const { ItemError, createItem, getItem, listItems, itemCountsByType, updateItem, softDeleteItem } =
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

  // --- TPL2: clone-as-template, save-as-template, duplicate, lookup ---
  const realItem = await createItem(owner.id, {
    type: typeKey,
    title: "Real candidate",
    body: { format: "markdown", text: "## Real\n\n- [ ] do it" },
    properties: { stage: "Offer" },
  });
  const realSub = await createItem(owner.id, { type: typeKey, title: "Real subtask", parentId: realItem.id });
  await relateItems(owner.id, realItem.id, alice.id);
  check("sanity: a normal item + subtask are not templates", realItem.isTemplate === false && realSub.isTemplate === false);

  // cloneItemSubtree({isTemplate}) marks the whole clone as template content.
  const cloned = await cloneItemSubtree(owner.id, realItem.id, { isTemplate: true, inbox: false });
  const clonedRoot = await getItem(owner.id, cloned.rootId);
  const clonedKids = await db
    .select({ isTemplate: items.isTemplate })
    .from(items)
    .where(and(eq(items.parentId, cloned.rootId), eq(items.ownerId, owner.id)));
  check("clone isTemplate marks the root + subtree", clonedRoot.isTemplate === true && clonedKids.length === 1 && clonedKids[0].isTemplate === true);
  check("clone-as-template leaves the source real", (await getItem(owner.id, realItem.id)).isTemplate === false);

  // createTemplateFromItem = "Save as template"
  const saved = await createTemplateFromItem(owner.id, realItem.id, "From real");
  check("save-as-template registers a template of the item's type", saved.type === typeKey && saved.name === "From real" && saved.isDefault === false);
  const savedProto = await getItem(owner.id, saved.prototypeItemId);
  check("save-as-template prototype is a template carrying the body", savedProto.isTemplate === true && (savedProto.body as { text?: string } | null)?.text?.includes("do it") === true);
  const savedKids = await db
    .select({ id: items.id, isTemplate: items.isTemplate })
    .from(items)
    .where(and(eq(items.parentId, saved.prototypeItemId), eq(items.ownerId, owner.id)));
  check("save-as-template cloned the subtask as template content", savedKids.length === 1 && savedKids[0].isTemplate === true);
  check("save-as-template carried the relation edge", (await listRelatedItems(owner.id, saved.prototypeItemId)).some((r) => r.id === alice.id));
  const listAfterSave = await listItems(owner.id, { type: typeKey });
  check("save-as-template prototype is excluded from lists", !listAfterSave.some((i) => i.id === saved.prototypeItemId));
  check("the source item still appears in lists", listAfterSave.some((i) => i.id === realItem.id));
  check("applying a saved template yields a real item", (await getItem(owner.id, (await createItemFromTemplate(owner.id, saved.id)).id)).isTemplate === false);
  await throws("save-as-template rejects a template", () => createTemplateFromItem(owner.id, saved.prototypeItemId), "bad_request");
  const trashed = await createItem(owner.id, { type: typeKey, title: "Trash me" });
  await softDeleteItem(owner.id, trashed.id);
  await throws("save-as-template rejects a trashed item", () => createTemplateFromItem(owner.id, trashed.id), "bad_request");
  await throws("createTemplateFromItem is owner-scoped", () => createTemplateFromItem(other.id, realItem.id), "not_found");

  // duplicateTemplate
  const dup = await duplicateTemplate(owner.id, saved.id);
  check("duplicate makes a new non-default template named Copy of", dup.id !== saved.id && dup.name === "Copy of From real" && dup.isDefault === false);
  check("duplicate prototype is a fresh template", (await getItem(owner.id, dup.prototypeItemId)).isTemplate === true && dup.prototypeItemId !== saved.prototypeItemId);
  check("duplicate cloned the subtree", (await db.select({ id: items.id }).from(items).where(and(eq(items.parentId, dup.prototypeItemId), eq(items.ownerId, owner.id)))).length === 1);
  await throws("duplicateTemplate is owner-scoped", () => duplicateTemplate(other.id, saved.id), "not_found");

  // getTemplateByPrototype
  check("getTemplateByPrototype finds the row by prototype id", (await getTemplateByPrototype(owner.id, saved.prototypeItemId))?.id === saved.id);
  check("getTemplateByPrototype is null for a real item", (await getTemplateByPrototype(owner.id, realItem.id)) === null);
  check("getTemplateByPrototype is null for a template subtask", (await getTemplateByPrototype(owner.id, savedKids[0].id)) === null);
  check("getTemplateByPrototype is owner-scoped", (await getTemplateByPrototype(other.id, saved.prototypeItemId)) === null);

  // --- TPL3: variable resolution on apply ---
  const vtmpl = await createTemplate(owner.id, { type: typeKey, name: "Var template" });
  await updateItem(owner.id, vtmpl.prototypeItemId, {
    title: "Review for {{nextSunday:short}}",
    body: { format: "markdown", text: "Topic: {{ask:Topic}}\nDue {{today+3d:iso}}\nRe: {{title}}" },
  });
  await createItem(owner.id, { type: typeKey, title: "Prep {{ask:Topic}}", parentId: vtmpl.prototypeItemId });
  check("templateAskLabels scans titles + bodies across the subtree", JSON.stringify(await templateAskLabels(owner.id, vtmpl.id)) === JSON.stringify(["Topic"]));
  // Saturday 2026-06-20 → next Sunday = Jun 28; +3d = 2026-06-23.
  const vapplied = await createItemFromTemplate(owner.id, vtmpl.id, {
    now: new Date("2026-06-20T12:00:00Z"),
    answers: { Topic: "Prayer" },
  });
  const vappliedFull = await getItem(owner.id, vapplied.id);
  const vappliedBody = bodyMarkdown(vappliedFull.body);
  check("apply resolves a date token in the title", vappliedFull.title === "Review for Jun 28");
  check("apply resolves {{ask}} in the body", vappliedBody.includes("Topic: Prayer"));
  check("apply resolves a date offset in the body", vappliedBody.includes("Due 2026-06-23"));
  check("apply resolves {{title}} echo to the RESOLVED title", vappliedBody.includes("Re: Review for Jun 28"));
  const vappliedKids = await db
    .select({ title: items.title, isTemplate: items.isTemplate })
    .from(items)
    .where(and(eq(items.parentId, vapplied.id), eq(items.ownerId, owner.id)));
  check("apply resolves tokens in a subtask + it's a real item", vappliedKids.length === 1 && vappliedKids[0].title === "Prep Prayer" && vappliedKids[0].isTemplate === false);
  check("the prototype keeps its tokens (only the clone is resolved)", (await getItem(owner.id, vtmpl.prototypeItemId)).title === "Review for {{nextSunday:short}}");
  check("an unanswered {{ask}} resolves to empty", bodyMarkdown((await getItem(owner.id, (await createItemFromTemplate(owner.id, vtmpl.id, { now: new Date("2026-06-20T12:00:00Z") })).id)).body).includes("Topic: \n"));

  // --- TPL3b: structured due/scheduled date rules ---
  const dtmpl = await createTemplate(owner.id, { type: typeKey, name: "Dated template" });
  check("a new template starts with no apply rules", JSON.stringify(dtmpl.applyConfig) === "{}");
  const dUpdated = await updateTemplate(owner.id, dtmpl.id, {
    applyConfig: { scheduledDate: { mode: "offset", days: 2 }, dueDate: { mode: "fixed", date: "2026-12-25" } },
  });
  check("updateTemplate persists apply_config", dUpdated.applyConfig.scheduledDate?.mode === "offset" && dUpdated.applyConfig.dueDate?.mode === "fixed");
  check("getTemplate round-trips apply_config", (await getTemplate(owner.id, dtmpl.id)).applyConfig.scheduledDate?.mode === "offset");
  // A relative subtask on the prototype recomputes off the applied scheduled date.
  await createItem(owner.id, {
    type: typeKey,
    title: "Rel sub",
    parentId: dtmpl.prototypeItemId,
    properties: { relativeSchedule: { offsetDays: 1 } },
  });
  const dApplied = await getItem(owner.id, (await createItemFromTemplate(owner.id, dtmpl.id, { now: new Date("2026-06-20T12:00:00Z") })).id);
  check("apply offset rule sets scheduled = apply+2", !!dApplied.scheduledDate && dateToYmdUtc(dApplied.scheduledDate) === "2026-06-22");
  check("apply fixed rule sets due", !!dApplied.dueDate && dateToYmdUtc(dApplied.dueDate) === "2026-12-25");
  const dKids = await db
    .select({ sched: items.scheduledDate })
    .from(items)
    .where(and(eq(items.parentId, dApplied.id), eq(items.ownerId, owner.id)));
  check("relative subtask recomputes off the applied scheduled date (apply+2+1)", dKids.length === 1 && !!dKids[0].sched && dateToYmdUtc(dKids[0].sched!) === "2026-06-23");
  const noRules = await createTemplate(owner.id, { type: typeKey, name: "No-date template" });
  const noRulesApplied = await getItem(owner.id, (await createItemFromTemplate(owner.id, noRules.id, { now: new Date("2026-06-20T12:00:00Z") })).id);
  check("no rules → applied item has no dates", noRulesApplied.scheduledDate === null && noRulesApplied.dueDate === null);

  // --- TPL4a: the "+ New" picker (default-first + preview) ---
  // vtmpl (from the TPL3 block) has 1 subtask + a starter body; make it default.
  await updateTemplate(owner.id, vtmpl.id, { isDefault: true });
  const picker = await listTemplatesForPicker(owner.id, typeKey);
  check("picker lists the type's templates", picker.length >= 1);
  check("picker puts the default first", picker[0].id === vtmpl.id && picker[0].isDefault === true);
  check("only one picker entry is the default", picker.filter((p) => p.isDefault).length === 1);
  const vEntry = picker.find((p) => p.id === vtmpl.id);
  check("picker preview counts subtasks", vEntry?.subtaskCount === 1);
  check("picker preview flags a starter body", vEntry?.hasBody === true);
  check("picker is owner-scoped", (await listTemplatesForPicker(other.id, typeKey)).length === 0);

  // --- TPL4b: apply-to-existing (fill-blanks + overwrite) ---
  const APPLY_NOW = new Date("2026-06-20T12:00:00Z"); // today+1d=06-21, +2d=06-22
  const mtmpl = await createTemplate(owner.id, { type: typeKey, name: "Merge template" });
  await updateItem(owner.id, mtmpl.prototypeItemId, {
    title: "Tmpl title",
    body: { format: "markdown", text: "Due {{today+1d:iso}} for {{title}}" },
    urgency: "high",
    properties: { stage: "Offer", round: "Phone" },
  });
  await updateTemplate(owner.id, mtmpl.id, { applyConfig: { scheduledDate: { mode: "offset", days: 2 } } });
  await createItem(owner.id, { type: typeKey, title: "Shared sub", parentId: mtmpl.prototypeItemId });
  await createItem(owner.id, { type: typeKey, title: "Plan {{today+1d:iso}}", parentId: mtmpl.prototypeItemId });
  await relateItems(owner.id, mtmpl.prototypeItemId, alice.id);

  // Fill-blanks target: started, with its own title/body/props/subtasks.
  const tgtA = await createItem(owner.id, {
    type: typeKey,
    title: "Existing title",
    body: { format: "markdown", text: "Existing body" },
    properties: { stage: "Applied", other: "keep" },
  });
  await createItem(owner.id, { type: typeKey, title: "Shared sub", parentId: tgtA.id });
  await createItem(owner.id, { type: typeKey, title: "Existing-only sub", parentId: tgtA.id });
  await applyTemplateToExisting(owner.id, mtmpl.id, tgtA.id, { mode: "fill", now: APPLY_NOW });
  const fa = await getItem(owner.id, tgtA.id);
  const faProps = fa.properties as Record<string, unknown>;
  check("fill keeps a non-empty title", fa.title === "Existing title");
  check("fill skips a non-empty body", bodyMarkdown(fa.body) === "Existing body");
  check("fill sets an empty scalar (urgency)", fa.urgency === "high");
  check("fill keeps the target's own property value", faProps.stage === "Applied");
  check("fill adds a missing property", faProps.round === "Phone");
  check("fill preserves a target-only property", faProps.other === "keep");
  check("fill sets an empty date from the rule (today+2)", !!fa.scheduledDate && dateToYmdUtc(fa.scheduledDate) === "2026-06-22");
  const faKids = await db.select({ title: items.title }).from(items).where(and(eq(items.parentId, tgtA.id), eq(items.ownerId, owner.id)));
  const faTitles = faKids.map((k) => k.title).sort();
  check("fill adds the missing subtask (token-resolved), dedupes the shared one", faKids.length === 3 && faTitles.includes("Plan 2026-06-21") && faTitles.filter((t) => t === "Shared sub").length === 1);
  check("fill adds the template's relation", (await listRelatedItems(owner.id, tgtA.id)).some((r) => r.id === alice.id));

  // Overwrite target.
  const tgtB = await createItem(owner.id, {
    type: typeKey,
    title: "Old title",
    body: { format: "markdown", text: "Old body" },
    urgency: "low",
    properties: { stage: "Applied", other: "keep" },
  });
  await createItem(owner.id, { type: typeKey, title: "Existing-only sub", parentId: tgtB.id });
  await applyTemplateToExisting(owner.id, mtmpl.id, tgtB.id, { mode: "overwrite", now: APPLY_NOW });
  const ob = await getItem(owner.id, tgtB.id);
  const obProps = ob.properties as Record<string, unknown>;
  check("overwrite replaces the title", ob.title === "Tmpl title");
  check("overwrite replaces the body with {{title}} echoing the new title", bodyMarkdown(ob.body) === "Due 2026-06-21 for Tmpl title");
  check("overwrite overrides a shared property", obProps.stage === "Offer");
  check("overwrite preserves a target-only property", obProps.other === "keep");
  const obKids = await db.select({ title: items.title }).from(items).where(and(eq(items.parentId, tgtB.id), eq(items.ownerId, owner.id)));
  check("overwrite ADDS template subtasks without deleting the target's", obKids.length === 3 && obKids.some((k) => k.title === "Existing-only sub") && obKids.some((k) => k.title === "Shared sub"));

  // Guards.
  await throws("apply-to-existing rejects a template target", () => applyTemplateToExisting(owner.id, mtmpl.id, mtmpl.prototypeItemId), "bad_request");
  const otherType = `vtmpl_other_${stamp}`;
  await createType({ key: otherType, label: "VOther", icon: null, showInQuickCapture: true, capability: null, propertySchema: [] });
  const wrongTypeItem = await createItem(owner.id, { type: otherType, title: "wrong type" });
  await throws("apply-to-existing rejects a type mismatch", () => applyTemplateToExisting(owner.id, mtmpl.id, wrongTypeItem.id), "bad_request");
  await throws("apply-to-existing is owner-scoped (template)", () => applyTemplateToExisting(other.id, mtmpl.id, tgtA.id), "not_found");
  const tgtTrash = await createItem(owner.id, { type: typeKey, title: "trash target" });
  await softDeleteItem(owner.id, tgtTrash.id);
  await throws("apply-to-existing rejects a trashed target", () => applyTemplateToExisting(owner.id, mtmpl.id, tgtTrash.id), "bad_request");

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

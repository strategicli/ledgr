// Slice 34 verification: per-type item templates — parse/validate, the
// owner-scoped CRUD store, apply-as-item (body + property defaults seeded,
// inbox stays false), and the type-cascade. Against live Neon. Owner-scoped, so
// the script creates throwaway users + a throwaway type and cleans up in
// finally. Run: npx tsx scripts/verify-templates.mts
// Safe to delete once the slice is closed.
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
const { createType } = await import("../src/lib/types");
const { ItemError } = await import("../src/lib/items");
const { eq, inArray } = await import("drizzle-orm");

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
const typeKey = `vtmpl${stamp}`; // a throwaway custom type to hang templates on
const typeKey2 = `vtmpl2_${stamp}`; // a second, for the cascade test

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
  // --- parseTemplateInput ---
  await throws("rejects missing name", () => parseTemplateInput({ type: "task" }, "create"), "bad_request");
  await throws("rejects missing type on create", () => parseTemplateInput({ name: "X" }, "create"), "bad_request");
  await throws("rejects array propertyDefaults", () =>
    parseTemplateInput({ type: "task", name: "X", propertyDefaults: [] }, "create"), "bad_request");
  await throws("rejects a bad body shape", () =>
    parseTemplateInput({ type: "task", name: "X", body: 42 }, "create"), "bad_request");

  const fromString = parseTemplateInput({ type: "task", name: "  Weekly  ", body: "- [ ] item" }, "create");
  check("trims the name", fromString.name === "Weekly");
  check("wraps a markdown string into a body", fromString.body?.format === "markdown" && fromString.body?.text === "- [ ] item");
  check("empty body becomes null", parseTemplateInput({ type: "task", name: "X", body: "   " }, "create").body === null);
  const withDefaults = parseTemplateInput(
    { type: "task", name: "X", propertyDefaults: { stage: "Applied", empty: "", gone: null, n: 0 } },
    "create"
  );
  check("drops null/empty defaults, keeps real values", JSON.stringify(withDefaults.propertyDefaults) === JSON.stringify({ stage: "Applied", n: 0 }));
  const patch = parseTemplateInput({ name: "Renamed" }, "patch");
  check("patch parses without a type", !("type" in patch) && patch.name === "Renamed");

  // --- store CRUD (needs a real type) ---
  await createType({ key: typeKey, label: "WF Candidate", icon: null, showInQuickCapture: true, propertySchema: [
    { key: "stage", label: "Stage", kind: "select", options: ["Applied", "Interview", "Offer"] },
  ] });

  await throws("createTemplate rejects an unknown type", () =>
    createTemplate(owner.id, { type: `nope${stamp}`, name: "Bad", body: null, propertyDefaults: {} }), "bad_request");

  const t1 = await createTemplate(owner.id, {
    type: typeKey,
    name: "Standard candidate",
    body: { format: "markdown", text: "## Notes\n\n- [ ] Schedule screen" },
    propertyDefaults: { stage: "Applied" },
  });
  check("createTemplate returns the row", !!t1.id && t1.type === typeKey && t1.name === "Standard candidate");
  check("createTemplate stored the body + defaults", t1.body?.text.includes("Schedule screen") === true && t1.propertyDefaults.stage === "Applied");

  const fetched = await getTemplate(owner.id, t1.id);
  check("getTemplate round-trips", fetched.id === t1.id && fetched.name === "Standard candidate");
  await throws("getTemplate is owner-scoped", () => getTemplate(other.id, t1.id), "not_found");

  const t2 = await createTemplate(owner.id, { type: typeKey, name: "Referral", body: null, propertyDefaults: {} });
  const list = await listTemplates(owner.id, typeKey);
  check("listTemplates returns both for the type", list.length === 2 && list.every((t) => t.type === typeKey));
  check("listTemplates is owner-scoped", (await listTemplates(other.id)).length === 0);

  const updated = await updateTemplate(owner.id, t1.id, {
    name: "Senior candidate",
    body: { format: "markdown", text: "## Senior" },
    propertyDefaults: { stage: "Interview" },
  });
  check("updateTemplate changed name + defaults", updated.name === "Senior candidate" && updated.propertyDefaults.stage === "Interview");
  await throws("updateTemplate is owner-scoped", () =>
    updateTemplate(other.id, t1.id, { name: "Hijack", body: null, propertyDefaults: {} }), "not_found");

  const counts = await templateCountsByType(owner.id);
  check("templateCountsByType counts per type", counts[typeKey] === 2);

  // --- apply: create an item from a template ---
  const created = await createItemFromTemplate(owner.id, t1.id);
  check("apply sets the type", created.type === typeKey);
  check("apply seeds the body", (created.body as { text?: string } | null)?.text === "## Senior");
  check("apply seeds property defaults", (created.properties as { stage?: string } | null)?.stage === "Interview");
  check("apply does not land in the Inbox", created.inbox === false);
  check("apply leaves the title blank", created.title === "");

  // apply a body-less, default-less template → a blank item of the type
  const blankish = await createItemFromTemplate(owner.id, t2.id);
  check("apply of an empty template still makes a typed item", blankish.type === typeKey && blankish.body == null);

  // --- delete ---
  await deleteTemplate(owner.id, t2.id);
  await throws("deleted template is gone", () => getTemplate(owner.id, t2.id), "not_found");
  await throws("deleteTemplate is owner-scoped", () => deleteTemplate(other.id, t1.id), "not_found");

  // --- type cascade: deleting the type drops its templates ---
  await createType({ key: typeKey2, label: "Cascade Type", icon: null, showInQuickCapture: true, propertySchema: [] });
  const tc = await createTemplate(owner.id, { type: typeKey2, name: "doomed", body: null, propertyDefaults: {} });
  await db.delete(types).where(eq(types.key, typeKey2)); // raw delete to exercise the FK cascade
  const after = await db.select().from(templates).where(eq(templates.id, tc.id));
  check("template cascades away with its type", after.length === 0);
} finally {
  // items + templates FK to users/types; clear items, templates, types, then users.
  await db.delete(items).where(inArray(items.ownerId, [owner.id, other.id]));
  await db.delete(templates).where(inArray(templates.ownerId, [owner.id, other.id]));
  await db.delete(types).where(inArray(types.key, [typeKey, typeKey2]));
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

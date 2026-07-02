// Verification for the nav-customization slice (ADR-056) + the type-delete
// cascade. Two halves:
//   1. Pure logic (no DB): the nav icon library, settings.parseSettings nav-slot
//      validation, and the nav-slot destination options.
//   2. Live Neon: deleteTypeWithItems removes a type AND its items + descendants
//      (relations/revisions cascade), while plain deleteType still blocks an
//      in-use type. Creates a temp type + items under the existing owner and
//      cleans them up in finally.
// Run: npx tsx scripts/verify-nav-and-deletes.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- 1. Pure: nav icons ----------------------------------------------------
const { NAV_ICONS, navIconPaths, isNavIcon, NAV_ICON_FALLBACK } = await import(
  "../src/lib/nav-icons"
);
check("isNavIcon true for a known key", isNavIcon("inbox"));
check("isNavIcon false for an unknown key", !isNavIcon("not_a_real_icon"));
check("isNavIcon false for non-string", !isNavIcon(42));
check(
  "navIconPaths returns the real paths for a known key",
  navIconPaths("tasks") === NAV_ICONS.tasks
);
check(
  "navIconPaths falls back for an unknown key",
  navIconPaths("zzz") === NAV_ICONS[NAV_ICON_FALLBACK]
);

// --- 1. Pure: settings.parseSettings nav slots -----------------------------
const {
  parseSettings,
  DEFAULT_NAV_SLOTS,
  NAV_SLOTS_HARD_CAP,
  MAX_TOOLS_CHILDREN,
  HIGHLIGHT_GRADIENTS,
} = await import("../src/lib/settings");

const base = parseSettings({});
check("empty settings yield the default nav slots", base.navSlots.length === DEFAULT_NAV_SLOTS.length && base.navSlots[0].type === "destination" && (base.navSlots[0] as { href: string }).href === "/inbox");
check("empty settings mirror mobile (null)", base.mobileNavSlots === null);

// Accent: gradient round-trip + its representative solid, and rejection of junk.
check("default accent has no gradient", base.highlightGradient === null);
const grad = HIGHLIGHT_GRADIENTS[0];
const gradParsed = parseSettings({ highlightColor: grad.accent, highlightGradient: grad.value });
check("a known gradient is kept", gradParsed.highlightGradient === grad.value);
check("a gradient's representative accent is kept as the solid", gradParsed.highlightColor === grad.accent);
check("an unknown gradient is dropped to null", parseSettings({ highlightGradient: "linear-gradient(1deg, red, blue)" }).highlightGradient === null);
check("an unknown accent falls back to the default solid", parseSettings({ highlightColor: "#abcabc" }).highlightColor === base.highlightColor);
check(
  "garbage navSlots falls back to default",
  parseSettings({ navSlots: "nope" }).navSlots.length === DEFAULT_NAV_SLOTS.length
);

const dest = (over: Record<string, unknown> = {}) => ({
  type: "destination",
  kind: "builtin",
  href: "/tasks",
  label: "Tasks",
  icon: "tasks",
  ...over,
});

const many = parseSettings({ navSlots: Array.from({ length: 8 }, () => dest()) });
check("desktop slots are not hard-capped at the recommended count (8 kept)", many.navSlots.length === 8);

const overHard = parseSettings({ navSlots: Array.from({ length: NAV_SLOTS_HARD_CAP + 5 }, () => dest()) });
check(`desktop slots are bounded by the hard cap (${NAV_SLOTS_HARD_CAP})`, overHard.navSlots.length === NAV_SLOTS_HARD_CAP);

const homeStripped = parseSettings({ navSlots: [dest({ href: "/" }), dest()] });
check("a slot pointing at Home ('/') is stripped", homeStripped.navSlots.length === 1);

const badIcon = parseSettings({ navSlots: [dest({ icon: "totally_made_up" })] });
check(
  "an unknown icon falls back to 'items'",
  (badIcon.navSlots[0] as { icon: string }).icon === "items"
);

const dropped = parseSettings({ navSlots: [dest(), { type: "destination" }, dest({ label: "" })] });
check("malformed slots (no href / no label) are dropped", dropped.navSlots.length === 1);

const badge = parseSettings({ navSlots: [dest({ href: "/inbox", badge: "inbox" }), dest({ badge: "nope" })] });
check("a valid inbox badge is kept", (badge.navSlots[0] as { badge?: string }).badge === "inbox");
check("an unknown badge is dropped", (badge.navSlots[1] as { badge?: string }).badge === undefined);

const tools = parseSettings({
  navSlots: [
    {
      type: "tools",
      label: "Library",
      icon: "folder",
      children: Array.from({ length: 10 }, () => dest()),
    },
  ],
});
check("a tools group is parsed", tools.navSlots[0]?.type === "tools");
check(
  `tools children cap at ${MAX_TOOLS_CHILDREN}`,
  (tools.navSlots[0] as { children: unknown[] }).children.length === MAX_TOOLS_CHILDREN
);

const emptyGroup = parseSettings({ navSlots: [{ type: "tools", label: "Empty", icon: "folder", children: [] }] });
check("an empty tools group is dropped", emptyGroup.navSlots.length === 0);

const nestedChild = parseSettings({
  navSlots: [
    {
      type: "tools",
      label: "G",
      icon: "folder",
      children: [{ type: "tools", href: "/tasks", label: "Nested", icon: "tasks", children: [dest()] }],
    },
  ],
});
const flatChild = (nestedChild.navSlots[0] as { children: Record<string, unknown>[] }).children[0];
check("a nested tools child is flattened to a destination", flatChild != null && !("children" in flatChild));

const mobileMany = parseSettings({ mobileNavSlots: Array.from({ length: 6 }, () => dest()) });
check("mobile slots are not hard-capped at the recommended count (6 kept)", mobileMany.mobileNavSlots?.length === 6);
check("explicit null mobileNavSlots stays null", parseSettings({ mobileNavSlots: null }).mobileNavSlots === null);

// --- 1. Pure: nav-slot destination options ---------------------------------
const { buildDestOptions, findDestOption } = await import("../src/lib/nav-slot-options");
const opts = buildDestOptions(
  [{ id: "v1", name: "My View" }],
  [
    { key: "song", label: "Song", icon: "song" },
    { key: "weird", label: "Weird", icon: "no_such_icon" },
  ]
);
// builtins + the Build-tools category (ADR-063) + 1 view + 2 types. Baseline
// comes from calling buildDestOptions with no views/types, not from summing
// BUILTIN_DESTS.length + BUILD_TOOL_DESTS.length directly — the function
// conditionally filters BUILTIN_DESTS (e.g. /notifications drops out while
// ADR-130's NOTIFICATION_CENTER_ENABLED is false), so a hardcoded sum drifts
// out of sync with the real filtered count whenever that condition changes.
const baselineOpts = buildDestOptions([], []);
check(
  "buildDestOptions includes builtins + build tools + 1 view + 2 types",
  opts.length === baselineOpts.length + 3
);
check("a view option maps to /views/<id>", !!findDestOption(opts, "/views/v1"));
check("a type option maps to /list/<key>", findDestOption(opts, "/list/song")?.icon === "song");
check("a type with an unknown icon falls back to 'items'", findDestOption(opts, "/list/weird")?.icon === "items");
check("Inbox is the badge-eligible builtin", findDestOption(opts, "/inbox")?.badgeEligible === true);
check("Tasks is not badge-eligible", findDestOption(opts, "/tasks")?.badgeEligible === false);

// --- 1. Pure: favorites validation + list ops ------------------------------
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "33333333-3333-3333-3333-333333333333";
const { FAVORITES_HARD_CAP } = await import("../src/lib/settings");
check("favorites default to empty", base.favorites.length === 0);
check(
  "favorites keep only well-formed uuids, in order",
  JSON.stringify(parseSettings({ favorites: [U1, "nope", U2] }).favorites) ===
    JSON.stringify([U1, U2])
);
check(
  "favorites dedupe (first wins)",
  JSON.stringify(parseSettings({ favorites: [U1, U2, U1] }).favorites) ===
    JSON.stringify([U1, U2])
);
check("garbage favorites fall back to empty", parseSettings({ favorites: "nope" }).favorites.length === 0);
check(
  "favorites are bounded by the hard cap",
  parseSettings({
    favorites: Array.from(
      { length: FAVORITES_HARD_CAP + 5 },
      (_, i) => `${(i % 10).toString().repeat(8)}-1111-1111-1111-111111111111`
    ),
  }).favorites.length <= FAVORITES_HARD_CAP
);

const { isFavorited, addFavorite, removeFavorite, applyReorder } = await import(
  "../src/lib/favorites"
);
check("isFavorited reflects membership", isFavorited([U1, U2], U2) && !isFavorited([U1], U2));
check("addFavorite appends a new id", JSON.stringify(addFavorite([U1], U2)) === JSON.stringify([U1, U2]));
check("addFavorite is a no-op for an existing id", JSON.stringify(addFavorite([U1, U2], U1)) === JSON.stringify([U1, U2]));
check("removeFavorite drops the id", JSON.stringify(removeFavorite([U1, U2], U1)) === JSON.stringify([U2]));
check(
  "applyReorder honors the requested order",
  JSON.stringify(applyReorder([U1, U2, U3], [U3, U1, U2])) === JSON.stringify([U3, U1, U2])
);
check(
  "applyReorder drops stale ids and keeps omitted favorites",
  JSON.stringify(applyReorder([U1, U2, U3], [U2, "99999999-9999-9999-9999-999999999999"])) ===
    JSON.stringify([U2, U1, U3])
);

// --- 2. Live Neon: type soft-delete + restore (ADR-058) --------------------
const { getDb } = await import("../src/db");
const { items, relations, types, users } = await import("../src/db/schema");
const { ItemError } = await import("../src/lib/items");
const {
  createItem,
  restoreItem,
} = await import("../src/lib/item-mutations");
const {
  createType,
  getType,
  listTypes,
  listDeletedTypes,
  countLiveItemsOfType,
  setTypeHidden,
  setTypeQuickCapture,
  deleteType,
  softDeleteTypeWithItems,
  restoreType,
} = await import("../src/lib/types");
const { relateItems } = await import("../src/lib/relations");
const { and, eq, inArray, isNull, or } = await import("drizzle-orm");

const db = getDb();
const TMP_KEY = "navverify_tmp_type";
const created: string[] = [];
let madeType = false;

try {
  const owners = await db.select({ id: users.id }).from(users);
  if (owners.length === 0) {
    check("an owner exists to run the DB checks", false, "no users row");
  } else {
    const ownerId = owners[0].id;

    // Clean any leftover from a prior aborted run.
    await db.delete(items).where(eq(items.type, TMP_KEY));
    await db.delete(types).where(eq(types.key, TMP_KEY));

    await createType({
      key: TMP_KEY,
      label: "Nav Verify Tmp",
      icon: null,
      propertySchema: [],
      showInQuickCapture: true,
      capability: null,
    });
    madeType = true;

    // A parent of the temp type, a same-type sibling, and a note child (a
    // descendant of a different type, to prove the parent-cascade reach).
    const parent = await createItem(ownerId, { type: TMP_KEY, title: "Tmp Parent" });
    const sibling = await createItem(ownerId, { type: TMP_KEY, title: "Tmp Sibling" });
    const child = await createItem(ownerId, { type: "note", title: "Tmp Child Note", parentId: parent.id });
    created.push(parent.id, sibling.id, child.id);
    await relateItems(ownerId, parent.id, sibling.id);

    check("two live items use the temp type", (await countLiveItemsOfType(TMP_KEY)) === 2);

    // Hidden flag (ADR-059): hides from listTypes() but stays via includeHidden.
    await setTypeHidden(TMP_KEY, true);
    check("a hidden type drops out of listTypes()", !(await listTypes()).some((t) => t.key === TMP_KEY));
    const withHidden = (await listTypes({ includeHidden: true })).find((t) => t.key === TMP_KEY);
    check("includeHidden surfaces it, flagged hidden", withHidden?.hidden === true);
    await setTypeHidden(TMP_KEY, false);
    check("un-hiding returns it to listTypes()", (await listTypes()).some((t) => t.key === TMP_KEY));

    // Quick-capture flag (the Build → Types column): a standalone setter.
    await setTypeQuickCapture(TMP_KEY, false);
    check("setTypeQuickCapture(false) clears the flag", (await getType(TMP_KEY)).showInQuickCapture === false);
    await setTypeQuickCapture(TMP_KEY, true);
    check("setTypeQuickCapture(true) sets the flag", (await getType(TMP_KEY)).showInQuickCapture === true);

    // Plain delete is blocked while live items reference the type.
    let blocked = false;
    try {
      await deleteType(TMP_KEY);
    } catch (err) {
      blocked = err instanceof ItemError && err.code === "bad_request";
    }
    check("plain deleteType is blocked for an in-use type", blocked);

    // Soft-delete takes the type's items + the note descendant to Trash.
    const { deletedItems } = await softDeleteTypeWithItems(ownerId, TMP_KEY);
    check("softDeleteTypeWithItems trashes the 2 type items + 1 descendant", deletedItems === 3);

    const live = await db
      .select({ id: items.id })
      .from(items)
      .where(and(inArray(items.id, created), isNull(items.deletedAt)));
    check("none of the items are live anymore (all in Trash)", live.length === 0);
    const stillThere = await db
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.id, created));
    check("the items still exist (soft-deleted, recoverable)", stillThere.length === 3);

    // Soft-delete keeps relations (no hard cascade) so a restore is whole.
    const relRows = await db
      .select({ id: relations.id })
      .from(relations)
      .where(or(eq(relations.sourceId, parent.id), eq(relations.targetId, parent.id)));
    check("the relation survives (not cascaded on soft-delete)", relRows.length === 1);

    check("the type is hidden from listTypes()", !(await listTypes()).some((t) => t.key === TMP_KEY));
    check("getType still resolves the soft-deleted type (for labels)", (await getType(TMP_KEY)).deletedAt !== null);
    const inTrash = (await listDeletedTypes()).find((t) => t.key === TMP_KEY);
    // The label counts the type's own trashed items (2); restoreType also brings
    // back the note descendant, so restoredItems below is 3.
    check("listDeletedTypes surfaces it with its item count", inTrash?.itemCount === 2);

    // Restore brings back the type + the 3 co-trashed items.
    const { restoredItems } = await restoreType(ownerId, TMP_KEY);
    check("restoreType restores the type + its 3 items", restoredItems === 3);
    check("the type is live again", (await getType(TMP_KEY)).deletedAt === null);
    check("its items are live again", (await db.select({ id: items.id }).from(items).where(and(inArray(items.id, created), isNull(items.deletedAt)))).length === 3);

    // Restoring a single item revives a soft-deleted type automatically.
    await softDeleteTypeWithItems(ownerId, TMP_KEY);
    await restoreItem(ownerId, parent.id);
    check("restoring one item auto-revives its soft-deleted type", (await getType(TMP_KEY)).deletedAt === null);

    // Can't create an item under a soft-deleted type.
    await softDeleteTypeWithItems(ownerId, TMP_KEY);
    let createBlocked = false;
    try {
      await createItem(ownerId, { type: TMP_KEY, title: "should fail" });
    } catch (err) {
      createBlocked = err instanceof ItemError && err.code === "bad_request";
    }
    check("creating an item under a soft-deleted type is rejected", createBlocked);
  }
} finally {
  // Hard-delete the temp scaffolding (verify cleanup only; the app soft-deletes).
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (madeType) await db.delete(types).where(eq(types.key, TMP_KEY));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

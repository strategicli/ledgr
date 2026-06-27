// Dashboard-canvas verification (ADR-111 + the nested widget): per-widget
// appearance parsing/defaults, the new widget kinds (tree/embed/container) and
// their backing requirements, one-level container nesting, the stage appearance
// parser (clamps + defaults), the batched tree child fetch from BOTH sources
// (parent_id hierarchy + relation role) with owner-scoping / body-free /
// hide-completed / type filter, and usedViewIds reaching into a container.
//   npx tsx scripts/verify-dashboard-canvas.mts   — safe to delete when closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { dashboards, items, relations, views, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const { createView, parseViewInput } = await import("../src/lib/views");
const {
  parseWidget,
  parseWidgets,
  parseDashboardAppearance,
  createDashboard,
  getDashboard,
  addWidget,
  usedViewIds,
  effectiveAppearance,
} = await import("../src/lib/dashboards");
const { childrenByParentId, childrenByRelation } = await import("../src/lib/dashboard-tree");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-canvas-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;
const [otherUser] = await db
  .insert(users)
  .values({ email: `verify-canvas-other-${Date.now()}@example.invalid` })
  .returning({ id: users.id });

try {
  const viewA = await createView(
    ownerId,
    parseViewInput({ name: "Projects", layout: "list", filter: { type: "project" } })
  );

  // 1. Per-widget appearance: absent → undefined; effective defaults differ by
  //    kind (card vs chrome-free text).
  const plainView = parseWidget({ kind: "view", viewId: viewA.id, settings: {}, layout: {} })!;
  check("view widget without appearance leaves it undefined", plainView.appearance === undefined);
  check(
    "effectiveAppearance: a view defaults to header+border on",
    effectiveAppearance(plainView).showHeader === true && effectiveAppearance(plainView).showBorder === true
  );
  const plainText = parseWidget({ kind: "text", settings: { heading: "Hi" }, layout: {} })!;
  check(
    "effectiveAppearance: text defaults chrome-free",
    effectiveAppearance(plainText).showHeader === false && effectiveAppearance(plainText).background === "transparent"
  );
  const styled = parseWidget({
    kind: "view",
    viewId: viewA.id,
    appearance: { showHeader: false, showBorder: false, background: "amber", accent: "blue", collapsible: true, collapsed: true },
    settings: {},
    layout: {},
  })!;
  check(
    "appearance round-trips all fields",
    styled.appearance?.showHeader === false &&
      styled.appearance?.background === "amber" &&
      styled.appearance?.accent === "blue" &&
      styled.appearance?.collapsible === true &&
      styled.appearance?.collapsed === true
  );
  const badAp = parseWidget({
    kind: "view",
    viewId: viewA.id,
    appearance: { background: "neon", accent: "rainbow" },
    settings: {},
    layout: {},
  })!;
  check(
    "appearance drops unknown background/accent to defaults",
    badAp.appearance?.background === "panel" && badAp.appearance?.accent === "none"
  );

  // 2. New kinds + backing requirements.
  check("tree requires a viewId", parseWidget({ kind: "tree", settings: {}, layout: {} }) === null);
  const tree = parseWidget({
    kind: "tree",
    viewId: viewA.id,
    settings: { childSource: "relation", relationRole: "project", childLimit: 99, hideCompletedChildren: false },
    layout: {},
  })!;
  check(
    "tree parses + clamps childLimit + keeps relation source",
    tree.kind === "tree" &&
      (tree.settings as { childSource: string }).childSource === "relation" &&
      (tree.settings as { relationRole: string }).relationRole === "project" &&
      (tree.settings as { childLimit: number }).childLimit === 50 &&
      (tree.settings as { hideCompletedChildren: boolean }).hideCompletedChildren === false
  );
  const treeDefaults = parseWidget({ kind: "tree", viewId: viewA.id, settings: {}, layout: {} })!
    .settings as { childSource: string; hideCompletedChildren: boolean; childLimit: number };
  check(
    "tree defaults childSource to children + hideCompleted on",
    treeDefaults.childSource === "children" && treeDefaults.hideCompletedChildren === true && treeDefaults.childLimit === 5
  );
  check("embed requires an itemId", parseWidget({ kind: "embed", settings: {}, layout: {} }) === null);
  const someId = crypto.randomUUID();
  const embed = parseWidget({ kind: "embed", itemId: someId, settings: { showBody: false }, layout: {} })!;
  check(
    "embed keeps itemId + showBody",
    embed.itemId === someId && (embed.settings as { showBody: boolean }).showBody === false
  );

  // image widget: url/alt/link kept, fit clamped, chrome-free by default.
  const image = parseWidget({
    kind: "image",
    settings: { url: "https://x/y.png", alt: "Quote", fit: "weird", link: "/notes" },
    layout: {},
  })!;
  const imgS = image.settings as { url: string; alt: string; fit: string; link: string | null };
  check(
    "image keeps url/alt/link + clamps fit to cover",
    imgS.url === "https://x/y.png" && imgS.alt === "Quote" && imgS.link === "/notes" && imgS.fit === "cover"
  );
  check(
    "image defaults chrome-free",
    effectiveAppearance(image).showHeader === false && effectiveAppearance(image).background === "transparent"
  );

  // 3. Container: one-level nesting (a nested container child is dropped).
  const container = parseWidget({
    kind: "container",
    settings: {
      mode: "tabs",
      activeTab: 9,
      title: "Group",
      children: [
        { kind: "view", viewId: viewA.id, settings: {}, layout: {} },
        { kind: "container", settings: { mode: "tabs", children: [] }, layout: {} }, // dropped
        { kind: "text", settings: { heading: "H" }, layout: {} },
      ],
    },
    layout: {},
  })!;
  const cs = container.settings as { children: unknown[]; activeTab: number; mode: string };
  check("container keeps non-container children, drops nesting", cs.children.length === 2);
  check("container clamps activeTab into range", cs.activeTab === 1, `activeTab=${cs.activeTab}`);

  // 4. Stage appearance parser: null, clamps, kind fallback.
  check("dashboard appearance null → null", parseDashboardAppearance(null) === null);
  const ap = parseDashboardAppearance({
    background: { kind: "image", value: "https://x/y.jpg", scrim: 5, blur: -2 },
    showTitle: false,
    density: "compact",
  })!;
  check(
    "stage clamps scrim/blur to 0..1 + keeps image",
    ap.background.kind === "image" && ap.background.scrim === 1 && ap.background.blur === 0 && ap.showTitle === false && ap.density === "compact"
  );
  const apBad = parseDashboardAppearance({ background: { kind: "bogus" }, density: "weird" })!;
  check("stage drops unknown kind/density to defaults", apBad.background.kind === "none" && apBad.density === "comfortable");

  // 5. Tree child fetch — parent_id hierarchy.
  const parent = await createItem(ownerId, { type: "note", title: "Parent note" });
  const childOpen = await createItem(ownerId, { type: "task", title: "open sub", status: "open", parentId: parent.id });
  const childDone = await createItem(ownerId, { type: "task", title: "done sub", status: "done", parentId: parent.id });
  await createItem(ownerId, { type: "note", title: "sub note", parentId: parent.id });

  const allKids = await childrenByParentId(ownerId, [parent.id]);
  check("parent_id fetch groups children under the parent", (allKids.get(parent.id)?.length ?? 0) === 3);
  check("child rows are body-free", !allKids.get(parent.id)!.some((r) => "body" in r));

  const liveKids = await childrenByParentId(ownerId, [parent.id], { hideCompleted: true });
  check(
    "hideCompleted drops the done child",
    (liveKids.get(parent.id)?.length ?? 0) === 2 && !liveKids.get(parent.id)!.some((r) => r.id === childDone.id)
  );
  const taskKids = await childrenByParentId(ownerId, [parent.id], { childType: "task" });
  check("childType filters to tasks only", (taskKids.get(parent.id)?.length ?? 0) === 2);
  const scoped = await childrenByParentId(otherUser.id, [parent.id]);
  check("childrenByParentId is owner-scoped", (scoped.get(parent.id)?.length ?? 0) === 0);
  void childOpen;

  // 6. Tree child fetch — relation role (task --project--> project).
  const project = await createItem(ownerId, { type: "project", title: "Launch" });
  const t1 = await createItem(ownerId, { type: "task", title: "task one", status: "open" });
  const t2 = await createItem(ownerId, { type: "task", title: "task two", status: "done" });
  await db.insert(relations).values([
    { sourceId: t1.id, targetId: project.id, role: "project", matchState: "confirmed" },
    { sourceId: t2.id, targetId: project.id, role: "project", matchState: "confirmed" },
  ]);
  const relKids = await childrenByRelation(ownerId, [project.id], "project");
  check("relation fetch returns the project's tasks (either direction)", (relKids.get(project.id)?.length ?? 0) === 2);
  const relLive = await childrenByRelation(ownerId, [project.id], "project", { hideCompleted: true });
  check("relation fetch honors hideCompleted", (relLive.get(project.id)?.length ?? 0) === 1);
  const relWrongRole = await childrenByRelation(ownerId, [project.id], "author");
  check("relation fetch filters by role", (relWrongRole.get(project.id)?.length ?? 0) === 0);

  // 7. usedViewIds reaches into a container child.
  const dash = await createDashboard(ownerId, { name: "Canvas", focusItemId: null, appearance: null, widgets: [] });
  await addWidget(ownerId, dash.id, container);
  const used = await usedViewIds(ownerId);
  check("usedViewIds counts a view nested in a container", used.has(viewA.id));

  // 8. parseWidgets still drops malformed widgets alongside the new kinds.
  const mixed = parseWidgets([
    { kind: "tree", viewId: viewA.id, settings: {}, layout: {} },
    { kind: "embed", settings: {}, layout: {} }, // no itemId → dropped
    { kind: "embed", itemId: crypto.randomUUID(), settings: {}, layout: {} },
    "junk",
  ]);
  check("parseWidgets keeps valid tree+embed, drops the rest", mixed.length === 2, `len=${mixed.length}`);

  const dashRead = await getDashboard(ownerId, dash.id);
  check("container persisted + read back", dashRead.widgets[0]?.kind === "container");
} finally {
  // relations FK is ON DELETE CASCADE, so deleting the owner's items clears the
  // edges too — no global relations delete (which would hit a shared dev DB).
  await db.delete(dashboards).where(eq(dashboards.ownerId, ownerId));
  await db.delete(views).where(eq(views.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(users).where(eq(users.id, otherUser.id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Live item tokens (LT1) verification. Part A: the PURE resolver (item-tokens.ts)
// — every token kind, date math/format, list formats (inline + block), escaping,
// unknown/apply-time passthrough. Part B: the DB context builder + the render
// helper against live Neon under throwaway owners — self/parent/children/related
// fields, owner-scoping, and that resolveItemBodyTokens rewrites title + body.
// Run: npx tsx scripts/verify-item-tokens.mts
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`}`);
}
function truthy(label: string, cond: boolean) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

// ===========================================================================
// Part A — pure resolver
// ===========================================================================
const {
  resolveItemTokens,
  hasItemTokens,
  scanItemTokens,
  findItemTokenRanges,
  isLiveTokenExpr,
} = await import("../src/lib/item-tokens");
const { filterTokenOptions, TOKEN_CATALOG } = await import(
  "../src/lib/editor/item-token-catalog"
);
type ItemTokenContext = import("../src/lib/item-tokens").ItemTokenContext;

const ID1 = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";
const IDP = "33333333-3333-3333-3333-333333333333";
const IDG = "44444444-4444-4444-4444-444444444444";

const ctx: ItemTokenContext = {
  todayYmd: "2026-06-20",
  self: {
    title: "Roger/Brandon check-in",
    status: "open",
    type: "Task",
    url: "https://x.test",
    priority: "P2",
    dates: { due: "2026-07-01", scheduled: "2026-06-25", created: "2026-06-20", meeting: null },
    props: { course: "OT501", due_date: "2026-07-10", note: "hi" },
  },
  parent: {
    title: "Parent Task",
    dates: { due: "2026-06-30" },
  },
  children: [
    { id: ID1, title: "Prep" },
    { id: ID2, title: "Send notes" },
  ],
  related: {
    person: [{ id: IDP, title: "Roger" }],
    assignee: [{ id: IDP, title: "Roger" }],
    attending: [{ id: IDP, title: "Roger" }, { id: ID1, title: "Kent" }],
    absent: [{ id: ID2, title: "Noah" }],
    group: [{ id: IDG, title: "Pastors" }],
  },
};
const r = (t: string) => resolveItemTokens(t, ctx);

// scalar fields
eq("item.title", r("{{item.title}}"), "Roger/Brandon check-in");
eq("item.status", r("{{item.status}}"), "open");
eq("item.type", r("{{item.type}}"), "Task");
eq("item.url", r("{{item.url}}"), "https://x.test");
eq("item.priority", r("{{item.priority}}"), "P2");

// dates + formats
eq("item.due default", r("{{item.due}}"), "Jul 1, 2026");
eq("item.due:iso", r("{{item.due:iso}}"), "2026-07-01");
eq("item.due:long", r("{{item.due:long}}"), "July 1, 2026");
eq("item.due:us", r("{{item.due:us}}"), "7/1/2026");
eq("item.scheduled+7d", r("{{item.scheduled+7d}}"), "Jul 2, 2026");
eq("item.scheduled-2d:iso", r("{{item.scheduled-2d:iso}}"), "2026-06-23");
eq("item.created", r("{{item.created}}"), "Jun 20, 2026");
eq("unset date (meeting) → empty", r("[{{item.meeting}}]"), "[]");

// properties (date + plain)
eq("item.props.course", r("{{item.props.course}}"), "OT501");
eq("item.props.due_date:long", r("{{item.props.due_date:long}}"), "July 10, 2026");
eq("item.props.due_date-1d", r("{{item.props.due_date-1d}}"), "Jul 9, 2026");
eq("non-date prop ignores format", r("{{item.props.note:long}}"), "hi");
eq("missing prop → empty", r("[{{item.props.nope}}]"), "[]");

// parent
eq("parent.title", r("{{parent.title}}"), "Parent Task");
eq("parent.due:us", r("{{parent.due:us}}"), "6/30/2026");
eq("parent unknown field left raw is empty scalar", r("{{parent.status}}"), "");

// related + children (inline = comma-joined mention links)
eq(
  "item.related.person inline",
  r("{{item.related.person}}"),
  `[@Roger](ledgr://item/${IDP})`
);
eq(
  "item.related.assignee inline (same edge by role)",
  r("{{item.related.assignee}}"),
  `[@Roger](ledgr://item/${IDP})`
);
eq(
  "item.children inline",
  r("{{item.children}}"),
  `[@Prep](ledgr://item/${ID1}), [@Send notes](ledgr://item/${ID2})`
);
eq("empty related key → empty", r("[{{item.related.event}}]"), "[]");

// meeting aliases (ADR-144 Phase 3): {{attendees}}/{{absentees}}/{{group}} map
// to the attending/absent/group relation roles, resolved live.
eq(
  "{{attendees}} alias = item.related.attending",
  r("{{attendees}}"),
  `[@Roger](ledgr://item/${IDP}), [@Kent](ledgr://item/${ID1})`
);
eq("{{absentees}} alias", r("{{absentees}}"), `[@Noah](ledgr://item/${ID2})`);
eq("{{group}} alias", r("{{group}}"), `[@Pastors](ledgr://item/${IDG})`);
eq("{{groups}} alias (plural)", r("{{groups}}"), `[@Pastors](ledgr://item/${IDG})`);
truthy("alias recognized by isLiveTokenExpr", isLiveTokenExpr("attendees"));
truthy("alias counted by hasItemTokens", hasItemTokens("who: {{attendees}}"));
eq(
  "{{attendees:ul}} block expands to a bulleted list",
  r("{{attendees:ul}}"),
  `- [@Roger](ledgr://item/${IDP})\n- [@Kent](ledgr://item/${ID1})`
);

// block list expansion (a whole line that is one :ul/:ol token)
eq(
  "children :ul block",
  r("{{item.children:ul}}"),
  `- [@Prep](ledgr://item/${ID1})\n- [@Send notes](ledgr://item/${ID2})`
);
eq(
  "children :ol block, indented",
  r("  {{item.children:ol}}"),
  `  1. [@Prep](ledgr://item/${ID1})\n  2. [@Send notes](ledgr://item/${ID2})`
);
eq(
  "related :ul block",
  r("{{item.related.person:ul}}"),
  `- [@Roger](ledgr://item/${IDP})`
);
// a :ul token mid-line (not alone) falls back to comma-joined
eq(
  "inline :ul falls back to comma",
  r("Team: {{item.children:ul}}."),
  `Team: [@Prep](ledgr://item/${ID1}), [@Send notes](ledgr://item/${ID2}).`
);

// passthrough / escaping / apply-time coexistence
eq("unknown token left raw", r("{{item.bogus}} {{whatever}}"), "{{item.bogus}} {{whatever}}");
eq("apply-time {{today}} untouched by live resolver", r("{{today}}"), "{{today}}");
eq("escaped token → literal", r("\\{{item.title}}"), "{{item.title}}");
eq("escaped block token → literal line", r("\\{{item.children:ul}}"), "{{item.children:ul}}");
eq("empty todayYmd → text unchanged", resolveItemTokens("{{item.due}}", { ...ctx, todayYmd: "" }), "{{item.due}}");

// hasItemTokens / scanItemTokens
truthy("hasItemTokens true for item.*", hasItemTokens("x {{item.title}}"));
truthy("hasItemTokens true for parent.*", hasItemTokens("{{parent.due}}"));
truthy("hasItemTokens false for apply-time only", !hasItemTokens("{{today}} {{ask:X}}"));
truthy("hasItemTokens false for escaped", !hasItemTokens("\\{{item.title}}"));
eq(
  "scanItemTokens distinct, first-seen",
  scanItemTokens("{{item.title}} {{item.due:long}} {{item.title}} {{today}}"),
  ["item.title", "item.due:long"]
);

// --- LT2: editor helpers ---
truthy("isLiveTokenExpr item.due", isLiveTokenExpr("item.due:long"));
truthy("isLiveTokenExpr parent.title", isLiveTokenExpr("parent.title"));
truthy("isLiveTokenExpr children", isLiveTokenExpr("item.children:ul"));
truthy("isLiveTokenExpr false for today", !isLiveTokenExpr("today"));
truthy("isLiveTokenExpr false for ask", !isLiveTokenExpr("ask:Name"));

eq(
  "findItemTokenRanges spans + expr",
  findItemTokenRanges("Due {{item.due:long}} for {{item.title}}"),
  [
    { start: 4, end: 21, expr: "item.due:long" },
    { start: 26, end: 40, expr: "item.title" },
  ]
);
// verify the reported span exactly covers the token text
{
  const s = "x {{item.title}} y";
  const [r0] = findItemTokenRanges(s);
  eq("range slices to the token", s.slice(r0.start, r0.end), "{{item.title}}");
}
eq("findItemTokenRanges skips escaped", findItemTokenRanges("\\{{item.title}}"), []);
eq("findItemTokenRanges skips apply-time", findItemTokenRanges("{{today}}"), []);

truthy("catalog non-empty", TOKEN_CATALOG.length > 8);
eq(
  "filter by 'due' matches due tokens (label or token)",
  filterTokenOptions("due").every((o) => /due/i.test(o.token) || /due/i.test(o.label)),
  true
);
truthy("filter 'title' hits item.title", filterTokenOptions("title").some((o) => o.token === "item.title"));
eq("empty filter returns all", filterTokenOptions("").length, TOKEN_CATALOG.length);
truthy(
  "every catalog token is a recognized live token",
  TOKEN_CATALOG.every((o) => isLiveTokenExpr(o.token) || o.token === "item.props.")
);

// ===========================================================================
// Part B — DB context builder + render helper (live Neon)
// ===========================================================================
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, types, users } = await import("../src/db/schema");
const { createType } = await import("../src/lib/types");
const { createItem } = await import("../src/lib/item-mutations");
const { relateItems } = await import("../src/lib/relations");
const { buildItemTokenContext, resolveItemBodyTokens } = await import(
  "../src/lib/item-tokens-service"
);
const { bodyMarkdown } = await import("../src/lib/body");
const { inArray } = await import("drizzle-orm");

const stamp = Date.now().toString(36);
const typeKey = `vit_task_${stamp}`;
const personKey = `vit_person_${stamp}`;
const db = getDb();

const [owner] = await db
  .insert(users)
  .values({ email: `verify-item-tokens-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-item-tokens-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  await createType({
    key: typeKey,
    label: "IT Task",
    icon: null,
    showInQuickCapture: true,
    capability: null,
    propertySchema: [
      { key: "course", label: "Course", kind: "text" },
      { key: "due_date", label: "Paper due", kind: "date" },
    ],
  });
  await createType({
    key: personKey,
    label: "IT Person",
    icon: null,
    showInQuickCapture: true,
    capability: null,
    propertySchema: [],
  });

  const roger = await createItem(owner.id, { type: personKey, title: "Roger" });
  const parent = await createItem(owner.id, { type: typeKey, title: "Parent" });
  const item = await createItem(owner.id, {
    type: typeKey,
    title: "Weekly review",
    parentId: parent.id,
    urgency: 1,
    url: "https://ex.test",
    dueDate: new Date("2026-07-01T00:00:00.000Z"),
    scheduledDate: new Date("2026-06-25T00:00:00.000Z"),
    properties: { course: "OT501", due_date: "2026-07-10" },
  });
  // children in authoring order
  const c1 = await createItem(owner.id, { type: typeKey, title: "Prep", parentId: item.id });
  const c2 = await createItem(owner.id, { type: typeKey, title: "Follow up", parentId: item.id });
  await relateItems(owner.id, item.id, roger.id, "assignee");

  const dctx = await buildItemTokenContext(owner.id, item.id, new Date("2026-06-20T12:00:00Z"));
  truthy("context built", !!dctx);
  eq("db self.title", dctx?.self?.title, "Weekly review");
  eq("db self.priority", dctx?.self?.priority, "P1");
  eq("db self.url", dctx?.self?.url, "https://ex.test");
  eq("db self.type label", dctx?.self?.type, "IT Task");
  eq("db self.due ymd", dctx?.self?.dates?.due, "2026-07-01");
  eq("db self.scheduled ymd", dctx?.self?.dates?.scheduled, "2026-06-25");
  eq("db self.props.course", dctx?.self?.props?.course, "OT501");
  eq("db self.props.due_date (kept as ymd)", dctx?.self?.props?.due_date, "2026-07-10");
  eq("db parent.title", dctx?.parent?.title, "Parent");
  eq("db children order", dctx?.children?.map((c) => c.title), ["Prep", "Follow up"]);
  truthy("db children ids", (dctx?.children ?? []).some((c) => c.id === c1.id) && (dctx?.children ?? []).some((c) => c.id === c2.id));
  eq("db related.assignee title", dctx?.related?.assignee?.map((x) => x.title), ["Roger"]);
  eq("db related.<type> (person) title", dctx?.related?.[personKey.toLowerCase()]?.map((x) => x.title), ["Roger"]);

  // Resolve a real body + title through the render helper.
  const resolved = await resolveItemBodyTokens(
    owner.id,
    {
      id: item.id,
      title: "Review — {{item.props.course}}",
      body: { format: "markdown", text: "# {{item.title}}\nDue {{item.props.due_date:long}}\nAssignee: {{item.related.assignee}}" },
    },
    new Date("2026-06-20T12:00:00Z")
  );
  eq("helper resolves title", resolved.title, "Review — OT501");
  eq(
    "helper resolves body (title echo + date + mention link)",
    bodyMarkdown(resolved.body),
    `# Weekly review\nDue July 10, 2026\nAssignee: [@Roger](ledgr://item/${roger.id})`
  );

  // No tokens → body object returned unchanged (same reference).
  const plainBody = { format: "markdown", text: "no tokens here" };
  const plain = await resolveItemBodyTokens(owner.id, { id: item.id, title: "Plain", body: plainBody });
  truthy("no-token body returned as-is", plain.body === plainBody && plain.title === "Plain");

  // Owner-scoping: another owner can't build this item's context.
  const foreign = await buildItemTokenContext(other.id, item.id);
  truthy("owner-scoped: foreign owner → null context", foreign === null);

  // Owner-scoping of relations: a cross-owner edge target is excluded. Create an
  // item owned by `other`, relate the owner's item to it, confirm it's absent.
  const otherItem = await createItem(other.id, { type: personKey, title: "Outsider" });
  await db.insert((await import("../src/db/schema")).relations).values({
    sourceId: item.id,
    targetId: otherItem.id,
    role: "assignee",
  });
  const dctx2 = await buildItemTokenContext(owner.id, item.id);
  eq("cross-owner related target excluded", dctx2?.related?.assignee?.map((x) => x.title), ["Roger"]);
} finally {
  await db.delete(items).where(inArray(items.ownerId, [owner.id, other.id]));
  await db.delete(types).where(inArray(types.key, [typeKey, personKey]));
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

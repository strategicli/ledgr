// Slice 5 verification (next_steps.md): the markdown serializer (pure),
// mention → relations sync and attachment presign flow (against live Neon).
// Run with:  npx tsx scripts/verify-editor.mts
// Also writes sample-export.md next to this script for the manual Obsidian
// reading-view check (PRD §4.1's acceptance test).
import { readFileSync, writeFileSync } from "node:fs";

// Minimal .env.local loader; strips BOM and CRLF (PowerShell-written files).
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { bodyToMarkdown } = await import("../src/lib/markdown");
const { BLOCKNOTE_COLORS } = await import("../src/lib/colors");
const { getDb } = await import("../src/db");
const { attachments, items, relations, users } = await import(
  "../src/db/schema"
);
const { ItemError, createItem, listItemsQuery, restoreRevision, updateItem } =
  await import("../src/lib/items");
const { MENTION_ROLE } = await import("../src/lib/mentions");
const { and, eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function expectError(
  name: string,
  code: "not_found" | "bad_request",
  fn: () => Promise<unknown>
) {
  try {
    await fn();
    check(name, false, "no error thrown");
  } catch (err) {
    check(name, err instanceof ItemError && err.code === code, String(err));
  }
}

// ---------- Part 1: serializer (pure, no DB) ----------

const t = (text: string, styles: Record<string, unknown> = {}) => ({
  type: "text",
  text,
  styles,
});
const p = (content: unknown[], props: Record<string, unknown> = {}) => ({
  type: "paragraph",
  props,
  content,
  children: [],
});

const sermonDoc = [
  { type: "heading", props: { level: 1 }, content: [t("The Good Shepherd")], children: [] },
  p([
    t("Plain, "),
    t("bold", { bold: true }),
    t(", "),
    t("italic", { italic: true }),
    t(", "),
    t("red text", { textColor: "red" }),
    t(", and "),
    t("yellow highlight", { backgroundColor: "yellow" }),
    t("."),
  ]),
  p([t("Bold blue highlight", { bold: true, backgroundColor: "blue" })]),
  { type: "heading", props: { level: 2 }, content: [t("Outline")], children: [] },
  {
    type: "numberedListItem",
    props: {},
    content: [t("First point")],
    children: [
      { type: "bulletListItem", props: {}, content: [t("Sub point")], children: [] },
    ],
  },
  { type: "numberedListItem", props: {}, content: [t("Second point")], children: [] },
  { type: "checkListItem", props: { checked: true }, content: [t("Done thing")], children: [] },
  { type: "checkListItem", props: { checked: false }, content: [t("Open thing")], children: [] },
  p([t("A paragraph directly after the list.")]),
  { type: "quote", props: {}, content: [t("I am the good shepherd.")], children: [] },
  { type: "divider", props: {}, content: undefined, children: [] },
  {
    type: "codeBlock",
    props: { language: "text" },
    content: [t("John 10:11 *not emphasis*")],
    children: [],
  },
  p([
    t("See "),
    {
      type: "mention",
      props: { itemId: "00000000-0000-0000-0000-000000000001", title: "Roger" },
    },
    t(" and "),
    { type: "link", href: "https://example.com", content: [t("this link")] },
    t("."),
  ]),
  {
    type: "image",
    props: { url: "https://cdn.example.com/img.png", name: "img.png", caption: "A caption" },
    content: undefined,
    children: [],
  },
  {
    type: "table",
    props: {},
    content: {
      type: "tableContent",
      rows: [
        { cells: [{ type: "tableCell", content: [t("Name")] }, { type: "tableCell", content: [t("Role")] }] },
        { cells: [{ type: "tableCell", content: [t("Roger")] }, { type: "tableCell", content: [t("Elder")] }] },
      ],
    },
    children: [],
  },
  p([t("Whole-paragraph green block")], { backgroundColor: "green" }),
  { type: "futureQueryView", props: {}, content: [t("placeholder text")], children: [] },
];

const md = bodyToMarkdown(sermonDoc);

check("md: h1", md.includes("# The Good Shepherd"));
check("md: h2", md.includes("## Outline"));
check("md: bold", md.includes("**bold**"));
check("md: italic", md.includes("*italic*"));
check(
  "md: text color via mapping table",
  md.includes(`<span style="color:${BLOCKNOTE_COLORS.red.text}">red text</span>`)
);
check(
  "md: highlight via mapping table",
  md.includes(
    `<mark class="hl-yellow" style="background-color:${BLOCKNOTE_COLORS.yellow.background}">yellow highlight</mark>`
  )
);
check(
  "md: nested bold inside highlight",
  md.includes(`<mark class="hl-blue" style="background-color:${BLOCKNOTE_COLORS.blue.background}">**Bold blue highlight**</mark>`)
);
check("md: numbered sequence", md.includes("1. First point") && md.includes("2. Second point"));
check("md: nested bullet indented", md.includes("    - Sub point"));
check("md: checklist", md.includes("- [x] Done thing") && md.includes("- [ ] Open thing"));
check(
  "md: blank line closes list before paragraph",
  md.includes("Open thing\n\nA paragraph directly after the list.")
);
check("md: quote", md.includes("> I am the good shepherd."));
check("md: divider", md.includes("\n---\n"));
check(
  "md: code fence keeps raw text",
  md.includes("```text\nJohn 10:11 *not emphasis*\n```")
);
check(
  "md: mention exports as ledgr:// link",
  md.includes("[@Roger](ledgr://item/00000000-0000-0000-0000-000000000001)")
);
check("md: link", md.includes("[this link](https://example.com)"));
check(
  "md: image with caption",
  md.includes("![img.png](https://cdn.example.com/img.png)") && md.includes("*A caption*")
);
check(
  "md: table",
  md.includes("| Name | Role |") && md.includes("| --- | --- |") && md.includes("| Roger | Elder |")
);
check(
  "md: block-level background color",
  md.includes(`<mark class="hl-green" style="background-color:${BLOCKNOTE_COLORS.green.background}">Whole-paragraph green block</mark>`)
);
check("md: unknown block degrades to text", md.includes("placeholder text"));
check("md: empty body is empty string", bodyToMarkdown(null) === "" && bodyToMarkdown([]) === "");
check(
  "md: special chars escaped in prose",
  bodyToMarkdown([p([t("a*b_c<d")])]).includes("a\\*b\\_c\\<d")
);

writeFileSync("scripts/sample-export.md", md);
console.log("\nwrote scripts/sample-export.md (open in Obsidian reading view to eyeball)\n");

// ---------- Part 2: mention sync + search (live Neon) ----------

const db = getDb();
const owner = (await db.select({ id: users.id }).from(users).limit(1))[0];
if (!owner) throw new Error("no users row; run db:seed first");

const made: string[] = [];
async function mk(title: string, body: unknown = null) {
  const item = await createItem(owner.id, { type: "note", title, body });
  made.push(item.id);
  return item;
}

const target = await mk("verify5 target");
const mentionOf = (id: string) => [
  p([t("see "), { type: "mention", props: { itemId: id, title: "x" } }]),
];

const source = await mk("verify5 source", mentionOf(target.id));

const rels = () =>
  db
    .select({ targetId: relations.targetId, role: relations.role })
    .from(relations)
    .where(and(eq(relations.sourceId, source.id), eq(relations.role, MENTION_ROLE)));

check(
  "mention: create body → relation row",
  (await rels()).some((r) => r.targetId === target.id)
);

// A manual relation with another role must survive the sync.
await db.insert(relations).values({
  sourceId: source.id,
  targetId: target.id,
  role: "tagged",
});

await updateItem(owner.id, source.id, { body: [p([t("no mentions now")])] });
check("mention: removing mention removes relation row", (await rels()).length === 0);
const tagged = await db
  .select({ id: relations.id })
  .from(relations)
  .where(and(eq(relations.sourceId, source.id), eq(relations.role, "tagged")));
check("mention: other-role relations untouched by sync", tagged.length === 1);

await updateItem(owner.id, source.id, {
  body: mentionOf("00000000-0000-0000-0000-00000000dead"),
});
check("mention: dangling target id creates nothing", (await rels()).length === 0);

await updateItem(owner.id, source.id, { body: mentionOf(source.id) });
check("mention: self-mention ignored", (await rels()).length === 0);

// Mentions return on revision restore (the create-time body had the mention
// and was snapshotted; restoring it should resync the edge).
const revs = await db.execute(
  // raw to keep this script independent of lib internals
  (await import("drizzle-orm")).sql`
    select id from revisions where item_id = ${source.id} order by created_at asc limit 1`
);
if (revs.rows.length > 0) {
  await restoreRevision(owner.id, source.id, revs.rows[0].id as string);
  check(
    "mention: revision restore resyncs relations",
    (await rels()).some((r) => r.targetId === target.id)
  );
} else {
  check("mention: revision restore resyncs relations", false, "no revision found");
}

// Clearing the body clears the edges.
await updateItem(owner.id, source.id, { body: null });
check("mention: null body clears relation rows", (await rels()).length === 0);

// Title search for the @-picker.
const needle = await mk("verify5 zq%needle_zz");
const q1 = await listItemsQuery(owner.id, { q: "zq%needle" });
check("search: q matches title substring", q1.some((r) => r.id === needle.id));
const q2 = await listItemsQuery(owner.id, { q: "zq%needle" });
check(
  "search: ILIKE wildcards escaped",
  // '%' is literal in the query: 'zqXneedle' must NOT match
  !(await listItemsQuery(owner.id, { q: "zqXneedle" })).some((r) => r.id === needle.id) &&
    q2.some((r) => r.id === needle.id)
);
const qsql = listItemsQuery(owner.id, { q: "abc" }).toSQL().sql.toLowerCase();
check(
  "search: q query stays owner-scoped, body-free",
  qsql.includes("owner_id") && qsql.includes("ilike") && !qsql.includes('"body"')
);

// ---------- Part 3: attachments (validation + presign shape) ----------

const att = await import("../src/lib/attachments");

await expectError("attach: storage unconfigured → bad_request", "bad_request", () =>
  att.createAttachment(owner.id, {
    itemId: target.id,
    filename: "x.png",
    contentType: "image/png",
    sizeBytes: 10,
  })
);

// Fake-but-well-formed R2 config: aws4fetch signs locally, no network needed.
process.env.R2_ACCESS_KEY_ID = "verifykey";
process.env.R2_SECRET_ACCESS_KEY = "verifysecret";
process.env.R2_BUCKET = "ledgr";
process.env.R2_ENDPOINT = "https://fake-account.r2.cloudflarestorage.com";
process.env.R2_PUBLIC_BASE_URL = "https://files.example.com";

await expectError("attach: zero size rejected", "bad_request", () =>
  att.createAttachment(owner.id, {
    itemId: target.id,
    filename: "x.png",
    contentType: "image/png",
    sizeBytes: 0,
  })
);
await expectError("attach: oversize rejected", "bad_request", () =>
  att.createAttachment(owner.id, {
    itemId: target.id,
    filename: "x.png",
    contentType: "image/png",
    sizeBytes: 101 * 1024 * 1024,
  })
);
await expectError("attach: unknown item → not_found", "not_found", () =>
  att.createAttachment(owner.id, {
    itemId: "00000000-0000-0000-0000-00000000dead",
    filename: "x.png",
    contentType: "image/png",
    sizeBytes: 10,
  })
);

const created = await att.createAttachment(owner.id, {
  itemId: target.id,
  filename: "pasted image.png",
  contentType: "image/png",
  sizeBytes: 1234,
});
check(
  "attach: storage key is owner-prefixed and sanitized",
  created.storageKey.startsWith(`${owner.id}/`) &&
    created.storageKey.endsWith("/pasted_image.png")
);
check(
  "attach: presigned PUT URL shape",
  created.uploadUrl.includes("X-Amz-Signature=") &&
    created.uploadUrl.includes("X-Amz-Expires=900") &&
    created.uploadUrl.startsWith("https://fake-account.r2.cloudflarestorage.com/ledgr/")
);
check(
  "attach: public URL on CDN base",
  created.publicUrl === `https://files.example.com/${created.storageKey.split("/").map(encodeURIComponent).join("/")}`
);
const listed = await att.listAttachments(owner.id, target.id);
check(
  "attach: metadata row listed for item",
  listed.some((a) => a.id === created.id && a.sizeBytes === 1234)
);

// Quota: park a row just under the 10GB line, then any new file must bounce.
const hog = crypto.randomUUID();
await db.insert(attachments).values({
  id: hog,
  ownerId: owner.id,
  parentItemId: target.id,
  filename: "hog.bin",
  contentType: "application/octet-stream",
  sizeBytes: 10 * 1024 * 1024 * 1024 - 100,
  storageKey: `${owner.id}/${hog}/hog.bin`,
});
await expectError("attach: quota enforced (~10GB)", "bad_request", () =>
  att.createAttachment(owner.id, {
    itemId: target.id,
    filename: "y.png",
    contentType: "image/png",
    sizeBytes: 1024,
  })
);

// ---------- Cleanup ----------
await db.delete(items).where(inArray(items.id, made));
const leftover = await db
  .select({ id: relations.id })
  .from(relations)
  .where(inArray(relations.sourceId, made));
check("cleanup: cascade removed relations/attachments", leftover.length === 0);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

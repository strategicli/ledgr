// Slices 12-14 verification (next_steps.md): exercises the view-filter
// queries (src/lib/views.ts) and full-text search (src/lib/search.ts)
// against the live Neon DB, then cleans up. Quick capture (slice 14) reuses
// the verified create path; its UI is browser-checked. Run with:
// npx tsx scripts/verify-lists-search.mts
// Safe to delete once the slices are closed (like verify-today-inbox.mts).
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { createItem, softDeleteItem } = await import("../src/lib/items");
const { makeMarkdownBody } = await import("../src/lib/body");
const { todayBounds } = await import("../src/lib/today");
const { listPersonOptions, queryViewItems, viewItemsQuery } = await import(
  "../src/lib/views"
);
const { searchItems, searchItemsQuery } = await import("../src/lib/search");
const { inArray, sql } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const owners = await db.select({ id: users.id }).from(users);
const ownerId = owners[0].id;
const created: string[] = [];
let tempUserId: string | null = null;

// Bodies are canonical markdown now (ADR-040); a one-paragraph body is just
// the text. body_text (and thus FTS) is derived from this on save.
function para(text: string) {
  return makeMarkdownBody(text);
}

try {
  // 1. Generated SQL shape: owner-scoped, body never selected.
  const viewSql = viewItemsQuery(ownerId, { type: "task" }).toSQL().sql;
  check("view SQL is owner-scoped", viewSql.includes("owner_id"));
  check(
    "view SQL selects no body",
    !/"body"/.test(viewSql) && !viewSql.includes("body_text")
  );
  const searchSql = searchItemsQuery(ownerId, "x").toSQL().sql;
  check("search SQL is owner-scoped", searchSql.includes("owner_id"));
  check(
    "search SQL selects no raw body (snippet reads body_text only)",
    !/"body"(?!_)/.test(searchSql)
  );

  // 2. Fixtures.
  const bounds = todayBounds();
  const dayMs = 24 * 60 * 60 * 1000;
  const entity = await createItem(ownerId, { type: "person", title: "V12 Person Alpha" });
  const entityB = await createItem(ownerId, { type: "person", title: "V12 Person Beta" });
  const tOverdue = await createItem(ownerId, { type: "task", title: "V12 overdue", dueDate: new Date(bounds.dueToday.getTime() - dayMs) });
  const tToday = await createItem(ownerId, { type: "task", title: "V12 due today", dueDate: bounds.dueToday, urgency: "high" });
  const tWeek = await createItem(ownerId, { type: "task", title: "V12 due in 3 days", dueDate: new Date(bounds.dueToday.getTime() + 3 * dayMs) });
  const tFar = await createItem(ownerId, { type: "task", title: "V12 due in 30 days", dueDate: new Date(bounds.dueToday.getTime() + 30 * dayMs) });
  const tUndated = await createItem(ownerId, { type: "task", title: "V12 undated" });
  const tDone = await createItem(ownerId, { type: "task", title: "V12 done", dueDate: bounds.dueToday, status: "done" });
  const note = await createItem(ownerId, { type: "note", title: "V13 zebra note", body: para("The xylophone rehearsal went long on Tuesday evening.") });
  const meeting = await createItem(ownerId, { type: "event", title: "V12 meeting", meetingAt: new Date() });
  created.push(entity.id, entityB.id, tOverdue.id, tToday.id, tWeek.id, tFar.id, tUndated.id, tDone.id, note.id, meeting.id);

  // Confirmed edge task->entity, suggested edge for another task, and a
  // confirmed edge entity->note (reverse direction).
  await db.insert(relations).values([
    { sourceId: tToday.id, targetId: entity.id, role: "related", matchState: "confirmed" },
    { sourceId: tWeek.id, targetId: entity.id, role: "related", matchState: "suggested" },
    { sourceId: entity.id, targetId: note.id, role: "related", matchState: "confirmed" },
  ]);

  // 3. View filters.
  const open = await queryViewItems(ownerId, { type: "task", status: "open" });
  const openIds = open.map((t) => t.id);
  check(
    "status filter: open excludes done",
    openIds.includes(tOverdue.id) && !openIds.includes(tDone.id)
  );
  check("view rows carry no body", open.every((r) => !("body" in r) && !("bodyText" in r)));

  const urgent = await queryViewItems(ownerId, { type: "task", urgency: "high" });
  check(
    "urgency filter",
    urgent.some((t) => t.id === tToday.id) && !urgent.some((t) => t.id === tOverdue.id)
  );

  const overdue = await queryViewItems(ownerId, { type: "task", due: "overdue" });
  const today = await queryViewItems(ownerId, { type: "task", due: "today" });
  const week = await queryViewItems(ownerId, { type: "task", due: "week" });
  const none = await queryViewItems(ownerId, { type: "task", due: "none" });
  check(
    "due window: overdue",
    overdue.some((t) => t.id === tOverdue.id) &&
      !overdue.some((t) => t.id === tToday.id)
  );
  check(
    "due window: today",
    today.some((t) => t.id === tToday.id) &&
      !today.some((t) => t.id === tOverdue.id) &&
      !today.some((t) => t.id === tWeek.id)
  );
  check(
    "due window: week includes today and +3d, excludes +30d and overdue",
    week.some((t) => t.id === tToday.id) &&
      week.some((t) => t.id === tWeek.id) &&
      !week.some((t) => t.id === tFar.id) &&
      !week.some((t) => t.id === tOverdue.id)
  );
  check(
    "due window: none is the undated holding bin",
    none.some((t) => t.id === tUndated.id) && !none.some((t) => t.id === tToday.id)
  );

  const byEntity = await queryViewItems(ownerId, { type: "task", relatedTo: entity.id });
  check(
    "entity filter: confirmed edge matches, suggested excluded",
    byEntity.some((t) => t.id === tToday.id) &&
      !byEntity.some((t) => t.id === tWeek.id)
  );
  const reverse = await queryViewItems(ownerId, { type: "note", relatedTo: entity.id });
  check("entity filter matches the reverse direction", reverse.some((n) => n.id === note.id));
  const byEntityB = await queryViewItems(ownerId, { type: "task", relatedTo: entityB.id });
  check("entity filter: unrelated entity matches nothing", !byEntityB.some((t) => created.includes(t.id)));

  const dueSorted = await queryViewItems(ownerId, { type: "task", status: "open" }, { field: "dueDate", dir: "asc" });
  const fixturesInOrder = dueSorted.filter((t) => created.includes(t.id)).map((t) => t.id);
  check(
    "due-date sort ascending with undated last",
    fixturesInOrder.indexOf(tOverdue.id) < fixturesInOrder.indexOf(tToday.id) &&
      fixturesInOrder.indexOf(tFar.id) < fixturesInOrder.indexOf(tUndated.id),
    fixturesInOrder.join(",")
  );

  const options = await listPersonOptions(ownerId);
  check(
    "person options include fixtures, alphabetical",
    options.findIndex((e) => e.id === entity.id) >= 0 &&
      options.findIndex((e) => e.id === entity.id) <
        options.findIndex((e) => e.id === entityB.id)
  );

  // 4. Owner scoping for views.
  const temp = await db
    .insert(users)
    .values({ email: `verify-lists-${Date.now()}@example.org` })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  const foreignTask = await createItem(tempUserId, { type: "task", title: "V12 foreign task", dueDate: bounds.dueToday });
  created.push(foreignTask.id);
  const open2 = await queryViewItems(ownerId, { type: "task" });
  check("cross-owner task excluded from views", !open2.some((t) => t.id === foreignTask.id));

  // 5. Search.
  const byTitle = await searchItems(ownerId, "zebra");
  check("search matches a title word", byTitle.some((r) => r.id === note.id));
  const byBody = await searchItems(ownerId, "xylophone");
  const bodyHit = byBody.find((r) => r.id === note.id);
  check("search matches a body word", bodyHit != null);
  check(
    "body hit carries a marked snippet",
    bodyHit?.snippet != null && bodyHit.snippet.includes("[[xylophone]]"),
    bodyHit?.snippet ?? ""
  );
  check(
    "title-only hit has no noise snippet",
    byTitle.find((r) => r.id === note.id)?.snippet === null
  );
  check(
    "search rows carry rank and no body",
    byBody.every((r) => typeof r.rank === "number" && !("body" in r))
  );

  const phrase = await searchItems(ownerId, '"xylophone rehearsal"');
  const phraseWrong = await searchItems(ownerId, '"rehearsal xylophone"');
  check(
    "quoted phrase matches in order only",
    phrase.some((r) => r.id === note.id) && !phraseWrong.some((r) => r.id === note.id)
  );

  const typed = await searchItems(ownerId, "xylophone", { type: "task" });
  check("type filter narrows search", !typed.some((r) => r.id === note.id));
  const viaEntity = await searchItems(ownerId, "xylophone", { relatedTo: entity.id });
  const viaEntityB = await searchItems(ownerId, "xylophone", { relatedTo: entityB.id });
  check(
    "entity filter narrows search",
    viaEntity.some((r) => r.id === note.id) && !viaEntityB.some((r) => r.id === note.id)
  );

  const tomorrow = new Date(Date.now() + dayMs);
  const yesterday = new Date(Date.now() - dayMs);
  const fromFuture = await searchItems(ownerId, "xylophone", { from: tomorrow });
  const window = await searchItems(ownerId, "xylophone", { from: yesterday, to: tomorrow });
  check(
    "updated-date window narrows search",
    !fromFuture.some((r) => r.id === note.id) && window.some((r) => r.id === note.id)
  );

  const blank = await searchItems(ownerId, "   ");
  check("blank query returns nothing without a DB trip", blank.length === 0);

  const foreignNote = await createItem(tempUserId, { type: "note", title: "V13 foreign zebra", body: para("xylophone elsewhere") });
  created.push(foreignNote.id);
  const scoped = await searchItems(ownerId, "xylophone");
  check("cross-owner search isolation", !scoped.some((r) => r.id === foreignNote.id));

  // 6. Coverage beyond title+body (ADR-014): url, properties; weighting.
  const link = await createItem(ownerId, { type: "link", title: "V14 a saved video", url: "https://www.youtube.com/watch?v=xylovid123" });
  const propped = await createItem(ownerId, { type: "task", title: "V14 propped task", properties: { campus: "Xylocampus North" } });
  const quokkaTitle = await createItem(ownerId, { type: "note", title: "V14 quokka in the title" });
  const quokkaBody = await createItem(ownerId, { type: "note", title: "V14 plain note", body: para("A quokka appears only in the body.") });
  created.push(link.id, propped.id, quokkaTitle.id, quokkaBody.id);

  const byUrl = await searchItems(ownerId, "youtube");
  check("url words are searchable (punctuation split)", byUrl.some((r) => r.id === link.id));
  const byUrlId = await searchItems(ownerId, "xylovid123");
  check("url path tokens are searchable", byUrlId.some((r) => r.id === link.id));
  const byProp = await searchItems(ownerId, "xylocampus");
  check("custom property string values are searchable", byProp.some((r) => r.id === propped.id));
  const byStatus = await searchItems(ownerId, "open");
  check(
    "status enum is NOT a search word",
    !byStatus.some((r) => r.id === propped.id || r.id === quokkaTitle.id)
  );
  const quokka = await searchItems(ownerId, "quokka");
  check(
    "title hits outrank body hits",
    quokka.findIndex((r) => r.id === quokkaTitle.id) <
      quokka.findIndex((r) => r.id === quokkaBody.id) &&
      quokka.some((r) => r.id === quokkaBody.id),
    quokka.map((r) => `${r.title}:${r.rank.toFixed(3)}`).join(", ")
  );
  const gin = await db.execute(
    sql`select indexdef from pg_indexes where indexname = 'items_search_gin'`
  );
  check(
    "items_search_gin survived the column rebuild",
    String(gin.rows[0]?.indexdef ?? "").includes("gin"),
    String(gin.rows[0]?.indexdef ?? "missing")
  );

  await softDeleteItem(ownerId, note.id);
  const afterTrash = await searchItems(ownerId, "xylophone");
  check("trashed items drop out of search", !afterTrash.some((r) => r.id === note.id));
} finally {
  if (created.length > 0) {
    await db.delete(items).where(inArray(items.id, created));
  }
  if (tempUserId) {
    await db.delete(users).where(sql`id = ${tempUserId}`);
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

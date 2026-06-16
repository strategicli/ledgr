// Relations: the read path behind entity pages and the backlinks panel
// (slice 6, PRD §4.2 "tag as dashboard" / §4.9), plus the write path
// (slice 15): relate, un-relate, confirm. One both-directions pass over
// relations, owner-scoped, body-free, live items only. Both match states are
// returned with the flag carried per row: trusted lists keep only
// 'confirmed'; the UI renders 'suggested' rows dotted/grayed instead of
// hiding them.
//
// Mention edges (role 'mention') belong to the body: they are diff-synced
// from @-mentions on every save (src/lib/mentions.ts), so the write path
// refuses to create or delete them — a manually deleted mention edge would
// silently resurrect on the next body save.
import { and, desc, eq, inArray, ne, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { ItemError, listColumns } from "@/lib/items";
import { MENTION_ROLE } from "@/lib/mentions";

// Generous bound for a single-user dashboard page; paging can come with the
// view engine if an entity ever outgrows it.
const RELATED_LIMIT = 500;

export type RelatedItem = Awaited<
  ReturnType<typeof relatedItemsQuery>
>[number] extends infer Row
  ? Omit<Row, "role"> & { roles: string[] }
  : never;

// Exposed as a query builder (items.ts pattern) so verification can assert
// the generated SQL carries owner_id and selects no body. The separate
// relations source/target indexes make the OR join two bitmap index scans
// (schema.md index plan).
export function relatedItemsQuery(ownerId: string, itemId: string) {
  return getDb()
    .select({
      ...listColumns,
      role: relations.role,
      matchState: relations.matchState,
    })
    .from(relations)
    .innerJoin(
      items,
      or(
        and(eq(relations.sourceId, itemId), eq(items.id, relations.targetId)),
        and(eq(relations.targetId, itemId), eq(items.id, relations.sourceId))
      )
    )
    .where(
      and(
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        // A self-edge must not list the entity on its own page.
        ne(items.id, itemId)
      )
    )
    .orderBy(desc(items.updatedAt))
    .limit(RELATED_LIMIT);
}

// Distinct related items. An item linked by several edges (mention + tag,
// or both directions) appears once, with every role collected and
// 'confirmed' winning over 'suggested'.
export async function listRelatedItems(
  ownerId: string,
  itemId: string
): Promise<RelatedItem[]> {
  const anchor = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
  if (anchor.length === 0) throw new ItemError("not_found", "item not found");

  const out = new Map<string, RelatedItem>();
  for (const { role, ...row } of await relatedItemsQuery(ownerId, itemId)) {
    const seen = out.get(row.id);
    if (!seen) {
      out.set(row.id, { ...row, roles: [role] });
    } else {
      if (!seen.roles.includes(role)) seen.roles.push(role);
      if (row.matchState === "confirmed") seen.matchState = "confirmed";
    }
  }
  return [...out.values()];
}

// Confirmed related items for a SET of anchor ids, in one pair of indexed
// queries (not N+1) — for the dashboard's compact list, which shows a small
// "associated with" chip per row. Either direction, owner-scoped, live-only,
// self-edges and the anchor itself excluded; deduped per anchor, capped small.
export async function relatedSummaryFor(
  ownerId: string,
  itemIds: string[]
): Promise<Map<string, { id: string; title: string; type: string }[]>> {
  const out = new Map<string, { id: string; title: string; type: string }[]>();
  if (itemIds.length === 0) return out;
  const db = getDb();
  const anchors = new Set(itemIds);
  const cols = { id: items.id, title: items.title, type: items.type };
  // Two passes: anchor is the source (related = target), then anchor is the
  // target (related = source). Confirmed edges only.
  const [asSource, asTarget] = await Promise.all([
    db
      .select({ anchor: relations.sourceId, ...cols })
      .from(relations)
      .innerJoin(items, eq(items.id, relations.targetId))
      .where(
        and(
          inArray(relations.sourceId, itemIds),
          eq(relations.matchState, "confirmed"),
          eq(items.ownerId, ownerId),
          isNull(items.deletedAt)
        )
      ),
    db
      .select({ anchor: relations.targetId, ...cols })
      .from(relations)
      .innerJoin(items, eq(items.id, relations.sourceId))
      .where(
        and(
          inArray(relations.targetId, itemIds),
          eq(relations.matchState, "confirmed"),
          eq(items.ownerId, ownerId),
          isNull(items.deletedAt)
        )
      ),
  ]);
  for (const r of [...asSource, ...asTarget]) {
    if (r.id === r.anchor || !anchors.has(r.anchor)) continue;
    const arr = out.get(r.anchor) ?? [];
    if (!arr.some((x) => x.id === r.id) && arr.length < 4) {
      arr.push({ id: r.id, title: r.title, type: r.type });
    }
    out.set(r.anchor, arr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write path (slice 15). Every entry point validates both ids against the
// owner before touching relations, because relations rows carry no owner_id
// of their own (schema.md: ownership lives on the items they connect).

async function assertOwned(
  ownerId: string,
  id: string,
  opts: { live?: boolean } = {}
) {
  const rows = await getDb()
    .select({ deletedAt: items.deletedAt })
    .from(items)
    .where(and(eq(items.id, id), eq(items.ownerId, ownerId)));
  if (rows.length === 0) throw new ItemError("not_found", "item not found");
  if (opts.live && rows[0].deletedAt !== null) {
    throw new ItemError("bad_request", "item is in Trash");
  }
}

// The backlinks panel is direction-blind (a row is "linked", not "linked
// from"), so the un-relate and confirm gestures match edges both ways.
function pairFilter(itemId: string, otherId: string): SQL {
  return or(
    and(eq(relations.sourceId, itemId), eq(relations.targetId, otherId)),
    and(eq(relations.sourceId, otherId), eq(relations.targetId, itemId))
  )!;
}

// Manual relate: source -> target with role 'related' by default (PRD §3.4:
// tagging a task with an entity is an edge from the task to the entity).
// Upsert on the (source, target, role) unique: re-relating an existing
// suggested edge confirms it — relating *is* the confirm gesture.
export async function relateItems(
  ownerId: string,
  sourceId: string,
  targetId: string,
  role = "related"
) {
  if (role === MENTION_ROLE) {
    throw new ItemError(
      "bad_request",
      "mention edges are managed by the body; edit the @-mention instead"
    );
  }
  if (sourceId === targetId) {
    throw new ItemError("bad_request", "an item cannot relate to itself");
  }
  await assertOwned(ownerId, sourceId, { live: true });
  await assertOwned(ownerId, targetId, { live: true });
  const rows = await getDb()
    .insert(relations)
    .values({ sourceId, targetId, role })
    .onConflictDoUpdate({
      target: [relations.sourceId, relations.targetId, relations.role],
      set: { matchState: "confirmed" },
    })
    .returning();
  return rows[0];
}

// Machine-made edge from the calendar matcher (slice 23). Like relateItems
// but writes the given match_state (attendee/fuzzy land 'suggested', series/
// regex 'confirmed', per the engine) and, crucially, **never downgrades** an
// existing confirmed edge to suggested: if the user already confirmed (or
// manually related) this pair, a later suggested auto-match leaves it
// confirmed. A confirmed auto-match upgrades an existing suggested edge.
export async function addMatchEdge(
  ownerId: string,
  sourceId: string,
  targetId: string,
  matchState: "confirmed" | "suggested",
  role = "related"
) {
  if (role === MENTION_ROLE) {
    throw new ItemError("bad_request", "mention edges are body-managed");
  }
  if (sourceId === targetId) {
    throw new ItemError("bad_request", "an item cannot relate to itself");
  }
  await assertOwned(ownerId, sourceId, { live: true });
  await assertOwned(ownerId, targetId, { live: true });
  const rows = await getDb()
    .insert(relations)
    .values({ sourceId, targetId, role, matchState })
    .onConflictDoUpdate({
      target: [relations.sourceId, relations.targetId, relations.role],
      set: {
        matchState: sql`case when excluded.match_state = 'confirmed' or ${relations.matchState} = 'confirmed' then 'confirmed'::match_state else 'suggested'::match_state end`,
      },
    })
    .returning();
  return rows[0];
}

// Un-relate, never delete (PRD §4.9): removes every non-mention edge between
// the pair in both directions; both items stay. suggestedOnly is the reject
// gesture for provisional matches — it leaves confirmed edges alone.
export async function unrelateItems(
  ownerId: string,
  itemId: string,
  otherId: string,
  opts: { suggestedOnly?: boolean } = {}
) {
  await assertOwned(ownerId, itemId);
  await assertOwned(ownerId, otherId);
  const where = [pairFilter(itemId, otherId), ne(relations.role, MENTION_ROLE)];
  if (opts.suggestedOnly) where.push(eq(relations.matchState, "suggested"));
  const rows = await getDb()
    .delete(relations)
    .where(and(...where))
    .returning({ id: relations.id });
  return { removed: rows.length };
}

// Confirm a provisional match: flips every suggested edge between the pair
// to confirmed (PRD §3.3; the calendar matcher creates these in Phase 2).
export async function confirmRelations(
  ownerId: string,
  itemId: string,
  otherId: string
) {
  await assertOwned(ownerId, itemId);
  await assertOwned(ownerId, otherId);
  const rows = await getDb()
    .update(relations)
    .set({ matchState: "confirmed" })
    .where(
      and(pairFilter(itemId, otherId), eq(relations.matchState, "suggested"))
    )
    .returning({ id: relations.id });
  return { confirmed: rows.length };
}

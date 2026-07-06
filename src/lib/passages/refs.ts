// Passage-ref body sync + read queries (ADR-143, slice 2) — the passage sibling
// of src/lib/mentions.ts. A passage link lives in the canonical markdown body as
// a link whose href is `ledgr://passage/<start>[-<end>]` (ref.ts); on every body
// save the passage_refs rows with role 'passage' are diffed against what the
// body actually contains, so removing an @/ref removes its edge — exactly the
// syncMentionRelations contract, but writing to passage_refs instead of
// relations. Rows with any OTHER role (e.g. the later auto-tagger's 'suggested'
// edges, Tyler review pt 2a) are never touched here.
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, passageRefs } from "@/db/schema";
import { bodyMarkdown } from "@/lib/body";
import { collectPassageRefsFromMarkdown, type PassageRef } from "@/lib/passages/ref";

// The body-authored @/ref edge role. Distinct from any future auto-tagger role
// so the two never delete each other on save.
export const PASSAGE_ROLE = "passage";

// A stored passage edge, resolved for the Related panel (body-free).
export type ResolvedPassageRef = {
  id: string;
  startRef: number;
  endRef: number;
  role: string;
};

// Diff the body's passage links against the stored 'passage' edges for this item
// and reconcile. Owner scope rides the caller: syncPassageRefs is only ever
// invoked with an itemId the caller (updateItem/createItem) already owner-scoped,
// exactly like syncMentionRelations. Runs on a null body too (clearing a body
// clears its passage edges).
export async function syncPassageRefs(
  _ownerId: string,
  itemId: string,
  body: unknown
): Promise<void> {
  const db = getDb();
  const wanted = collectPassageRefsFromMarkdown(bodyMarkdown(body));
  const wantedKeys = new Set(wanted.map(refKey));

  const existing = await db
    .select({ id: passageRefs.id, startRef: passageRefs.startRef, endRef: passageRefs.endRef })
    .from(passageRefs)
    .where(and(eq(passageRefs.sourceItemId, itemId), eq(passageRefs.role, PASSAGE_ROLE)));

  const stale = existing.filter((r) => !wantedKeys.has(refKey(r)));
  if (stale.length > 0) {
    await db.delete(passageRefs).where(
      inArray(
        passageRefs.id,
        stale.map((r) => r.id)
      )
    );
  }

  const have = new Set(existing.map(refKey));
  const missing = wanted.filter((r) => !have.has(refKey(r)));
  if (missing.length === 0) return;

  await db
    .insert(passageRefs)
    .values(
      missing.map((r) => ({
        sourceItemId: itemId,
        startRef: r.startRef,
        endRef: r.endRef,
        role: PASSAGE_ROLE,
      }))
    )
    .onConflictDoNothing();
}

// The passage edges on one item, for the Related panel's passage group. Owner-
// scoped through the join to items (as relations reads do) and template-excluded;
// body-free. Deleted items never reach here (the row cascades on purge, and the
// item view isn't shown for a soft-deleted item).
export async function resolvePassageRefs(
  ownerId: string,
  itemId: string
): Promise<ResolvedPassageRef[]> {
  const rows = await getDb()
    .select({
      id: passageRefs.id,
      startRef: passageRefs.startRef,
      endRef: passageRefs.endRef,
      role: passageRefs.role,
    })
    .from(passageRefs)
    .innerJoin(items, eq(items.id, passageRefs.sourceItemId))
    .where(
      and(
        eq(passageRefs.sourceItemId, itemId),
        eq(items.ownerId, ownerId),
        sql`${items.deletedAt} IS NULL`
      )
    )
    .orderBy(passageRefs.startRef, passageRefs.endRef);
  return rows;
}

// One item that references a passage overlapping the queried interval — the
// backlink row for the passage page. Body-free (the no-body-in-lists rule).
export type PassageBacklink = {
  itemId: string;
  title: string;
  type: string;
  startRef: number;
  endRef: number;
};

// Every owner's item whose passage edge overlaps [startRef, endRef] (ADR-143 pt
// 5 — this same overlap query IS the passage page and the backlinks). Overlap =
// stored.start <= queried.end AND stored.end >= queried.start. Owner-scoped +
// deleted/template excluded; one row per matching edge (the page groups by
// item). Sorted by the stored start so a chapter reads in order.
export async function itemsTouchingPassage(
  ownerId: string,
  passage: PassageRef
): Promise<PassageBacklink[]> {
  const rows = await getDb()
    .select({
      itemId: items.id,
      title: items.title,
      type: items.type,
      startRef: passageRefs.startRef,
      endRef: passageRefs.endRef,
    })
    .from(passageRefs)
    .innerJoin(items, eq(items.id, passageRefs.sourceItemId))
    .where(
      and(
        lte(passageRefs.startRef, passage.endRef),
        gte(passageRefs.endRef, passage.startRef),
        eq(items.ownerId, ownerId),
        sql`${items.deletedAt} IS NULL`,
        eq(items.isTemplate, false)
      )
    )
    .orderBy(passageRefs.startRef, passageRefs.endRef);
  return rows;
}

function refKey(r: { startRef: number; endRef: number }): string {
  return `${r.startRef}-${r.endRef}`;
}

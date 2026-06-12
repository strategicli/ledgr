// Related-items read path (slice 6): the query behind entity pages (PRD
// §4.2, "tag as dashboard") and the future backlinks panel (PRD §4.9). One
// both-directions pass over relations, owner-scoped, body-free, live items
// only. Both match states are returned with the flag carried per row:
// trusted lists keep only 'confirmed'; the UI renders 'suggested' rows
// dotted/grayed instead of hiding them.
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { ItemError, listColumns } from "@/lib/items";

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

// @-mention → relations sync (PRD §4.1: a mention creates a relation row
// automatically). A mention lives in the canonical markdown body as a link
// whose href is `ledgr://item/<id>` (ADR-037/ADR-040); on every body save the
// relation rows with role 'mention' are diffed against what the body actually
// contains, so removing a mention removes its edge. Rows with any other role
// (tags, manual links) are never touched here.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { bodyMarkdown } from "@/lib/body";
import { collectMentionIdsFromMarkdown } from "@/lib/editor/mention-markdown";

export const MENTION_ROLE = "mention";

// Every distinct item id mentioned in a body. Tolerant of the body shape via
// bodyMarkdown, then scans the markdown for the mention link's href.
export function collectMentionIds(body: unknown): string[] {
  return collectMentionIdsFromMarkdown(bodyMarkdown(body));
}

export async function syncMentionRelations(
  ownerId: string,
  itemId: string,
  body: unknown
): Promise<void> {
  const db = getDb();
  const mentioned = new Set(collectMentionIds(body));
  mentioned.delete(itemId); // self-mention carries no information

  const existing = await db
    .select({ id: relations.id, targetId: relations.targetId })
    .from(relations)
    .where(
      and(eq(relations.sourceId, itemId), eq(relations.role, MENTION_ROLE))
    );

  const stale = existing.filter((r) => !mentioned.has(r.targetId));
  if (stale.length > 0) {
    await db.delete(relations).where(
      inArray(
        relations.id,
        stale.map((r) => r.id)
      )
    );
  }

  const have = new Set(existing.map((r) => r.targetId));
  const missing = [...mentioned].filter((id) => !have.has(id));
  if (missing.length === 0) return;

  // Owner-scope the targets: a body can only create edges to the owner's
  // own items, and dangling ids (deleted targets) are dropped silently.
  const valid = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        inArray(items.id, missing),
        eq(items.ownerId, ownerId),
        sql`${items.deletedAt} IS NULL`
      )
    );
  if (valid.length === 0) return;

  await db
    .insert(relations)
    .values(
      valid.map((t) => ({
        sourceId: itemId,
        targetId: t.id,
        role: MENTION_ROLE,
      }))
    )
    .onConflictDoNothing();
}

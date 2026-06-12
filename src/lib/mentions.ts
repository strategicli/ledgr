// @-mention → relations sync (PRD §4.1: a mention creates a relation row
// automatically). Mentions live in the body as custom inline nodes
// ({ type: "mention", props: { itemId, title } }); on every body save the
// relation rows with role 'mention' are diffed against what the body
// actually contains, so removing a mention removes its edge. Rows with any
// other role (tags, manual links) are never touched here.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";

export const MENTION_ROLE = "mention";

type UnknownNode = {
  type?: unknown;
  props?: { itemId?: unknown };
  content?: unknown;
  children?: unknown;
  rows?: unknown;
  cells?: unknown;
};

// Defensive walk, same posture as body-text.ts: unknown node shapes must
// degrade, not throw.
function collect(node: unknown, out: Set<string>): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  const n = node as UnknownNode;
  if (n.type === "mention" && typeof n.props?.itemId === "string") {
    out.add(n.props.itemId);
  }
  collect(n.content, out);
  collect(n.rows, out);
  collect(n.cells, out);
  collect(n.children, out);
}

export function collectMentionIds(body: unknown): string[] {
  const out = new Set<string>();
  collect(body, out);
  return [...out];
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

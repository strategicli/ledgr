// Relative subtask recompute (S5, ADR-085) — the server half of
// relative-subtask.ts. When a task's scheduled date moves, re-derive every
// relative child's concrete scheduled date (parent date + stored offset),
// recursing down so offsets chain (a relative child's own relative children
// re-derive against the child's new date). Direct DB updates — NOT updateItem —
// to avoid re-entrancy; depth-capped like the other tree walks.
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { dateToYmdUtc, ymdToUtcDate } from "@/lib/recurrence";
import { applyOffset, relativeOffsetOf } from "@/lib/relative-subtask";

export async function recomputeRelativeChildren(
  ownerId: string,
  parentId: string,
  parentScheduledYmd: string | null,
  depth = 0
): Promise<void> {
  if (depth > 50) return;
  const children = await getDb()
    .select({
      id: items.id,
      properties: items.properties,
      scheduledDate: items.scheduledDate,
    })
    .from(items)
    .where(
      and(
        eq(items.parentId, parentId),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt)
      )
    );
  for (const child of children) {
    const offset = relativeOffsetOf(child.properties as Record<string, unknown> | null);
    if (offset === null) continue; // absolute-dated / undated child: left alone
    // No parent anchor (the parent lost its scheduled date) → the relative date
    // has nothing to hang on; clear it until the parent is dated again (the
    // offset stays, so it re-derives when the parent regains a date).
    const nextYmd = parentScheduledYmd ? applyOffset(parentScheduledYmd, offset) : null;
    const curYmd = child.scheduledDate ? dateToYmdUtc(child.scheduledDate) : null;
    if (curYmd !== nextYmd) {
      await getDb()
        .update(items)
        .set({ scheduledDate: nextYmd ? ymdToUtcDate(nextYmd) : null, updatedAt: new Date() })
        .where(and(eq(items.id, child.id), eq(items.ownerId, ownerId)));
    }
    // Recurse so a deeper relative level tracks this child's new date.
    await recomputeRelativeChildren(ownerId, child.id, nextYmd, depth + 1);
  }
}

// cloneItemSubtree — the one "deep-clone an item + its subtree, reset" primitive
// (ADR-076). Two callers share it: materializing a recurring occurrence
// (recurrence-service.ts) and the subtree-aware template apply (templates.ts,
// extending ADR-045). The crux from explorations/recurrence-model.md: each
// occurrence is cloned FROM THE PROTOTYPE, never copied from the just-completed
// (mutated) occurrence — otherwise checked subtasks and stale notes bleed
// forward. So the clone is always fresh: subtasks unchecked, body copied from the
// prototype, status reset to open, tags/relations carried, completion/recurrence
// metadata stripped.
//
// Owner-scoped throughout; rides createItem so clones get revisions + body_text/
// FTS + mention-sync for free, exactly like any other item create.
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { MENTION_ROLE } from "@/lib/mentions";
import {
  createItem,
  getItem,
  ItemError,
  type ItemStatus,
} from "@/lib/items";

// Property keys that are occurrence-specific machinery and must never ride a
// clone (a fresh occurrence is not recurring itself, carries no completion log,
// and has no Todoist link). Callers may strip more.
const ALWAYS_STRIP = ["recurrence", "occurrence", "todoist", "focus"];

export type CloneResetRules = {
  // Status for every cloned item; omitted = the type's not-started status (S2).
  status?: ItemStatus;
  // Re-create the prototype's outgoing non-mention edges from the clone
  // (default true): a 1:1's link to the person carries to each occurrence.
  // Mention edges are body-owned (ADR-015) and re-derive from the cloned body
  // on save, so they're never copied here.
  carryRelations?: boolean;
  // Extra property keys to drop on the clone, on top of ALWAYS_STRIP.
  stripPropertyKeys?: string[];
};

export type CloneOverrides = {
  parentId?: string | null;
  title?: string;
  scheduledDate?: Date | null;
  dueDate?: Date | null;
  inbox?: boolean;
  // Merged over the cloned (post-strip) properties — e.g. stamp occurrence meta.
  properties?: Record<string, unknown>;
};

function resetProperties(
  source: Record<string, unknown> | null,
  reset: CloneResetRules,
  override?: Record<string, unknown>
): Record<string, unknown> | null {
  const strip = new Set([...ALWAYS_STRIP, ...(reset.stripPropertyKeys ?? [])]);
  const out: Record<string, unknown> = {};
  if (source) {
    for (const [k, v] of Object.entries(source)) {
      if (!strip.has(k)) out[k] = v;
    }
  }
  if (override) Object.assign(out, override);
  return Object.keys(out).length ? out : null;
}

// Full rows (incl. body) of an item's live direct children, creation order —
// the clone walks top-down so it can reparent each level onto the new clone.
async function liveChildren(ownerId: string, parentId: string) {
  return getDb()
    .select()
    .from(items)
    .where(
      and(
        eq(items.parentId, parentId),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt)
      )
    )
    .orderBy(items.createdAt);
}

async function carryRelations(
  ownerId: string,
  sourceId: string,
  cloneId: string
) {
  const edges = await getDb()
    .select({ targetId: relations.targetId, role: relations.role })
    .from(relations)
    .where(eq(relations.sourceId, sourceId));
  for (const edge of edges) {
    if (edge.role === MENTION_ROLE) continue; // body-owned, re-derives on save
    if (edge.targetId === cloneId) continue;
    // Re-create the edge from the clone, preserving the role. Skip a target that
    // has since been trashed/removed rather than abort the whole clone.
    try {
      await getDb()
        .insert(relations)
        .values({ sourceId: cloneId, targetId: edge.targetId, role: edge.role })
        .onConflictDoNothing();
    } catch {
      /* tolerate a vanished target */
    }
  }
}

// Recursively clone `sourceId` and its subtree under `parentId`, applying the
// reset rules. Overrides apply to the ROOT clone only; descendants clone with
// the reset defaults. Returns the new root id and the total number of items
// created (root + descendants).
async function cloneNode(
  ownerId: string,
  sourceId: string,
  parentId: string | null,
  reset: CloneResetRules,
  overrides: CloneOverrides | null,
  depth: number
): Promise<{ rootId: string; count: number }> {
  if (depth > 50) throw new ItemError("bad_request", "clone subtree too deep");
  const src = await getItem(ownerId, sourceId);

  const created = await createItem(ownerId, {
    type: src.type,
    title: overrides?.title ?? src.title,
    body: src.body ?? null,
    // Omitted status → createItem picks the type's not-started default (S2).
    status: reset.status,
    dueDate: overrides ? overrides.dueDate ?? null : null,
    scheduledDate: overrides ? overrides.scheduledDate ?? null : null,
    urgency: src.urgency ?? null,
    url: src.url ?? null,
    parentId,
    properties: resetProperties(
      (src.properties as Record<string, unknown> | null) ?? null,
      reset,
      overrides?.properties
    ),
    inbox: overrides?.inbox ?? false,
  });

  if (reset.carryRelations !== false) {
    await carryRelations(ownerId, sourceId, created.id);
  }

  let count = 1;
  const children = await liveChildren(ownerId, sourceId);
  for (const child of children) {
    // Descendants get no overrides (they inherit the reset defaults); their own
    // due/scheduled dates are occurrence-relative and reset to none.
    const res = await cloneNode(ownerId, child.id, created.id, reset, null, depth + 1);
    count += res.count;
  }
  return { rootId: created.id, count };
}

export async function cloneItemSubtree(
  ownerId: string,
  sourceId: string,
  overrides: CloneOverrides = {},
  reset: CloneResetRules = {}
): Promise<{ rootId: string; count: number }> {
  return cloneNode(ownerId, sourceId, overrides.parentId ?? null, reset, overrides, 0);
}

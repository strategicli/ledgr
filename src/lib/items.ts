// Item CRUD (slice 4). Every function takes ownerId and scopes every query
// with it (CLAUDE.md working conventions). List queries never select body or
// body_text; bodies load only when an item is opened. Deletes are soft
// (deleted_at), cascade to children, and round-trip through restore; hard
// deletes happen only in purgeExpiredTrash (the 30-day purge job).
import {
  and,
  desc,
  eq,
  ilike,
  isNull,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/db";
import { items, revisions, types } from "@/db/schema";
import { extractBodyText } from "@/lib/body-text";
import { syncMentionRelations } from "@/lib/mentions";

// A new revision is skipped when the latest one is younger than this; the
// editor autosaves often (slice 5) and one snapshot per burst is enough
// (PRD §4.6 "debounced").
const REVISION_DEBOUNCE_MS = 5 * 60 * 1000;
const REVISION_CAP = 50;
const TRASH_RETENTION_DAYS = 30;

// Re-exported from item-enums.ts (client-safe home) so server callers keep
// one import site.
export {
  ITEM_STATUSES,
  URGENCIES,
  type ItemStatus,
  type Urgency,
} from "@/lib/item-enums";
import type { ItemStatus, Urgency } from "@/lib/item-enums";

// Routes map codes to HTTP statuses; messages are safe to return to the
// (single, authenticated) user.
export class ItemError extends Error {
  constructor(
    public code: "not_found" | "bad_request",
    message: string
  ) {
    super(message);
  }
}

export type ItemInput = {
  type: string;
  title?: string;
  body?: unknown;
  status?: ItemStatus;
  dueDate?: Date | null;
  urgency?: Urgency | null;
  meetingAt?: Date | null;
  url?: string | null;
  kind?: string | null;
  parentId?: string | null;
  properties?: Record<string, unknown> | null;
};

export type ItemPatch = Partial<ItemInput>;

export type ListOptions = {
  type?: string;
  status?: ItemStatus;
  kind?: string;
  parentId?: string;
  // Title substring match (powers the @-mention picker). Full-text search
  // over bodies is its own slice and uses the tsvector, not this.
  q?: string;
  trash?: boolean;
  limit?: number;
  offset?: number;
};

// Everything except body, body_text, search, owner_id. The body exclusion is
// a non-negotiable (CLAUDE.md rule 8); properties stays because table views
// render custom fields in lists. Exported so other list-shaped queries
// (related items, future views) select the exact same body-free set.
export const listColumns = {
  id: items.id,
  type: items.type,
  title: items.title,
  status: items.status,
  dueDate: items.dueDate,
  urgency: items.urgency,
  meetingAt: items.meetingAt,
  url: items.url,
  kind: items.kind,
  parentId: items.parentId,
  todoistId: items.todoistId,
  msEventId: items.msEventId,
  properties: items.properties,
  deletedAt: items.deletedAt,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
};

const itemColumns = { ...listColumns, body: items.body };

// Exposed as a query builder (not just results) so verification can assert
// the generated SQL carries owner_id and no body.
export function listItemsQuery(ownerId: string, opts: ListOptions = {}) {
  const where: SQL[] = [eq(items.ownerId, ownerId)];
  where.push(opts.trash ? isNotNull(items.deletedAt) : isNull(items.deletedAt));
  if (opts.type) where.push(eq(items.type, opts.type));
  if (opts.status) where.push(eq(items.status, opts.status));
  if (opts.kind) where.push(eq(items.kind, opts.kind));
  if (opts.parentId) where.push(eq(items.parentId, opts.parentId));
  if (opts.q) {
    where.push(ilike(items.title, `%${opts.q.replace(/[\\%_]/g, "\\$&")}%`));
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return getDb()
    .select(listColumns)
    .from(items)
    .where(and(...where))
    .orderBy(opts.trash ? desc(items.deletedAt) : desc(items.updatedAt))
    .limit(limit)
    .offset(Math.max(opts.offset ?? 0, 0));
}

export async function listItems(ownerId: string, opts: ListOptions = {}) {
  return listItemsQuery(ownerId, opts);
}

export async function getItem(ownerId: string, id: string) {
  const rows = await getDb()
    .select(itemColumns)
    .from(items)
    .where(and(eq(items.id, id), eq(items.ownerId, ownerId)));
  if (rows.length === 0) throw new ItemError("not_found", "item not found");
  return rows[0];
}

async function assertTypeExists(type: string) {
  const rows = await getDb()
    .select({ key: types.key })
    .from(types)
    .where(eq(types.key, type));
  if (rows.length === 0) {
    throw new ItemError("bad_request", `unknown type '${type}'`);
  }
}

// Parent must be the owner's own live item, and (on update) not the item
// itself or one of its descendants; a parent cycle would hang every
// recursive tree read, so it can never be writable.
async function assertValidParent(
  ownerId: string,
  parentId: string,
  selfId?: string
) {
  if (parentId === selfId) {
    throw new ItemError("bad_request", "an item cannot be its own parent");
  }
  const parent = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.id, parentId),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt)
      )
    );
  if (parent.length === 0) {
    throw new ItemError("bad_request", "parent item not found");
  }
  if (selfId) {
    // UNION (not UNION ALL) so existing bad data can't recurse forever.
    const res = await getDb().execute(sql`
      with recursive subtree as (
        select id from items where id = ${selfId} and owner_id = ${ownerId}
        union
        select i.id from items i join subtree s on i.parent_id = s.id
      )
      select 1 as hit from subtree where id = ${parentId}
    `);
    if (res.rows.length > 0) {
      throw new ItemError(
        "bad_request",
        "parent cannot be a descendant of the item"
      );
    }
  }
}

// Debounced snapshot + prune (PRD §4.6). force bypasses the debounce for
// moments that must be restorable no matter how recent the last snapshot is
// (e.g. the pre-restore body).
async function snapshotRevision(
  itemId: string,
  body: unknown,
  opts: { force?: boolean } = {}
) {
  const db = getDb();
  if (!opts.force) {
    const latest = await db
      .select({ createdAt: revisions.createdAt })
      .from(revisions)
      .where(eq(revisions.itemId, itemId))
      .orderBy(desc(revisions.createdAt))
      .limit(1);
    if (
      latest.length > 0 &&
      Date.now() - latest[0].createdAt.getTime() < REVISION_DEBOUNCE_MS
    ) {
      return;
    }
  }
  await db.insert(revisions).values({ itemId, body });
  await db.execute(sql`
    delete from revisions
    where item_id = ${itemId}
      and id not in (
        select id from revisions
        where item_id = ${itemId}
        order by created_at desc
        limit ${REVISION_CAP}
      )
  `);
}

export async function createItem(ownerId: string, input: ItemInput) {
  await assertTypeExists(input.type);
  if (input.parentId) await assertValidParent(ownerId, input.parentId);

  const body = input.body ?? null;
  const rows = await getDb()
    .insert(items)
    .values({
      ownerId,
      type: input.type,
      title: input.title ?? "",
      body,
      bodyText: extractBodyText(body),
      status: input.status ?? "open",
      dueDate: input.dueDate ?? null,
      urgency: input.urgency ?? null,
      meetingAt: input.meetingAt ?? null,
      url: input.url ?? null,
      kind: input.kind ?? null,
      parentId: input.parentId ?? null,
      properties: input.properties ?? null,
    })
    .returning(itemColumns);
  const created = rows[0];
  if (created.body != null) {
    await snapshotRevision(created.id, created.body);
    await syncMentionRelations(ownerId, created.id, created.body);
  }
  return created;
}

export async function updateItem(
  ownerId: string,
  id: string,
  patch: ItemPatch
) {
  const db = getDb();
  const existing = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.id, id), eq(items.ownerId, ownerId), isNull(items.deletedAt))
    );
  if (existing.length === 0) throw new ItemError("not_found", "item not found");

  if (patch.type !== undefined) await assertTypeExists(patch.type);
  if (patch.parentId != null) {
    await assertValidParent(ownerId, patch.parentId, id);
  }

  const set: Record<string, unknown> = {};
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.urgency !== undefined) set.urgency = patch.urgency;
  if (patch.meetingAt !== undefined) set.meetingAt = patch.meetingAt;
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  if (patch.properties !== undefined) set.properties = patch.properties;
  if (patch.body !== undefined) {
    set.body = patch.body;
    set.bodyText = extractBodyText(patch.body);
  }
  if (Object.keys(set).length === 0) {
    throw new ItemError("bad_request", "no fields to update");
  }

  const rows = await db
    .update(items)
    .set(set)
    .where(and(eq(items.id, id), eq(items.ownerId, ownerId)))
    .returning(itemColumns);
  const updated = rows[0];
  if (patch.body !== undefined) {
    if (updated.body != null) await snapshotRevision(id, updated.body);
    // Runs on null bodies too: clearing a body clears its mention edges.
    await syncMentionRelations(ownerId, id, updated.body);
  }
  return updated;
}

// Soft-deletes the item and every live descendant in one statement, all with
// the same deleted_at, so the unit restores together (PRD §4.6) and restore
// can match on the shared timestamp. UNION (not ALL) caps any pre-existing
// cycle.
export async function softDeleteItem(ownerId: string, id: string) {
  const res = await getDb().execute(sql`
    with recursive doomed as (
      select id from items
      where id = ${id} and owner_id = ${ownerId} and deleted_at is null
      union
      select i.id from items i join doomed d on i.parent_id = d.id
      where i.deleted_at is null
    )
    update items set deleted_at = now(), updated_at = now()
    where id in (select id from doomed)
    returning id
  `);
  if (res.rows.length === 0) throw new ItemError("not_found", "item not found");
  return { deleted: res.rows.length };
}

// Restores the deletion unit: the item plus descendants that went to Trash
// in the same soft-delete (matched on the shared deleted_at). A child that
// was already in Trash from an earlier, separate delete keeps its own
// timestamp and stays put.
export async function restoreItem(ownerId: string, id: string) {
  const res = await getDb().execute(sql`
    with recursive unit as (
      select id, deleted_at from items
      where id = ${id} and owner_id = ${ownerId} and deleted_at is not null
      union
      select i.id, i.deleted_at from items i join unit u on i.parent_id = u.id
      where i.deleted_at = u.deleted_at
    )
    update items set deleted_at = null, updated_at = now()
    where id in (select id from unit)
    returning id
  `);
  if (res.rows.length === 0) {
    throw new ItemError("not_found", "item not found in trash");
  }
  return { restored: res.rows.length };
}

// Metadata only; a revision's body is only ever read by restoreRevision.
export async function listRevisions(ownerId: string, itemId: string) {
  await getItem(ownerId, itemId); // ownership check
  return getDb()
    .select({ id: revisions.id, createdAt: revisions.createdAt })
    .from(revisions)
    .where(eq(revisions.itemId, itemId))
    .orderBy(desc(revisions.createdAt));
}

export async function restoreRevision(
  ownerId: string,
  itemId: string,
  revisionId: string
) {
  const db = getDb();
  const current = await getItem(ownerId, itemId);
  const rev = await db
    .select({ body: revisions.body })
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.itemId, itemId)));
  if (rev.length === 0) throw new ItemError("not_found", "revision not found");

  // The latest edits may have been debounced away; snapshot the pre-restore
  // body unconditionally so the restore itself is undoable.
  if (current.body != null) {
    await snapshotRevision(itemId, current.body, { force: true });
  }
  const body = rev[0].body;
  const rows = await db
    .update(items)
    .set({ body, bodyText: extractBodyText(body) })
    .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)))
    .returning(itemColumns);
  // The restored body's mentions are the live ones now.
  await syncMentionRelations(ownerId, itemId, body);
  return rows[0];
}

// The daily purge (machine job, not user-facing, so it intentionally runs
// across all owners). Children purge with their unit because cascade
// soft-delete stamped them with the same deleted_at; the detach UPDATE
// covers the one stray case, an item restored out of a unit whose parent
// then ages out, so the parent's hard delete can't hit an FK. Two
// statements without a transaction is acceptable: a detach that lands
// without its delete is retried by the next day's run.
export async function purgeExpiredTrash() {
  const db = getDb();
  const cutoff = sql`now() - make_interval(days => ${TRASH_RETENTION_DAYS})`;
  const detached = await db.execute(sql`
    update items set parent_id = null
    where parent_id in (select id from items where deleted_at < ${cutoff})
      and (deleted_at is null or deleted_at >= ${cutoff})
    returning id
  `);
  // relations/attachments/revisions rows go via ON DELETE CASCADE. (R2 bytes
  // for attachments will need their own cleanup when storage lands.)
  const purged = await db.execute(sql`
    delete from items where deleted_at < ${cutoff} returning id
  `);
  return { purged: purged.rows.length, detached: detached.rows.length };
}

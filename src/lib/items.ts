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
  inArray,
  isNull,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/db";
import { items, revisions, types } from "@/db/schema";
import { extractBodyText } from "@/lib/body-text";
import { bodyMarkdown, isItemBody } from "@/lib/body";
import { syncMentionRelations } from "@/lib/mentions";
import { dateToYmdUtc, parseRecurrence } from "@/lib/recurrence";
import { recomputeRelativeChildren } from "@/lib/relative-subtask-service";
import {
  appTodayYmd,
  completeMaterializedOccurrence,
  completeVirtualSeries,
  ensureFirstOccurrence,
  occurrenceSeriesId,
} from "@/lib/recurrence-service";
import { categoryOfStatus, defaultStatusKey, type StatusCategory } from "@/lib/status";
import { statusSchemaForType } from "@/lib/status-schema";

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
  // The planned date, distinct from the due-date deadline (native tasks,
  // ADR-073/076). Stored UTC-midnight like dueDate; auto-advances on completion
  // for a recurring task (see recurrence.ts / recurrence-service.ts).
  scheduledDate?: Date | null;
  urgency?: Urgency | null;
  meetingAt?: Date | null;
  // The date a note was actually taken (ADR-110), distinct from created_at /
  // updated_at. Stored UTC-midnight like dueDate. createItem defaults it to the
  // creation day for notes; user-editable thereafter.
  noteDate?: Date | null;
  url?: string | null;
  parentId?: string | null;
  properties?: Record<string, unknown> | null;
  // Untriaged flag (PRD §4.2 Inbox): arrival paths set it, triage clears it.
  inbox?: boolean;
  // Mark this item as template content (ADR-093). Set true to mint a template
  // prototype; children created under a template parent inherit it automatically
  // (see createItem), so callers only ever set it on the root prototype.
  isTemplate?: boolean;
};

export type ItemPatch = Partial<ItemInput> & {
  // Merge these keys into items.properties without touching the rest — an atomic
  // jsonb `||` in updateItem. Used by the per-property canvas cards (ADR-069),
  // where each card owns one property key and must not clobber its siblings.
  // Distinct from `properties`, which replaces the whole object wholesale.
  propertyPatch?: Record<string, unknown>;
};

export type ListOptions = {
  type?: string;
  status?: ItemStatus;
  // Restrict to a status category, or "active" (not_started + in_progress) — the
  // same set the task views use (see views.ts viewWhere). Lets the Inbox hide
  // completed/archived items so a finished-but-untriaged item drops out of view.
  statusCategory?: StatusCategory | "active";
  parentId?: string;
  inbox?: boolean;
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
  statusCategory: items.statusCategory,
  dueDate: items.dueDate,
  scheduledDate: items.scheduledDate,
  urgency: items.urgency,
  meetingAt: items.meetingAt,
  noteDate: items.noteDate,
  url: items.url,
  parentId: items.parentId,
  inbox: items.inbox,
  todoistId: items.todoistId,
  msEventId: items.msEventId,
  properties: items.properties,
  deletedAt: items.deletedAt,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
};

// getItem adds the body and the is_template flag (the canvas/banner + the
// clone/apply path need it; list queries deliberately don't carry it).
const itemColumns = { ...listColumns, body: items.body, isTemplate: items.isTemplate };

// Exposed as a query builder (not just results) so verification can assert
// the generated SQL carries owner_id and no body.
export function listItemsQuery(ownerId: string, opts: ListOptions = {}) {
  const where: SQL[] = [eq(items.ownerId, ownerId)];
  where.push(opts.trash ? isNotNull(items.deletedAt) : isNull(items.deletedAt));
  // Template prototypes (and their subtrees) never appear in a user-facing list,
  // Trash included (ADR-093). Their authoring path is the by-id canvas, not a
  // list.
  where.push(eq(items.isTemplate, false));
  if (opts.type) where.push(eq(items.type, opts.type));
  if (opts.status) where.push(eq(items.status, opts.status));
  if (opts.parentId) where.push(eq(items.parentId, opts.parentId));
  if (opts.inbox !== undefined) where.push(eq(items.inbox, opts.inbox));
  if (opts.statusCategory) {
    where.push(
      opts.statusCategory === "active"
        ? inArray(items.statusCategory, ["not_started", "in_progress"])
        : eq(items.statusCategory, opts.statusCategory)
    );
  }
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

// The nav badge (PRD §4.11): live untriaged items. Rides items_inbox_idx.
// Active-only so it matches the Inbox page (which hides done/archived): a
// finished item is no longer "awaiting triage", and completion clears the flag
// anyway (see updateItem). Pre-fix done items still carrying the flag are
// excluded here too, so the badge can't overcount the list.
export async function countInbox(ownerId: string): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.inbox, true),
        inArray(items.statusCategory, ["not_started", "in_progress"]),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  return rows[0].count;
}

// Live (non-deleted) item counts grouped by type, for the Build → Model Overview
// (ADR-063): which types are populated and which sit empty. Owner-scoped; a type
// with no live items is simply absent from the map (callers default to 0).
export async function itemCountsByType(
  ownerId: string
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ type: items.type, count: sql<number>`count(*)::int` })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    )
    .groupBy(items.type);
  return Object.fromEntries(rows.map((r) => [r.type, r.count]));
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
  // A soft-deleted type (ADR-058) is excluded: you can't create or retype an
  // item into a type that's sitting in Trash.
  const rows = await getDb()
    .select({ key: types.key })
    .from(types)
    .where(and(eq(types.key, type), isNull(types.deletedAt)));
  if (rows.length === 0) {
    throw new ItemError("bad_request", `unknown type '${type}'`);
  }
}

// Parent must be the owner's own live item, and (on update) not the item
// itself or one of its descendants; a parent cycle would hang every
// recursive tree read, so it can never be writable.
// Returns the parent's is_template flag so createItem can propagate it to the
// child (a child of a template prototype is itself template content, ADR-093).
async function assertValidParent(
  ownerId: string,
  parentId: string,
  selfId?: string
): Promise<boolean> {
  if (parentId === selfId) {
    throw new ItemError("bad_request", "an item cannot be its own parent");
  }
  const parent = await getDb()
    .select({ id: items.id, isTemplate: items.isTemplate })
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
  return parent[0].isTemplate;
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
  // is_template is set explicitly on a prototype root, else inherited from a
  // template parent (ADR-093), so a subtask under a prototype is template
  // content too without any caller doing anything special.
  const parentIsTemplate = input.parentId
    ? await assertValidParent(ownerId, input.parentId)
    : false;
  const isTemplate = input.isTemplate ?? parentIsTemplate;

  // Status is a key from the type's schema (S2). Default to the type's "not
  // started" status, and store its category alongside so the hot queries / the
  // done-checkbox / recurrence key off the indexed bucket.
  const schema = await statusSchemaForType(input.type);
  const statusKey = input.status ?? defaultStatusKey(schema, "not_started") ?? "open";
  const statusCat = categoryOfStatus(schema, statusKey);

  const body = input.body ?? null;
  const rows = await getDb()
    .insert(items)
    .values({
      ownerId,
      type: input.type,
      title: input.title ?? "",
      body,
      bodyText: extractBodyText(body),
      status: statusKey,
      statusCategory: statusCat,
      dueDate: input.dueDate ?? null,
      scheduledDate: input.scheduledDate ?? null,
      urgency: input.urgency ?? null,
      meetingAt: input.meetingAt ?? null,
      // A note's "date taken" defaults to the creation calendar day (in the app
      // timezone), stored UTC-midnight like scheduled/due (ADR-008/ADR-110).
      // User-editable afterward. Other types leave it null.
      noteDate:
        input.noteDate ??
        (input.type === "note"
          ? new Date(`${appTodayYmd()}T00:00:00.000Z`)
          : null),
      url: input.url ?? null,
      parentId: input.parentId ?? null,
      properties: input.properties ?? null,
      inbox: input.inbox ?? false,
      isTemplate,
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
    .select({
      id: items.id,
      status: items.status,
      statusCategory: items.statusCategory,
      type: items.type,
      body: items.body,
    })
    .from(items)
    .where(
      and(eq(items.id, id), eq(items.ownerId, ownerId), isNull(items.deletedAt))
    );
  if (existing.length === 0) throw new ItemError("not_found", "item not found");

  if (patch.type !== undefined) await assertTypeExists(patch.type);
  if (patch.parentId != null) {
    await assertValidParent(ownerId, patch.parentId, id);
  }

  // The category this status change moves into (if the patch changes status).
  // Statuses are user-defined (S2), so "completing" means moving INTO the done
  // category, not a literal "done" — resolved through the type's schema. Also
  // the value written to status_category alongside the status key.
  let nextCategory: StatusCategory | undefined;
  if (patch.status !== undefined) {
    const schema = await statusSchemaForType(patch.type ?? existing[0].type);
    nextCategory = categoryOfStatus(schema, patch.status);
  }

  // Recurrence-aware completion (ADR-076). Completing a recurring task is not a
  // plain status flip, so intercept the completing gesture before the normal
  // update. Runs for every caller (checkbox / MCP / REST) since they all land
  // here. Only fires when this patch moves the item into the done category.
  let materializedOccurrencePost = false;
  if (nextCategory === "done" && existing[0].statusCategory !== "done") {
    const current = await getItem(ownerId, id);
    const props = current.properties as Record<string, unknown> | null;
    const rule = parseRecurrence(props?.recurrence);
    if (rule) {
      // A recurring SERIES: advance to the next occurrence, don't mark it done.
      // Apply any other fields in the same patch first (completion is normally
      // status-only, but MCP/REST could send more), then advance from the
      // re-read row so the advance sees those edits.
      const { status: _done, ...rest } = patch;
      if (Object.keys(rest).length > 0) await updateItem(ownerId, id, rest);
      const fresh = await getItem(ownerId, id);
      const advanced = await completeVirtualSeries(ownerId, fresh);
      if (rule.occurrenceMode === "materialized") {
        await ensureFirstOccurrence(ownerId, id); // keep one live occurrence
      }
      return advanced;
    }
    if (occurrenceSeriesId(current)) {
      // A materialized occurrence child: complete it normally below, then
      // advance its parent series + clone the next occurrence.
      materializedOccurrencePost = true;
    }
  }

  // The body editor re-emits the loaded body once when it mounts (a programmatic
  // editor transaction, not a user edit), so merely opening an item PATCHes a
  // body byte-identical to what's stored. Detect that no-op: a body whose text
  // (and format, when both are well-formed bodies) matches the stored one isn't
  // written, so it can't move updated_at — the `$onUpdate` column bumps on every
  // UPDATE — or snapshot a redundant revision. This is the "viewing an item
  // changes its edit date" bug; the guard lives here so every caller (editor,
  // MCP, REST) is covered, not just the one client. A real format switch with
  // identical text still counts as a change.
  const prevBody = existing[0].body;
  const writeBody =
    patch.body !== undefined &&
    !(
      bodyMarkdown(patch.body) === bodyMarkdown(prevBody) &&
      (!isItemBody(prevBody) ||
        !isItemBody(patch.body) ||
        patch.body.format === prevBody.format)
    );

  const set: Record<string, unknown> = {};
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.statusCategory = nextCategory;
    // Completing an item triages it out of the Inbox (PRD §4.2): a finished task
    // is no longer "awaiting triage", so completion IS triage. Only on the
    // transition into done; an explicit `patch.inbox` below still wins. The
    // recurring-series case returns earlier (it advances, never completes), so
    // it never reaches here — correct, the series isn't done.
    if (nextCategory === "done" && existing[0].statusCategory !== "done") {
      set.inbox = false;
    }
  }
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.scheduledDate !== undefined) set.scheduledDate = patch.scheduledDate;
  if (patch.urgency !== undefined) set.urgency = patch.urgency;
  if (patch.meetingAt !== undefined) set.meetingAt = patch.meetingAt;
  if (patch.noteDate !== undefined) set.noteDate = patch.noteDate;
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  if (patch.properties !== undefined) set.properties = patch.properties;
  // Per-key merge (ADR-069): overwrite only these keys, keep the rest. Atomic at
  // the DB level (no read-modify-write race), and the generated search tsvector
  // recomputes from the merged jsonb automatically. Applied after `properties`
  // so a caller sending both lands on the merge (they're mutually exclusive in
  // practice — the canvas sends one or the other).
  if (patch.propertyPatch !== undefined) {
    set.properties = sql`coalesce(${items.properties}, '{}'::jsonb) || ${JSON.stringify(
      patch.propertyPatch
    )}::jsonb`;
  }
  if (patch.inbox !== undefined) set.inbox = patch.inbox;
  if (writeBody) {
    set.body = patch.body;
    set.bodyText = extractBodyText(patch.body);
  }
  if (Object.keys(set).length === 0) {
    // A patch that carried only a no-op body (the editor's on-open phantom
    // save) leaves nothing to write: return the item untouched rather than
    // bumping updated_at. A patch with no recognized fields at all is still
    // a client error.
    if (patch.body !== undefined) return await getItem(ownerId, id);
    throw new ItemError("bad_request", "no fields to update");
  }

  const rows = await db
    .update(items)
    .set(set)
    .where(and(eq(items.id, id), eq(items.ownerId, ownerId)))
    .returning(itemColumns);
  const updated = rows[0];
  if (writeBody) {
    if (updated.body != null) await snapshotRevision(id, updated.body);
    // Runs on null bodies too: clearing a body clears its mention edges.
    await syncMentionRelations(ownerId, id, updated.body);
  }
  // A scheduled-date change re-derives any relative subtasks (S5, ADR-085):
  // each carries an offset from this parent's scheduled day, so moving the
  // parent shifts them (and chains down). Only when scheduled actually changed.
  if (patch.scheduledDate !== undefined) {
    await recomputeRelativeChildren(
      ownerId,
      id,
      updated.scheduledDate ? dateToYmdUtc(updated.scheduledDate) : null
    );
  }
  // A materialized occurrence was just completed: advance its parent series and
  // clone the next occurrence (create-next-after-completion). Done after the
  // child's own update so the child is firmly `done` history first.
  if (materializedOccurrencePost) {
    await completeMaterializedOccurrence(ownerId, updated);
  }
  // Setting a materialized recurrence rule creates the first live occurrence
  // (idempotent — a no-op if not materialized or one already exists).
  const touchedRecurrence =
    (patch.propertyPatch && "recurrence" in patch.propertyPatch) ||
    (patch.properties != null && "recurrence" in patch.properties);
  if (touchedRecurrence) {
    await ensureFirstOccurrence(ownerId, id).catch(() => {});
  }
  return updated;
}

// Toggle a task's completion from a checkbox (S2). Statuses are user-defined, so
// a checkbox can't hardcode "done"/"open": resolve the item's type schema and
// flip between its default done and not-started status. Routes through updateItem
// so recurrence-complete fires when moving into the done category.
export async function toggleItemDone(ownerId: string, id: string) {
  const item = await getItem(ownerId, id);
  const schema = await statusSchemaForType(item.type);
  const next =
    item.statusCategory === "done"
      ? defaultStatusKey(schema, "not_started") ?? "open"
      : defaultStatusKey(schema, "done") ?? "done";
  return updateItem(ownerId, id, { status: next });
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
    returning id, type
  `);
  if (res.rows.length === 0) {
    throw new ItemError("not_found", "item not found in trash");
  }
  // An active item can't reference a soft-deleted type (ADR-058): if restoring
  // these items revived something whose type is in Trash, revive the type too.
  const restoredTypes = Array.from(
    new Set(res.rows.map((r) => (r as { type: string }).type))
  );
  if (restoredTypes.length > 0) {
    await getDb()
      .update(types)
      .set({ deletedAt: null })
      .where(and(inArray(types.key, restoredTypes), isNotNull(types.deletedAt)));
  }
  return { restored: res.rows.length };
}

// Metadata only; a revision's body is read by getRevision / restoreRevision.
export async function listRevisions(ownerId: string, itemId: string) {
  await getItem(ownerId, itemId); // ownership check
  return getDb()
    .select({ id: revisions.id, createdAt: revisions.createdAt })
    .from(revisions)
    .where(eq(revisions.itemId, itemId))
    .orderBy(desc(revisions.createdAt));
}

// One revision's markdown text, for the "Show changes" diff. Owner-scoped via
// the item (the by-id read path, like getItem — not the list path, so it can
// load a body). Returns the canonical text; a foreign/legacy body degrades to
// "" through bodyMarkdown rather than throwing.
export async function getRevision(
  ownerId: string,
  itemId: string,
  revisionId: string
) {
  await getItem(ownerId, itemId); // ownership check
  const rev = await getDb()
    .select({ id: revisions.id, body: revisions.body, createdAt: revisions.createdAt })
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.itemId, itemId)));
  if (rev.length === 0) throw new ItemError("not_found", "revision not found");
  return {
    id: rev[0].id,
    createdAt: rev[0].createdAt,
    text: bodyMarkdown(rev[0].body),
  };
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
  // Soft-deleted types past the window are hard-purged too (ADR-058). Their
  // items were trashed in the same operation, so they've just been purged above
  // — the FK is now clear. The type's templates cascade with the row.
  const purgedTypes = await db.execute(sql`
    delete from types where deleted_at < ${cutoff} returning key
  `);
  return {
    purged: purged.rows.length,
    detached: detached.rows.length,
    purgedTypes: purgedTypes.rows.length,
  };
}

// Item reads (slice 4): search/list/get query builders, plus revision reads.
// Every function takes ownerId and scopes every query with it (CLAUDE.md
// working conventions). List queries never select body or body_text; bodies
// load only when an item is opened. Writes (create/update/delete/restore,
// type moves, the recurrence-completion machinery) live in item-mutations.ts
// — split out so this file stays a pure, DB-light read surface. That split is
// one-directional (item-mutations.ts imports from here, never the reverse) to
// avoid a circular import; item-mutations.ts re-exports nothing back through
// this file, so callers that need a write import it directly.
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
import { items, revisions } from "@/db/schema";
import { bodyMarkdown } from "@/lib/body";
import type { StatusCategory } from "@/lib/status";

// Re-exported from item-enums.ts (client-safe home) so server callers keep
// one import site.
export {
  ITEM_STATUSES,
  URGENCIES,
  type ItemStatus,
  type Urgency,
} from "@/lib/item-enums";
import type { ItemStatus } from "@/lib/item-enums";

// Routes map codes to HTTP statuses; messages are safe to return to the
// (single, authenticated) user.
export class ItemError extends Error {
  constructor(
    public code: "not_found" | "bad_request" | "conflict",
    message: string
  ) {
    super(message);
  }
}

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
// clone/apply path need it; list queries deliberately don't carry it). The
// record-page-only fields (Next Action, the widget composition override) ride
// here too — read when an item is opened, never in lists (ADR-111/PJ2).
// Exported: item-mutations.ts reuses this exact shape for its own
// `.returning()` calls, so a create/update echoes the same row shape a read
// would see.
export const itemColumns = {
  ...listColumns,
  body: items.body,
  isTemplate: items.isTemplate,
  nextActionTaskId: items.nextActionTaskId,
  nextActionText: items.nextActionText,
  composition: items.composition,
};

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
  // Escape ILIKE wildcards once: reused by the substring filter and the
  // prefix-match ordering term below.
  const escapedQ = opts.q?.replace(/[\\%_]/g, "\\$&");
  if (opts.q) {
    where.push(ilike(items.title, `%${escapedQ}%`));
  }

  // Recency alone (updated_at desc) structurally buries short, rarely-edited
  // titles (a person "First Last") under long, often-edited ones that merely
  // contain the words. When there's a query, rank by match quality first:
  // exact title, then prefix, then pg_trgm full-string similarity (which
  // penalizes the extra trigrams in a longer title, so the closer/shorter
  // title wins), with recency only as the final tiebreak. word_similarity
  // would score ~1.0 for any title *containing* the words, so it can't make
  // this distinction — full-string similarity() is deliberate.
  const orderBy: SQL[] = [];
  if (opts.q) {
    orderBy.push(
      sql`(lower(${items.title}) = lower(${opts.q})) desc`,
      sql`(${items.title} ilike ${`${escapedQ}%`}) desc`,
      sql`similarity(lower(${items.title}), lower(${opts.q})) desc`
    );
  }
  orderBy.push(opts.trash ? desc(items.deletedAt) : desc(items.updatedAt));

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return getDb()
    .select(listColumns)
    .from(items)
    .where(and(...where))
    .orderBy(...orderBy)
    .limit(limit)
    .offset(Math.max(opts.offset ?? 0, 0));
}

export async function listItems(ownerId: string, opts: ListOptions = {}) {
  return listItemsQuery(ownerId, opts);
}

// The body-free row shape every list-shaped query returns (listColumns). Named
// so other list-shaped readers (the dashboard nested-widget child fetch) can
// type their results against the same set.
export type ItemListRow = Awaited<ReturnType<typeof listItems>>[number];

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

// Just the item's updated_at (ADR-134), for the canvas's refresh-on-focus check:
// the open editor re-reads this when its tab regains focus and, if it moved past
// what the client last saw, surfaces a "changed on another device" banner. A
// deliberately tiny read (one timestamp, no body) so polling it on focus is
// effectively free; owner-scoped and excludes Trash like every other read.
export async function getItemVersion(
  ownerId: string,
  id: string
): Promise<{ updatedAt: Date }> {
  const rows = await getDb()
    .select({ updatedAt: items.updatedAt })
    .from(items)
    .where(
      and(eq(items.id, id), eq(items.ownerId, ownerId), isNull(items.deletedAt))
    );
  if (rows.length === 0) throw new ItemError("not_found", "item not found");
  return rows[0];
}

// Metadata only; a revision's body is read by getRevision / restoreRevision
// (the latter in item-mutations.ts).
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

// Item writes (slice 4, split from items.ts): create/update/delete/restore,
// type moves, and the recurrence-completion machinery that hangs off
// completing a task. Every function takes ownerId and scopes every query
// with it (CLAUDE.md working conventions). Deletes are soft (deleted_at),
// cascade to children, and round-trip through restore; hard deletes happen
// only in purgeExpiredTrash (the 30-day purge job).
//
// Imports from items.ts one-way only (getItem, itemColumns, ItemError) —
// items.ts never imports from here, so there's no cycle. Callers that need a
// write import it from here directly (not re-exported through items.ts).
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations, revisions, types } from "@/db/schema";
import {
  bodyDigest,
  bodyMarkdown,
  isItemBody,
  isLargeBody,
  MARKDOWN_FORMAT,
  type ItemBody,
} from "@/lib/body";
import { extractBodyText } from "@/lib/body-text";
// Type-only (erased at runtime): types.ts imports ItemError from items.ts, so
// a value import of getType would form a circular dependency. getType is
// loaded dynamically inside moveItemType instead.
import type { PropertyDef } from "@/lib/types";
import { getItem, itemColumns, ItemError, type ItemStatus, type Urgency } from "@/lib/items";
import { syncMentionRelations } from "@/lib/mentions";
import { syncPassageRefs } from "@/lib/passages/refs";
import { dateToYmdUtc, parseRecurrence } from "@/lib/recurrence";
import { recomputeRelativeChildren } from "@/lib/relative-subtask-service";
import {
  appTodayYmd,
  completeMaterializedOccurrence,
  completeVirtualSeries,
  ensureFirstOccurrence,
  occurrenceSeriesId,
} from "@/lib/recurrence-service";
import {
  categoryOfStatus,
  defaultStatusKey,
  initialStatusKey,
  type StatusCategory,
} from "@/lib/status";
import { statusSchemaForType } from "@/lib/status-schema";
import { emitActivity, homeParentOf, isTrackedSubjectType } from "@/lib/activity";

// A new revision is skipped when the latest one is younger than this; the
// editor autosaves often (slice 5) and one snapshot per burst is enough
// (PRD §4.6 "debounced").
const REVISION_DEBOUNCE_MS = 5 * 60 * 1000;
const REVISION_CAP = 50;
// Large bodies (ADR-125) snapshot far less and keep fewer copies: a multi-MB
// document edited at the normal cap could pile up 50× its size in history and
// pressure Neon's storage. A longer debounce + smaller cap bound that to a
// sane fraction while still leaving real restore points. Small bodies are
// unaffected (the common case keeps the original behavior exactly).
const LARGE_REVISION_DEBOUNCE_MS = 60 * 60 * 1000;
const LARGE_REVISION_CAP = 10;
const TRASH_RETENTION_DAYS = 30;

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
  // Next Action (ADR-111/PJ2): a pinned task pointer and/or free text. Edited
  // by the Next Action widget (PJ6); auto-advances on completion of the pinned
  // task. nextActionTaskId is an item id (a task) or null.
  nextActionTaskId?: string | null;
  nextActionText?: string | null;
  // Per-record widget composition override (Layer 3, ADR-111/PJ2). Raw jsonb at
  // this layer; validated/used by the widget canvas (PJ3/PJ4). null = inherit
  // the type default.
  composition?: Record<string, unknown> | null;
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
  // Cross-device edit guard (ADR-134): the bodyDigest of the body this client
  // last synced with. When present alongside a `body` write, updateItem refuses
  // the write (409 conflict) if the stored body no longer matches — i.e. another
  // device changed the body since this client loaded it, so this stale full-body
  // PATCH would silently clobber it. Optional: a caller that omits it keeps the
  // old last-write-wins behavior (MCP, batch ops, the field-only writers).
  expectedBodyDigest?: string;
};

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
  // A large body throttles harder and keeps fewer snapshots (ADR-125), so a
  // multi-MB document's history can't balloon storage; small bodies keep the
  // original 5-minute / 50-snapshot behavior unchanged.
  const large = isLargeBody(bodyMarkdown(body));
  const debounceMs = large ? LARGE_REVISION_DEBOUNCE_MS : REVISION_DEBOUNCE_MS;
  const cap = large ? LARGE_REVISION_CAP : REVISION_CAP;
  if (!opts.force) {
    const latest = await db
      .select({ createdAt: revisions.createdAt })
      .from(revisions)
      .where(eq(revisions.itemId, itemId))
      .orderBy(desc(revisions.createdAt))
      .limit(1);
    if (
      latest.length > 0 &&
      Date.now() - latest[0].createdAt.getTime() < debounceMs
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
        limit ${cap}
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
  const statusKey = input.status ?? initialStatusKey(schema);
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
    await syncPassageRefs(ownerId, created.id, created.body);
  }
  // Activity log (ADR-111): a tracked record (a project) being born is the first
  // line of its own timeline. Best-effort — a failed log line never breaks the
  // create.
  if (!isTemplate && isTrackedSubjectType(created.type)) {
    await emitActivity({
      ownerId,
      subjectId: created.id,
      kind: "record_created",
      summary: `Created ${created.title || "untitled"}`,
      payload: { type: created.type },
    }).catch(() => {});
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

  // Cross-device edit guard (ADR-134): a real body write that carries an
  // expectedBodyDigest must match the body it's overwriting. If the stored body
  // has moved on (another device saved since this client loaded), this is a
  // stale full-body PATCH that would silently clobber that edit — refuse it so
  // the client can surface the conflict and let the user choose. Content-based
  // (the body, not items.updated_at) on purpose: it ignores sibling writes to
  // status/properties/etc. on the same item, so editing a field on one device
  // never trips a false body conflict on another. The phantom on-open save is a
  // no-op (writeBody false) and never reaches here, so opening an item can't
  // conflict; only a genuine body change does.
  if (
    writeBody &&
    patch.expectedBodyDigest !== undefined &&
    patch.expectedBodyDigest !== bodyDigest(prevBody)
  ) {
    throw new ItemError(
      "conflict",
      "this item's body changed on another device since you opened it"
    );
  }

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
  if (patch.nextActionTaskId !== undefined)
    set.nextActionTaskId = patch.nextActionTaskId;
  if (patch.nextActionText !== undefined)
    set.nextActionText = patch.nextActionText;
  if (patch.composition !== undefined) set.composition = patch.composition;
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
    // Same contract for passage @/refs — the passage_refs sibling of mentions.
    await syncPassageRefs(ownerId, id, updated.body);
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
  // Activity log (ADR-111). Two independent lines, both best-effort:
  // (1) a tracked record's OWN status change narrates itself;
  // (2) a contained item moving into the done category narrates its home parent
  //     (a task finishing shows on its project's timeline). Inbox items with no
  //     tracked home parent log nothing — keeps the log a project narrative.
  const statusChanged =
    set.status !== undefined && existing[0].status !== patch.status;
  if (statusChanged && isTrackedSubjectType(updated.type)) {
    await emitActivity({
      ownerId,
      subjectId: updated.id,
      kind: "status_changed",
      summary: `Status → ${updated.status}`,
      payload: { from: existing[0].status, to: updated.status },
    }).catch(() => {});
  }
  if (nextCategory === "done" && existing[0].statusCategory !== "done") {
    const parent = await homeParentOf(ownerId, updated.id).catch(() => null);
    if (parent && isTrackedSubjectType(parent.type)) {
      await emitActivity({
        ownerId,
        subjectId: parent.id,
        actorId: updated.id,
        kind: "task_completed",
        summary: `Completed “${updated.title || "untitled"}”`,
        payload: { childType: updated.type },
      }).catch(() => {});
      // Next Action auto-advance (ADR-111/PJ5): if the completed task is the
      // home parent's pinned Next Action, advance to the next open contained
      // task (ordered by creation), else clear it. Direct write — not through
      // updateItem — to avoid re-entrancy and an extra status_changed line.
      await advanceNextActionIfPinned(ownerId, parent.id, updated.id).catch(() => {});
    }
  }
  return updated;
}

// The reconciliation summary for a type move (ADR-132). `carried` properties
// exist on both the source and target type and keep rendering as fields;
// `surfaced` properties are declared on the source type but not the target, so
// their values are written into the body as a YAML block (and retained in
// items.properties as a recoverable backup). `relationCount` is the user's
// intentional relations (mention edges excluded) — all kept, untouched.
export type MoveTypeSummary = {
  from: string; // source type label
  to: string; // target type label
  carried: string[]; // property labels that carry over
  surfaced: string[]; // property labels written into the body
  relationCount: number;
};

// A YAML scalar for a property value — human-readable and editable, not a strict
// serializer. Strings/numbers/booleans render bare; arrays/objects fall back to
// compact JSON so nothing is silently dropped.
function yamlScalar(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

// The fenced YAML block prepended to a body when a move orphans properties. Keyed
// by property key (machine-stable), captioned with the former type so the reader
// knows where it came from.
function propertiesYamlBlock(
  fromLabel: string,
  defs: PropertyDef[],
  props: Record<string, unknown>
): string {
  const lines = defs.map((d) => `${d.key}: ${yamlScalar(props[d.key])}`);
  return ["```yaml", `# carried over from ${fromLabel}`, ...lines, "```"].join("\n");
}

// Move an item to another type (ADR-132). The data layer already lets updateItem
// change `type`; this adds the property reconciliation around it so nothing is
// lost. Only the SOURCE type's own declared properties are reconciled: keys it
// shares with the target carry over untouched; keys the target lacks are surfaced
// into the body as a YAML block. System keys (locked, recurrence, sync ids) and
// anything not on the type schema stay in items.properties untouched and are
// never surfaced. Relation-kind properties hold no jsonb value (their value is
// the relation edges, which always survive), so they're skipped. Values are
// RETAINED in jsonb, so a move back re-renders the original fields.
//
// `dryRun` computes and returns the summary without writing — the same code path
// that powers the dialog's preview, so the preview can never drift from the
// commit. Owner-scoped throughout.
export async function moveItemType(
  ownerId: string,
  id: string,
  targetType: string,
  opts: { dryRun?: boolean } = {}
): Promise<{ summary: MoveTypeSummary; item?: Awaited<ReturnType<typeof getItem>> }> {
  const item = await getItem(ownerId, id); // owner-scoped; throws not_found
  if (item.type === targetType) {
    throw new ItemError("bad_request", "item is already that type");
  }
  await assertTypeExists(targetType); // bad_request for a missing/trashed type

  // Dynamic import breaks the items.ts <-> types.ts value cycle (types.ts imports
  // ItemError from there). Both type defs are best-effort: an unregistered type
  // simply contributes no property schema.
  const { getType } = await import("@/lib/types");
  const fromDef = await getType(item.type).catch(() => null);
  const toDef = await getType(targetType).catch(() => null);
  const toKeys = new Set((toDef?.propertySchema ?? []).map((p) => p.key));
  const props = (item.properties as Record<string, unknown> | null) ?? {};

  const carriedDefs: PropertyDef[] = [];
  const surfacedDefs: PropertyDef[] = [];
  for (const pdef of fromDef?.propertySchema ?? []) {
    const v = props[pdef.key];
    if (v == null || v === "") continue; // unset on this item — nothing to move
    if (pdef.kind === "relation") continue; // value is edges, not jsonb; edges stay
    (toKeys.has(pdef.key) ? carriedDefs : surfacedDefs).push(pdef);
  }

  // Intentional relations only (mention edges are body-owned and re-sync from the
  // body), counted across both directions.
  const relRows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(relations)
    .where(
      and(
        or(eq(relations.sourceId, id), eq(relations.targetId, id)),
        ne(relations.role, "mention")
      )
    );

  const summary: MoveTypeSummary = {
    from: fromDef?.label ?? item.type,
    to: toDef?.label ?? targetType,
    carried: carriedDefs.map((p) => p.label),
    surfaced: surfacedDefs.map((p) => p.label),
    relationCount: relRows[0]?.n ?? 0,
  };
  if (opts.dryRun) return { summary };

  // Surface orphaned properties at the top of the body (decided: visible +
  // copyable). updateItem snapshots a revision when the body changes, so the
  // pre-move state stays restorable; values are also retained in jsonb.
  let bodyPatch: ItemBody | undefined;
  if (surfacedDefs.length > 0) {
    const block = propertiesYamlBlock(summary.from, surfacedDefs, props);
    const current = bodyMarkdown(item.body);
    const format = isItemBody(item.body) ? item.body.format : MARKDOWN_FORMAT;
    bodyPatch = { format, text: current ? `${block}\n\n${current}` : block };
  }

  const updated = await updateItem(ownerId, id, {
    type: targetType,
    ...(bodyPatch ? { body: bodyPatch } : {}),
  });
  return { summary, item: updated };
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

// If `taskId` is the pinned Next Action on `parentId`, advance the pin to the
// next open contained (home) task ordered by creation, else clear it (ADR-111).
// A direct, owner-scoped write so it can run inside updateItem without recursion.
async function advanceNextActionIfPinned(
  ownerId: string,
  parentId: string,
  taskId: string
) {
  const db = getDb();
  const parent = await db
    .select({ next: items.nextActionTaskId })
    .from(items)
    .where(and(eq(items.id, parentId), eq(items.ownerId, ownerId)));
  if (parent.length === 0 || parent[0].next !== taskId) return;
  const nextRows = await db
    .select({ id: items.id })
    .from(items)
    .innerJoin(
      relations,
      and(
        eq(relations.sourceId, items.id),
        eq(relations.targetId, parentId),
        eq(relations.home, true),
        eq(relations.matchState, "confirmed")
      )
    )
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "task"),
        isNull(items.deletedAt),
        eq(items.isTemplate, false),
        inArray(items.statusCategory, ["not_started", "in_progress"]),
        ne(items.id, taskId)
      )
    )
    .orderBy(items.createdAt)
    .limit(1);
  await db
    .update(items)
    .set({ nextActionTaskId: nextRows[0]?.id ?? null })
    .where(and(eq(items.id, parentId), eq(items.ownerId, ownerId)));
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
  // The restored body's mentions + passage refs are the live ones now.
  await syncMentionRelations(ownerId, itemId, body);
  await syncPassageRefs(ownerId, itemId, body);
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

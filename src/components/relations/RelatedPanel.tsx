// Related panel (slice 15, PRD §4.9): every item's detail page shows what
// links here — both-direction relations, grouped by type. Server component;
// the query is body-free and owner-scoped (src/lib/relations.ts). The rows are
// interactive (ADR-055): related tasks check off and edit their due date in
// place, so this one panel is the actionable "tag as dashboard" surface that
// used to be the entity-only EmbeddedView. Suggested edges (Phase 2 matchers)
// render grayed with confirm/reject; mention-only rows carry an @ marker and
// no remove control, because the body owns those edges.
//
// Typed relation fields (ADR-067 R4): when this item's type declares relation
// properties (Author, Attendees), their links surface first under the field
// label as a section heading — the authoritative set is the outgoing edges
// whose role is the field key. Those items are then omitted from the plain
// type grouping below so they aren't listed twice. Everything else groups by
// type as before, with `unmarked` create-on-miss items under their glyph,
// sorted last.
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { items, types } from "@/db/schema";
import { MENTION_ROLE } from "@/lib/mentions";
import {
  listRelatedItems,
  outgoingRelationsByRole,
  type RelatedItem,
} from "@/lib/relations";
import { compareTypeKeys } from "@/lib/type-order";
import { getType } from "@/lib/types";
import InlineLabel from "@/components/build/InlineLabel";
import AddRelation from "./AddRelation";
import NewRelatedTask from "./NewRelatedTask";
import { type RelatedRowItem } from "./RelatedRow";
import RelatedPanelClient, {
  type RelatedGroup,
  type RelatedRowDescriptor,
} from "./RelatedPanelClient";

const UNMARKED = "unmarked";

export default async function RelatedPanel({
  ownerId,
  itemId,
  // Rendered as a grid card (ADR-069): drop the CanvasSection card chrome and the
  // centered column so the grid's own card wraps it.
  bare = false,
}: {
  ownerId: string;
  itemId: string;
  bare?: boolean;
}) {
  const [related, typeRows, hostRows] = await Promise.all([
    listRelatedItems(ownerId, itemId),
    getDb().select({ key: types.key, label: types.label }).from(types),
    getDb()
      .select({ type: items.type })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId))),
  ]);

  // The add affordances ride along whether or not anything is linked yet.
  const addBar = (
    <div className="flex flex-wrap items-center gap-1">
      <AddRelation itemId={itemId} />
      <NewRelatedTask hostId={itemId} />
    </div>
  );

  // Nothing linked yet: just the quiet add affordances, no section chrome.
  if (related.length === 0) {
    return bare ? (
      <>{addBar}</>
    ) : (
      <div className="mx-auto w-full max-w-3xl px-2 pt-2 sm:px-8 md:px-12">{addBar}</div>
    );
  }

  const labels = new Map(typeRows.map((t) => [t.key, t.label]));

  // This item's type → its relation fields (role sections). outgoingRelationsByRole
  // is the authoritative per-field set (edges FROM this item with role = key),
  // unlike the direction-blind roles[] on each related row.
  const hostType = hostRows[0]?.type;
  const hostDef = hostType ? await getType(hostType).catch(() => null) : null;
  const relationFields = (hostDef?.propertySchema ?? []).filter(
    (p) => p.kind === "relation"
  );
  const byRole = relationFields.length
    ? await outgoingRelationsByRole(
        ownerId,
        itemId,
        relationFields.map((f) => f.key)
      )
    : new Map<string, { id: string }[]>();

  const relatedById = new Map(related.map((r) => [r.id, r]));

  // Typed relation fields (Attending, References) now render under the Properties
  // panel (the canvas redesign), so claim their items here to keep them from
  // repeating down in Linked here. An item appears once: as its field above.
  const claimed = new Set<string>();
  for (const f of relationFields) {
    for (const t of byRole.get(f.key) ?? []) {
      if (relatedById.has(t.id)) claimed.add(t.id);
    }
  }

  // Everything not claimed by a field section, grouped by type; unmarked last.
  const byType = new Map<string, RelatedItem[]>();
  for (const item of related) {
    if (claimed.has(item.id)) continue;
    const group = byType.get(item.type);
    if (group) group.push(item);
    else byType.set(item.type, [item]);
  }
  const typeGroups = [...byType.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === UNMARKED) return 1;
    if (b === UNMARKED) return -1;
    return compareTypeKeys(a, b);
  });

  const buildRow = (item: RelatedItem, removalRole?: string): RelatedRowDescriptor => {
    const row: RelatedRowItem = {
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      statusCategory: item.statusCategory,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      updatedAt: item.updatedAt.toISOString(),
    };
    return {
      item: row,
      suggested: item.matchState === "suggested",
      mention: item.roles.includes(MENTION_ROLE),
      mentionOnly: item.roles.every((r) => r === MENTION_ROLE),
      removalRole,
      done: item.statusCategory === "done",
    };
  };

  const visibleCount = [...byType.values()].reduce((n, g) => n + g.length, 0);
  // Everything that links here is already a typed field (shown under Properties);
  // nothing to list, so just offer the quiet add affordances.
  if (visibleCount === 0) {
    return bare ? (
      <>{addBar}</>
    ) : (
      <div className="mx-auto w-full max-w-3xl px-2 pt-2 sm:px-8 md:px-12">{addBar}</div>
    );
  }

  // Inbound links grouped by type (unmarked under its glyph); typed relation
  // fields are excluded — they live under Properties. The header label is
  // rendered here (server) and handed to the client shell, which owns the
  // show/hide-completed toggle and the visible counts.
  const groups: RelatedGroup[] = typeGroups.map((key) => ({
    key,
    header: <InlineLabel typeKey={key} label={labels.get(key) ?? key} />,
    rows: byType.get(key)!.map((item) => buildRow(item)),
  }));

  return (
    <RelatedPanelClient hostId={itemId} groups={groups} addBar={addBar} bare={bare} />
  );
}

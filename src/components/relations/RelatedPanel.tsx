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
import RelatedRow, { type RelatedRowItem } from "./RelatedRow";

const UNMARKED = "unmarked";

export default async function RelatedPanel({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
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
    return <div className="mx-auto w-full max-w-3xl px-12 pt-2">{addBar}</div>;
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

  // Field sections in schema order; claim their ids so the type grouping skips
  // them (an item only appears once, under the first field that names it).
  const claimed = new Set<string>();
  const fieldSections = relationFields
    .map((f) => {
      const rows = (byRole.get(f.key) ?? [])
        .map((t) => relatedById.get(t.id))
        .filter((r): r is RelatedItem => !!r && !claimed.has(r.id));
      for (const r of rows) claimed.add(r.id);
      return { field: f, rows };
    })
    .filter((s) => s.rows.length > 0);

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

  const renderRow = (item: RelatedItem, removalRole?: string) => {
    const row: RelatedRowItem = {
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      updatedAt: item.updatedAt.toISOString(),
    };
    return (
      <RelatedRow
        key={item.id}
        hostId={itemId}
        item={row}
        suggested={item.matchState === "suggested"}
        mention={item.roles.includes(MENTION_ROLE)}
        mentionOnly={item.roles.every((r) => r === MENTION_ROLE)}
        removalRole={removalRole}
      />
    );
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pt-4">
      <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Related
        <span className="ml-2 font-normal text-neutral-600">{related.length}</span>
      </h2>
      {/* Typed relation fields first, labeled by the field (Attendees, References). */}
      {fieldSections.map(({ field, rows }) => (
        <div key={`field:${field.key}`} className="mt-4">
          <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <InlineLabel
              typeKey={hostType!}
              propertyKey={field.key}
              label={field.label}
            />
            <span className="ml-2 font-normal text-neutral-600">{rows.length}</span>
          </h3>
          <ul className="mt-1">{rows.map((item) => renderRow(item, field.key))}</ul>
        </div>
      ))}
      {/* Then everything else, grouped by type (unmarked under its glyph). */}
      {typeGroups.map((key) => (
        <div key={key} className="mt-4">
          <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <InlineLabel typeKey={key} label={labels.get(key) ?? key} />
            <span className="ml-2 font-normal text-neutral-600">
              {byType.get(key)!.length}
            </span>
          </h3>
          <ul className="mt-1">{byType.get(key)!.map((item) => renderRow(item))}</ul>
        </div>
      ))}
      <div className="mt-4">{addBar}</div>
    </section>
  );
}

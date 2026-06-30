// Related panel (slice 15, PRD §4.9): every item's detail page shows what links
// here — both-direction relations, grouped by type. Server component; the
// queries are body-free and owner-scoped.
//
// Each type group is structured by the owner's chosen LENS and rendered through
// the standard ViewRenderer (the same renderer the list pages and dashboards
// use), scoped with the pre-existing ViewFilter.relatedTo. So sorting, filtering,
// grouping, and the five layouts are the type's own saved lenses/views reused
// verbatim — no parallel machinery. The lens is switched in place from the group
// header (RelatedLensPicker) and persists per host-type + related-type.
//
// Rows keep their relation controls via ViewRenderer's rowActions slot
// (un-relate; the @-mention marker). The relatedTo filter matches CONFIRMED
// edges, so suggested (Phase-2 matcher) edges render in a small separate
// section with the existing confirm/reject row, untouched by the lens path.
//
// Typed relation fields (ADR-067 R4): when this item's type declares relation
// properties (Author, Attendees), their links render under Properties, so we
// claim those items here to keep them out of the type grouping below.
import type { ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { items, types } from "@/db/schema";
import { lensesForType, relatedLensFor } from "@/lib/list-lenses";
import { MENTION_ROLE } from "@/lib/mentions";
import {
  listRelatedItems,
  outgoingRelationsByRole,
  type RelatedItem,
} from "@/lib/relations";
import { resolveRelatedGroup } from "@/lib/related-views";
import { getSettings } from "@/lib/settings";
import { compareTypeKeys } from "@/lib/type-order";
import { getType } from "@/lib/types";
import CanvasSection from "@/components/canvas/CanvasSection";
import AddRelation from "./AddRelation";
import NewRelatedTask from "./NewRelatedTask";
import RelatedGroupView from "./RelatedGroupView";
import RelatedRow, { type RelatedRowItem } from "./RelatedRow";
import RelationActions from "./RelationActions";

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
  const [related, typeRows, hostRows, settings] = await Promise.all([
    listRelatedItems(ownerId, itemId),
    getDb().select({ key: types.key, label: types.label }).from(types),
    getDb()
      .select({ type: items.type })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId))),
    getSettings(ownerId),
  ]);

  // The add affordances ride along whether or not anything is linked yet.
  const addBar = (
    <div className="flex flex-wrap items-center gap-1">
      <AddRelation itemId={itemId} />
      <NewRelatedTask hostId={itemId} />
    </div>
  );

  const emptyState = bare ? (
    <>{addBar}</>
  ) : (
    <div className="mx-auto w-full max-w-3xl px-2 pt-2 sm:px-8 md:px-12">{addBar}</div>
  );

  // Nothing linked yet: just the quiet add affordances, no section chrome.
  if (related.length === 0) return emptyState;

  const labels = new Map(typeRows.map((t) => [t.key, t.label]));
  const hostType = hostRows[0]?.type ?? "";

  // This item's type → its relation fields (role sections). Those items render
  // under Properties, so claim them here to avoid listing them twice.
  const hostDef = hostType ? await getType(hostType).catch(() => null) : null;
  const relationFields = (hostDef?.propertySchema ?? []).filter((p) => p.kind === "relation");
  const byRole = relationFields.length
    ? await outgoingRelationsByRole(ownerId, itemId, relationFields.map((f) => f.key))
    : new Map<string, { id: string }[]>();
  const relatedById = new Map(related.map((r) => [r.id, r]));
  const claimed = new Set<string>();
  for (const f of relationFields) {
    for (const t of byRole.get(f.key) ?? []) {
      if (relatedById.has(t.id)) claimed.add(t.id);
    }
  }

  // Suggested edges render with the existing confirm/reject row (the relatedTo
  // view filter is confirmed-only). Everything else groups by type for the lens.
  const unclaimed = related.filter((r) => !claimed.has(r.id));
  if (unclaimed.length === 0) return emptyState;
  const suggested = unclaimed.filter((r) => r.matchState === "suggested");
  const confirmed = unclaimed.filter((r) => r.matchState !== "suggested");

  const byType = new Map<string, RelatedItem[]>();
  for (const item of confirmed) {
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

  // Per-group relation controls (un-relate + the @-mention marker), keyed by id,
  // handed to ViewRenderer's rowActions slot. mention-only rows have no remove
  // control (the body owns that edge).
  const rowActionsFor = (group: RelatedItem[]): Record<string, ReactNode> => {
    const out: Record<string, ReactNode> = {};
    for (const r of group) {
      const mentionOnly = r.roles.every((role) => role === MENTION_ROLE);
      out[r.id] = (
        <span className="flex shrink-0 items-center gap-2">
          {r.roles.includes(MENTION_ROLE) && (
            <span title="Linked by an @-mention in the body" className="text-xs text-neutral-600">
              @
            </span>
          )}
          <RelationActions itemId={itemId} otherId={r.id} suggested={false} removable={!mentionOnly} />
        </span>
      );
    }
    return out;
  };

  // Resolve each group's lens + items in parallel. A chosen view lens that was
  // deleted resolves to null; fall back to the type's default (first) lens.
  const groups = await Promise.all(
    typeGroups.map(async (key) => {
      const lenses = lensesForType(settings, key);
      let lens = relatedLensFor(settings, hostType, key);
      // Generic sort lenses hide completed items (the panel reads as live work);
      // a view lens owns its own status filter, so leave it to show what it filters.
      let data = await resolveRelatedGroup(ownerId, itemId, key, lens, lens.kind === "sort");
      if (!data) {
        lens = lenses[0];
        data = await resolveRelatedGroup(ownerId, itemId, key, lens, lens.kind === "sort");
      }
      return { key, lenses, lensId: lens.id, data, rowActions: rowActionsFor(byType.get(key)!) };
    })
  );
  const renderGroups = groups.filter((g) => g.data);

  const totalCount =
    renderGroups.reduce((n, g) => n + (g.data?.count ?? 0), 0) + suggested.length;

  const body = (
    <>
      {renderGroups.map((g) => (
        <RelatedGroupView
          key={g.key}
          hostType={hostType}
          typeKey={g.key}
          label={labels.get(g.key) ?? g.key}
          lenses={g.lenses}
          currentLensId={g.lensId}
          data={g.data!}
          rowActions={g.rowActions}
        />
      ))}
      {suggested.length > 0 && (
        <div className="mt-4">
          <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Suggested
            <span className="ml-2 font-normal text-neutral-600">{suggested.length}</span>
          </h3>
          <ul className="mt-1">
            {suggested.map((r) => {
              const row: RelatedRowItem = {
                id: r.id,
                type: r.type,
                title: r.title,
                status: r.status,
                statusCategory: r.statusCategory,
                dueDate: r.dueDate ? r.dueDate.toISOString() : null,
                updatedAt: r.updatedAt.toISOString(),
              };
              return (
                <RelatedRow
                  key={r.id}
                  hostId={itemId}
                  item={row}
                  suggested
                  mention={r.roles.includes(MENTION_ROLE)}
                  mentionOnly={r.roles.every((role) => role === MENTION_ROLE)}
                />
              );
            })}
          </ul>
        </div>
      )}
      <div className="mt-4">{addBar}</div>
    </>
  );

  if (bare) return body;
  return (
    <CanvasSection icon="affiliate" title="Linked here" count={totalCount}>
      {body}
    </CanvasSection>
  );
}

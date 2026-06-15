// Related panel (slice 15, PRD §4.9): every item's detail page shows what
// links here — both-direction relations, grouped by type. Server component;
// the query is body-free and owner-scoped (src/lib/relations.ts). The rows are
// interactive (ADR-055): related tasks check off and edit their due date in
// place, so this one panel is the actionable "tag as dashboard" surface that
// used to be the entity-only EmbeddedView. Suggested edges (Phase 2 matchers)
// render grayed with confirm/reject; mention-only rows carry an @ marker and
// no remove control, because the body owns those edges.
import { getDb } from "@/db";
import { types } from "@/db/schema";
import { MENTION_ROLE } from "@/lib/mentions";
import { listRelatedItems } from "@/lib/relations";
import { compareTypeKeys } from "@/lib/type-order";
import AddRelation from "./AddRelation";
import NewRelatedTask from "./NewRelatedTask";
import RelatedRow, { type RelatedRowItem } from "./RelatedRow";

export default async function RelatedPanel({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
}) {
  const [related, typeRows] = await Promise.all([
    listRelatedItems(ownerId, itemId),
    getDb().select({ key: types.key, label: types.label }).from(types),
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
  const byType = new Map<string, typeof related>();
  for (const item of related) {
    const group = byType.get(item.type);
    if (group) group.push(item);
    else byType.set(item.type, [item]);
  }
  const groups = [...byType.keys()].sort(compareTypeKeys);

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pt-4">
      <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Related
        <span className="ml-2 font-normal text-neutral-600">{related.length}</span>
      </h2>
      {groups.map((key) => (
        <div key={key} className="mt-4">
          <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {labels.get(key) ?? key}
            <span className="ml-2 font-normal text-neutral-600">
              {byType.get(key)!.length}
            </span>
          </h3>
          <ul className="mt-1">
            {byType.get(key)!.map((item) => {
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
                />
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-4">{addBar}</div>
    </section>
  );
}

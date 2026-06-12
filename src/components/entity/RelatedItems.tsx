// Entity page body (slice 6): every item related to the entity, grouped by
// type — the Notion "tag as dashboard" experience (PRD §4.2). Server
// component; the query is body-free and owner-scoped (src/lib/relations.ts).
// Suggested edges (Phase 2 matchers) render grayed with a dashed badge
// instead of being hidden, so confirming them later has a visible home.
import Link from "next/link";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import { listRelatedItems, type RelatedItem } from "@/lib/relations";
import { compareTypeKeys } from "@/lib/type-order";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function RelatedRow({ item }: { item: RelatedItem }) {
  const suggested = item.matchState === "suggested";
  return (
    <li
      className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60 ${
        suggested ? "opacity-60" : ""
      }`}
    >
      <Link
        href={`/items/${item.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
          item.title ? "text-neutral-200" : "text-neutral-500"
        }`}
      >
        {item.title || "Untitled"}
      </Link>
      {suggested && (
        <span className="shrink-0 rounded border border-dashed border-neutral-600 px-1.5 text-xs text-neutral-500">
          suggested
        </span>
      )}
      {item.status !== "open" && (
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
          {item.status}
        </span>
      )}
      {item.dueDate && (
        <span className="shrink-0 text-xs text-neutral-500">
          due {dateFmt.format(new Date(item.dueDate))}
        </span>
      )}
      <span className="shrink-0 text-xs text-neutral-600">
        {dateFmt.format(new Date(item.updatedAt))}
      </span>
    </li>
  );
}

export default async function RelatedItems({
  ownerId,
  entityId,
}: {
  ownerId: string;
  entityId: string;
}) {
  const [related, typeRows] = await Promise.all([
    listRelatedItems(ownerId, entityId),
    getDb().select({ key: types.key, label: types.label }).from(types),
  ]);

  const labels = new Map(typeRows.map((t) => [t.key, t.label]));
  const byType = new Map<string, RelatedItem[]>();
  for (const item of related) {
    const group = byType.get(item.type);
    if (group) group.push(item);
    else byType.set(item.type, [item]);
  }
  const groups = [...byType.keys()].sort(compareTypeKeys);

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pb-16 pt-4">
      <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Related
        {related.length > 0 && (
          <span className="ml-2 font-normal text-neutral-600">
            {related.length}
          </span>
        )}
      </h2>
      {groups.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-neutral-600">
          Nothing links here yet. @-mention this entity from any item to
          relate it.
        </p>
      ) : (
        groups.map((key) => (
          <div key={key} className="mt-4">
            <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {labels.get(key) ?? key}
              <span className="ml-2 font-normal text-neutral-600">
                {byType.get(key)!.length}
              </span>
            </h3>
            <ul className="mt-1">
              {byType.get(key)!.map((item) => (
                <RelatedRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

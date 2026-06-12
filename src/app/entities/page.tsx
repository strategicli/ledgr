// Entities list (PRD §4.2): the tag system's index. Grouped by kind
// (person, org, project, topic, campus seed order, new kinds after, kindless
// last), alphabetical inside a group, with a kind filter. Each row opens the
// entity page (related items grouped by type).
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import FilterBar from "@/components/lists/FilterBar";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { resolveOwner } from "@/lib/owner";
import { queryViewItems, type ViewFilter } from "@/lib/views";

export const dynamic = "force-dynamic";

type ListedItem = Awaited<ReturnType<typeof queryViewItems>>[number];

// Seed kinds in display order (schema.md); kinds are free text (ADR-003),
// so anything new sorts after these, alphabetically.
const KIND_ORDER = ["person", "org", "project", "topic", "campus"];

function compareKinds(a: string, b: string): number {
  const ai = KIND_ORDER.indexOf(a);
  const bi = KIND_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export default async function Entities({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const sp = await searchParams;
  const kind = typeof sp.kind === "string" ? sp.kind : undefined;
  const filter: ViewFilter = { type: "entity" };
  if (kind) filter.kind = kind;

  const [entities, kindRows] = await Promise.all([
    queryViewItems(owner.id, filter, { field: "title", dir: "asc" }),
    getDb()
      .selectDistinct({ kind: items.kind })
      .from(items)
      .where(
        and(
          eq(items.ownerId, owner.id),
          eq(items.type, "entity"),
          isNull(items.deletedAt),
          isNotNull(items.kind)
        )
      ),
  ]);
  const kinds = kindRows
    .map((r) => r.kind)
    .filter((k): k is string => k != null)
    .sort(compareKinds);

  const byKind = new Map<string, ListedItem[]>();
  for (const entity of entities) {
    const key = entity.kind ?? "";
    const group = byKind.get(key);
    if (group) group.push(entity);
    else byKind.set(key, [entity]);
  }
  const groups = [...byKind.entries()].sort(([a], [b]) => {
    if (a === "") return 1; // kindless last
    if (b === "") return -1;
    return compareKinds(a, b);
  });

  return (
    <ListPage
      tab="entities"
      title="Entities"
      subtitle={`${entities.length} entit${entities.length === 1 ? "y" : "ies"}`}
      actions={<NewItemButton type="entity" />}
    >
      {kinds.length > 0 && (
        <div className="mt-4">
          <FilterBar
            selects={[
              {
                param: "kind",
                label: "Kind",
                options: [
                  { value: "", label: "any" },
                  ...kinds.map((k) => ({ value: k, label: k })),
                ],
              },
            ]}
          />
        </div>
      )}
      {entities.length === 0 && (
        <p className="mt-6 px-2 text-sm text-neutral-600">
          No entities{kind ? " of this kind" : " yet"}.
        </p>
      )}
      {groups.map(([groupKind, rows]) => (
        <section key={groupKind || "none"} className="mt-6">
          <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            {groupKind || "No kind"}
            <span className="ml-2 font-normal text-neutral-600">
              {rows.length}
            </span>
          </h2>
          <ul className="mt-1">
            {rows.map((entity) => (
              <li
                key={entity.id}
                className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
              >
                <Link
                  href={`/items/${entity.id}`}
                  className={`min-w-0 flex-1 truncate text-sm ${
                    entity.title ? "text-neutral-200" : "text-neutral-500"
                  }`}
                >
                  {entity.title || "Untitled"}
                </Link>
                <RowAction id={entity.id} action="trash" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </ListPage>
  );
}

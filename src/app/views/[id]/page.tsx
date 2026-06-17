// A stored view's rendered output (slice 27): run the definition's filter +
// sort through the shared owner-scoped, body-free query, then hand the rows to
// the layout renderer. Same query path as the per-type list pages, so a view
// can never select a body or leak across owners.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ViewRenderer from "@/components/views/ViewRenderer";
import NewItemButton from "@/components/home/NewItemButton";
import { ItemError } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getType } from "@/lib/types";
import { getView, queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export default async function ViewPage({ params }: Context) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { id } = await params;
  let view;
  try {
    view = await getView(owner.id, id);
  } catch (err) {
    if (err instanceof ItemError) notFound();
    throw err;
  }

  const items = await queryViewItems(owner.id, view.filter, view.sort);

  // Load the view's type once: it powers both the board's column order (group
  // by a custom property) and the labels for any custom-property columns.
  const type = view.filter.type
    ? await getType(view.filter.type).catch(() => null)
    : null;

  // For a board grouped by a custom property, order its columns by the type's
  // option list (a workflow board reads Applied → Interview → Offer, not
  // alphabetically). Falls back to present-value order if the type/prop is gone.
  let groupOrder: string[] | undefined;
  const grouping = view.grouping;
  if (grouping && "propertyKey" in grouping) {
    groupOrder = type?.propertySchema.find(
      (p) => p.key === grouping.propertyKey
    )?.options;
  }

  // A board's cards can be dragged between columns only when a drop maps to a
  // single clean value: a status/urgency field (the default board groups by
  // status), or a single-select property. Computed `due` buckets, `type`, and
  // multi_select stay read-only.
  const groupPropKind =
    grouping && "propertyKey" in grouping
      ? type?.propertySchema.find((p) => p.key === grouping.propertyKey)?.kind
      : null;
  const fieldGroup =
    !grouping || "field" in grouping ? grouping?.field ?? "status" : null;
  const boardDraggable =
    view.layout === "board" &&
    (fieldGroup === "status" ||
      fieldGroup === "urgency" ||
      groupPropKind === "select");

  // key → label for the type's custom properties, so a property column reads
  // "Stage", not "stage".
  const propertyLabels: Record<string, string> = {};
  for (const p of type?.propertySchema ?? []) propertyLabels[p.key] = p.label;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            {view.name}
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/views" className="text-neutral-500 hover:text-neutral-300">
              ← All views
            </Link>
            {view.filter.type && <NewItemButton type={view.filter.type} />}
            {!view.isSystem && (
              <Link
                href={`/views/${view.id}/edit`}
                className="text-neutral-400 hover:text-neutral-200"
              >
                Edit
              </Link>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {items.length} item{items.length === 1 ? "" : "s"} · {view.layout}
        </p>

        <ViewRenderer
          view={view}
          items={items}
          groupOrder={groupOrder}
          propertyLabels={propertyLabels}
          boardDraggable={boardDraggable}
        />
      </div>
    </main>
  );
}

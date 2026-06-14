// A stored view's rendered output (slice 27): run the definition's filter +
// sort through the shared owner-scoped, body-free query, then hand the rows to
// the layout renderer. Same query path as the per-type list pages, so a view
// can never select a body or leak across owners.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PinButton from "@/components/views/PinButton";
import ViewRenderer from "@/components/views/ViewRenderer";
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

  // For a board grouped by a custom property, order its columns by the type's
  // option list (a workflow board reads Applied → Interview → Offer, not
  // alphabetically). Falls back to present-value order if the type/prop is gone.
  let groupOrder: string[] | undefined;
  const grouping = view.grouping;
  if (grouping && "propertyKey" in grouping && view.filter.type) {
    const type = await getType(view.filter.type).catch(() => null);
    groupOrder = type?.propertySchema.find(
      (p) => p.key === grouping.propertyKey
    )?.options;
  }

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
            <PinButton viewId={view.id} pinned={view.dashboardOrder != null} />
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

        <ViewRenderer view={view} items={items} groupOrder={groupOrder} />
      </div>
    </main>
  );
}

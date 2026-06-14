// Edit view (slice 27): the builder seeded with an existing definition. System
// views aren't editable (the store rejects it); the detail page hides the link
// for them, and this page redirects if one is reached directly.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ViewBuilder from "@/components/views/ViewBuilder";
import { ItemError } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { listTypes } from "@/lib/types";
import { getView, listEntityOptions } from "@/lib/views";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export default async function EditView({ params }: Context) {
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
  if (view.isSystem) redirect(`/views/${view.id}`);

  const [entities, types] = await Promise.all([
    listEntityOptions(owner.id),
    listTypes(),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Edit view
          </h1>
          <Link
            href={`/views/${view.id}`}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← Back to view
          </Link>
        </div>
        <ViewBuilder
          initial={view}
          entities={entities.map((e) => ({ id: e.id, title: e.title }))}
          types={types.map((t) => ({
            key: t.key,
            label: t.label,
            propertySchema: t.propertySchema,
          }))}
        />
      </div>
    </main>
  );
}

// Minimal item page: the slice-5 host for the editor. The item canvas slice
// (PRD §4.13) replaces this page's chrome with the modal canvas and field
// zones; the editing core (ItemEditor) carries over unchanged.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ItemEditor from "@/components/editor/ItemEditor";
import RelatedItems from "@/components/entity/RelatedItems";
import Subtasks from "@/components/subtasks/Subtasks";
import { ItemError, getItem } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { listAncestors } from "@/lib/subtasks";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { id } = await params;
  let item;
  try {
    item = await getItem(owner.id, id);
  } catch (err) {
    if (err instanceof ItemError) notFound();
    throw err;
  }
  if (item.deletedAt) notFound(); // Trash items restore first, then open.

  // Hierarchy reads child-upward (PRD §3.5): the breadcrumb is the live
  // ancestor chain, root first.
  const ancestors = item.parentId ? await listAncestors(owner.id, item.id) : [];

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-12 pt-6 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-300">
          ← All items
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex min-w-0 items-center gap-1">
            <span className="text-neutral-700">/</span>
            <Link
              href={`/items/${a.id}`}
              className="truncate hover:text-neutral-300"
            >
              {a.title || "Untitled"}
            </Link>
          </span>
        ))}
      </div>
      <ItemEditor
        item={{ id: item.id, title: item.title, body: item.body }}
      />
      <Subtasks ownerId={owner.id} itemId={item.id} />
      {item.type === "entity" && (
        // Entity page (slice 6): the entity's body is its wiki note; the
        // related-items dashboard renders beneath it.
        <RelatedItems ownerId={owner.id} entityId={item.id} />
      )}
    </main>
  );
}

// Minimal item page: the slice-5 host for the editor. The item canvas slice
// (PRD §4.13) replaces this page's chrome with the modal canvas and field
// zones; the editing core (ItemEditor) carries over unchanged.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ItemEditor from "@/components/editor/ItemEditor";
import { ItemError, getItem } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";

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

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-12 pt-6">
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← All items
        </Link>
      </div>
      <ItemEditor
        item={{ id: item.id, title: item.title, body: item.body }}
      />
    </main>
  );
}

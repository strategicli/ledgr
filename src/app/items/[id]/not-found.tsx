// Item-specific 404 (UX pass): ItemCanvas calls notFound() for a missing or
// trashed item (it guards on deletedAt). This boundary catches that and points
// to Trash, instead of the bare default 404 the audit flagged.
import Link from "next/link";

export default function ItemNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">
          Item not found
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
          This item doesn&apos;t exist, or it&apos;s in the Trash. Items in the
          Trash restore before they open.
        </p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Link href="/items" className="text-neutral-400 hover:text-neutral-200">
          All items
        </Link>
        <Link href="/trash" className="text-neutral-400 hover:text-neutral-200">
          Open Trash
        </Link>
      </div>
    </main>
  );
}

// Trash (v5). Soft-deleted items, newest first, with one-click Restore. Items
// are purged after the owner's retention window (settings). Reached from the nav
// kebab. Uses the existing trash infra: listItems({trash}), restoreItem, and the
// purge job.
import Link from "next/link";
import { redirect } from "next/navigation";
import { listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import RestoreButton from "@/components/trash/RestoreButton";

export const dynamic = "force-dynamic";

function whenDeleted(d: Date | string | null): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export default async function TrashPage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  const [trashed, settings] = await Promise.all([
    listItems(owner.id, { trash: true, limit: 200 }),
    getSettings(owner.id),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Trash</h1>
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Back
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Deleted items are kept for {settings.trashRetentionDays} days, then purged. Restore puts an item (and its
          children) back where it was.
        </p>

        {trashed.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-600">Trash is empty.</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {trashed.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm text-neutral-200">{it.title || "Untitled"}</span>
                  <span className="ml-2 text-xs text-neutral-600">
                    {it.type}
                    {whenDeleted(it.deletedAt) && ` · deleted ${whenDeleted(it.deletedAt)}`}
                  </span>
                </div>
                <RestoreButton id={it.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

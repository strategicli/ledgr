// The item canvas shell (PRD §4.13), shared by the full /items/[id] page and
// the intercepted center modal. It owns the universal frame — owner check,
// item load, trash/notFound guards, and the ancestor breadcrumb — then hands
// the loaded item to the type's canvas. The type → canvas resolution now runs
// through the module-registration boundary (M6, ADR-043): `canvasIdForType` is
// the owning module's policy, `canvasComponentFor` the wiring. Most types
// resolve to the default markdown canvas; `link` declares a bespoke one, and a
// workflow module (Songs/Papers) adds its own the same way.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ItemError, getItem } from "@/lib/items";
import { canvasIdForType } from "@/lib/modules";
import { canvasComponentFor } from "@/lib/module-wiring";
import { resolveOwner } from "@/lib/owner";
import { listAncestors } from "@/lib/subtasks";

export default async function ItemCanvas({
  id,
  variant,
}: {
  id: string;
  variant: "page" | "modal";
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

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
  const showBreadcrumb = variant === "page" || ancestors.length > 0;

  // Owner-aware so the per-user enable flip (M6) can route a disabled module's
  // type back to the default canvas without touching this call site.
  const Canvas = canvasComponentFor(canvasIdForType(item.type, owner.id));

  return (
    <>
      {showBreadcrumb && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-12 pt-6 text-sm text-neutral-500">
          {variant === "page" && (
            <Link href="/items" className="hover:text-neutral-300">
              ← All items
            </Link>
          )}
          {ancestors.map((a, i) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              {(variant === "page" || i > 0) && (
                <span className="text-neutral-700">/</span>
              )}
              <Link
                href={`/items/${a.id}`}
                className="truncate hover:text-neutral-300"
              >
                {a.title || "Untitled"}
              </Link>
            </span>
          ))}
        </div>
      )}
      <Canvas item={item} ownerId={owner.id} variant={variant} />
    </>
  );
}

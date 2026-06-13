// The item canvas shell (PRD §4.13), shared by the full /items/[id] page and
// the intercepted center modal. It owns the universal frame — owner check,
// item load, trash/notFound guards, and the ancestor breadcrumb — then hands
// the loaded item to the type's canvas. Most types render through the default
// markdown canvas; a type may declare a bespoke one (the per-type canvas seam,
// ADR-041 / roadmap M5) — the platform hook the Songs/Papers modules need.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import MarkdownCanvas from "@/components/canvas/MarkdownCanvas";
import LinkCanvas from "@/components/canvas/LinkCanvas";
import { canvasIdForType, type CanvasComponent } from "@/lib/canvas-registry";
import { ItemError, getItem } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { listAncestors } from "@/lib/subtasks";

// Canvas id -> component wiring. The policy (which id per type) lives in
// canvas-registry, pure; the wiring lives here with the components so that
// pure module never imports the editor bundle. The `?? MarkdownCanvas` fallback
// keeps a policy/wiring drift from crashing the page. M6 replaces this
// hardcoded map with the module-registration boundary (a module contributes
// its own {id, canvas}).
const CANVAS_COMPONENTS: Record<string, CanvasComponent> = {
  markdown: MarkdownCanvas,
  link: LinkCanvas,
};

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

  const Canvas =
    CANVAS_COMPONENTS[canvasIdForType(item.type)] ?? MarkdownCanvas;

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

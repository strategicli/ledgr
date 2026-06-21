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
import { isItemFavorited } from "@/lib/favorites";
import { canvasIdForType } from "@/lib/modules";
import { canvasComponentFor } from "@/lib/module-wiring";
import { resolveOwner } from "@/lib/owner";
import { listAncestors } from "@/lib/subtasks";
import { getTemplateByPrototype } from "@/lib/templates";
import { getType } from "@/lib/types";
import SaveStatusIndicator from "@/components/canvas/SaveStatusIndicator";
import ItemActionsMenu from "@/components/canvas/ItemActionsMenu";
import TemplateBanner from "@/components/canvas/TemplateBanner";

export default async function ItemCanvas({
  id,
  variant,
  arrange = false,
}: {
  id: string;
  variant: "page" | "modal";
  // Per-type layout arrange mode (ADR-069); full-page ?arrange=1 only.
  arrange?: boolean;
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

  // A template prototype shows the "Template" banner instead of the normal item
  // chrome (ADR-093, TPL2). The registry row is found only for a prototype ROOT;
  // a template subtask is is_template but backs no row (a minimal note instead).
  const template = item.isTemplate
    ? await getTemplateByPrototype(owner.id, item.id)
    : null;

  // Hierarchy reads child-upward (PRD §3.5): the breadcrumb is the live
  // ancestor chain, root first.
  const ancestors = item.parentId ? await listAncestors(owner.id, item.id) : [];
  // A template prototype (no ancestors) shows the banner instead of a breadcrumb;
  // a template subtask still shows its ancestor chain up to the prototype.
  const showBreadcrumb =
    (variant === "page" && !item.isTemplate) || ancestors.length > 0;

  // Star state for the actions menu (page chrome only; the modal's menu resolves
  // it separately). Skipped otherwise to avoid an extra settings read.
  const favorited =
    variant === "page" && !item.isTemplate
      ? await isItemFavorited(owner.id, item.id)
      : false;

  // Owner-aware so the per-user enable flip (M6) can route a disabled module's
  // type back to the default canvas without touching this call site. The type's
  // attached capability (SPIKE — bespoke-tool catalog) lets a user-named type
  // borrow a module's canvas; an unregistered type with no capability falls back
  // to the default markdown canvas, so this load is best-effort.
  const typeDef = await getType(item.type).catch(() => null);
  const Canvas = canvasComponentFor(
    canvasIdForType(item.type, owner.id, typeDef?.capability)
  );

  return (
    <>
      {/* The full-page view is wider than the modal (Brandon, 2026-06-17):
          `canvas-wide` widens the standard max-w-3xl canvas blocks so "expand"
          actually gains room, and matches the grid width so entering Arrange
          doesn't jump. The modal stays the narrow quick reader. */}
      <div className={variant === "page" ? "canvas-wide" : undefined}>
        {item.isTemplate &&
          (template ? (
            <TemplateBanner
              templateId={template.id}
              name={template.name}
              isDefault={template.isDefault}
              typeLabel={typeDef?.label ?? item.type}
              applyConfig={template.applyConfig}
            />
          ) : (
            <div className="mx-auto w-full max-w-3xl px-2 pt-4 sm:px-8 md:px-12">
              <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/80">
                Part of a template — edits here change the template, not a real item.
              </div>
            </div>
          ))}
        {showBreadcrumb && (
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-2 pt-4 text-sm text-neutral-500 sm:px-8 sm:pt-6 md:px-12">
            <div className="flex min-w-0 items-center gap-1">
              {variant === "page" && !item.isTemplate && (
                <Link href="/items" className="hover:text-neutral-300">
                  ← All items
                </Link>
              )}
              {ancestors.map((a, i) => (
                <span key={a.id} className="flex min-w-0 items-center gap-1">
                  {((variant === "page" && !item.isTemplate) || i > 0) && (
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
            {variant === "page" && !item.isTemplate && (
              <span className="flex shrink-0 items-center gap-1">
                <ItemActionsMenu
                  itemId={item.id}
                  type={item.type}
                  title={item.title}
                  locked={Boolean(
                    (item.properties as Record<string, unknown> | null)?.locked
                  )}
                  favorited={favorited}
                />
              </span>
            )}
          </div>
        )}
        {/* canvasComponentFor is a registry lookup (module-wiring.tsx) returning a
            stable, module-registered component, not one created per render — its
            identity is constant across renders, so React won't remount it. */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Canvas item={item} ownerId={owner.id} variant={variant} arrange={arrange} />
      </div>
      {/* One always-visible autosave indicator for the whole canvas. */}
      <SaveStatusIndicator />
    </>
  );
}

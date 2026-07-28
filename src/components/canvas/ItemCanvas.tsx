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
import { bodyMarkdown } from "@/lib/body";
import { isItemFavorited } from "@/lib/favorites";
import { canvasIdForType } from "@/lib/modules";
import { canvasComponentFor } from "@/lib/module-wiring";
import { resolveOwner } from "@/lib/owner";
import { listAncestors } from "@/lib/subtasks";
import { getTemplateByPrototype } from "@/lib/templates";
import { getType } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { tocForType } from "@/lib/toc";
import SaveStatusIndicator from "@/components/canvas/SaveStatusIndicator";
import ActiveContextTracker from "@/components/canvas/ActiveContextTracker";
import FloatingToc from "@/components/canvas/FloatingToc";
import ItemActionsMenu from "@/components/canvas/ItemActionsMenu";
import PageTrashButton from "@/components/canvas/PageTrashButton";
import TemplateBanner from "@/components/canvas/TemplateBanner";
import TypeCue from "@/components/canvas/TypeCue";

// Compact date for the chrome timestamps ("Jan 3, 2021").
const CHROME_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtChromeDate = (d: Date) => CHROME_DATE.format(d);

// Rough word count for the chrome indicator: count word-like runs so bare
// markdown punctuation (#, -, *, link brackets) doesn't inflate the total.
const wordCountOf = (md: string) =>
  (md.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

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
  // On the full page this row is the item's only trash/⋯/word-count chrome, and a
  // long item scrolled it away (Brandon, 2026-07-28), so on sm+ it pins under the
  // nav. The modal doesn't need it: its own header already carries those actions
  // above the scrolling body, and its panel background differs from the page's.
  // A fixed height (= the --item-chrome-h it publishes) rather than pt: the box
  // has to be exactly as tall as the offset the editor toolbar pins below, or a
  // scroll-through gap opens between them. Same total height as the old pt-6 +
  // row, so nothing shifts at scroll top. z sits between the body toolbar (30)
  // and the nav (40), so the ⋯ menu drops over the toolbar while a nav flyout
  // still drops over this row.
  const stickyChrome = showBreadcrumb && variant === "page";
  const chromeRowSticky = stickyChrome
    ? "sm:sticky sm:top-[var(--nav-pt,0px)] sm:z-[35] sm:h-[var(--item-chrome-h)] sm:bg-surface-0 sm:pt-0"
    : "sm:pt-6";

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

  // Table of contents (ADR-114): a per-type, owner-scoped reading preference
  // resolved here so the outline mounts once, universally, over whatever canvas
  // this type uses. The component self-gates on heading count, and picks its
  // own presentation from the measured container (ADR-167) — no variant needed.
  // Whether it opens PINNED is per item, not per type (settings.tocPinnedItems).
  const settings = await getSettings(owner.id);
  const toc = tocForType(settings, item.type);

  // Word count for the chrome (top-right on desktop, in the ⋯ menu everywhere).
  const wordCount = wordCountOf(bodyMarkdown(item.body));

  return (
    <>
      {/* `canvas-wide` widens the standard max-w-3xl canvas blocks (to 64rem) so
          the content fills the surface instead of staying pinned at the narrow
          "quick reader" column. On the full page this matches the grid width so
          entering Arrange doesn't jump; in the modal it lets the canvas fill the
          widened side peek (the block still can't exceed its panel, so the
          center modal and mobile sheet are unaffected). ADR: Brandon 2026-06-17;
          extended to the modal in the side-panel refresh. */}
      {/* --item-chrome-h is the height of the sticky chrome row below, published
          on the scope so the other sticky layers in it (the body editor's
          formatting bar, the outline) can pin *under* that row instead of
          sliding over it. Set only when the sticky row actually renders;
          everywhere else it falls back to 0. */}
      <div
        data-toc-scope
        className="canvas-wide"
        style={
          stickyChrome
            ? ({ "--item-chrome-h": "3rem" } as React.CSSProperties)
            : undefined
        }
      >
        {/* The outline reads this scope's body editor (.ledgr-prose). It mounts
            FIRST on purpose: it's a `sticky` layer, and a sticky box only pins
            while its containing block is in view, so placed after the canvas it
            would sit stuck at the bottom instead of tracking the scroll. Renders
            nothing for an item with <2 headings (ADR-114/167). */}
        {toc.enabled && (
          <FloatingToc
            itemId={item.id}
            levels={toc.levels}
            pinned={settings.tocPinnedItems.includes(item.id)}
          />
        )}
        {item.isTemplate &&
          (template ? (
            <TemplateBanner
              templateId={template.id}
              name={template.name}
              isDefault={template.isDefault}
              typeLabel={typeDef?.label ?? item.type}
              applyConfig={template.applyConfig}
              matchConfig={template.matchConfig}
            />
          ) : (
            <div className="mx-auto w-full max-w-3xl px-2 pt-4 sm:px-8 md:px-12">
              <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/80">
                Part of a template — edits here change the template, not a real item.
              </div>
            </div>
          ))}
        {showBreadcrumb && (
          <div
            className={`mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-2 pt-4 text-sm text-ink-muted sm:px-8 md:px-12 ${chromeRowSticky}`}
          >
            <div className="flex min-w-0 items-center gap-1">
              {variant === "page" && !item.isTemplate && (
                <PageTrashButton itemId={item.id} parentId={item.parentId ?? null} />
              )}
              {/* Type cue (ADR-132): rides the breadcrumb row, no new vertical
                  space. A separator follows only when an ancestor chain comes
                  next, so a top-level item reads "🗒 Note" with nothing trailing. */}
              {!item.isTemplate && (
                <TypeCue icon={typeDef?.icon ?? null} label={typeDef?.label ?? item.type} />
              )}
              {!item.isTemplate && ancestors.length > 0 && (
                <span className="text-ink-faint">·</span>
              )}
              {ancestors.map((a, i) => (
                <span key={a.id} className="flex min-w-0 items-center gap-1">
                  {i > 0 && (
                    <span className="text-ink-faint">/</span>
                  )}
                  <Link
                    href={`/items/${a.id}`}
                    className="truncate hover:text-ink"
                  >
                    {a.title || "Untitled"}
                  </Link>
                </span>
              ))}
            </div>
            <span className="flex shrink-0 items-center gap-3">
              {/* Created/Updated are item chrome, not content: faint, right of
                  the row, hidden on the narrow mobile breadcrumb. */}
              <span className="hidden items-center gap-2 text-xs text-ink-faint sm:flex">
                <span>Created {fmtChromeDate(item.createdAt)}</span>
                <span aria-hidden>·</span>
                <span>Updated {fmtChromeDate(item.updatedAt)}</span>
                <span aria-hidden>·</span>
                <span>{wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}</span>
              </span>
              {variant === "page" && !item.isTemplate && (
                <ItemActionsMenu
                  itemId={item.id}
                  type={item.type}
                  title={item.title}
                  locked={Boolean(
                    (item.properties as Record<string, unknown> | null)?.locked
                  )}
                  favorited={favorited}
                  createdLabel={fmtChromeDate(item.createdAt)}
                  updatedLabel={fmtChromeDate(item.updatedAt)}
                  wordCount={wordCount}
                />
              )}
            </span>
          </div>
        )}
        {/* canvasComponentFor is a registry lookup (module-wiring.tsx) returning a
            stable, module-registered component, not one created per render — its
            identity is constant across renders, so React won't remount it. */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Canvas item={item} ownerId={owner.id} variant={variant} arrange={arrange} />
      </div>
      {/* One always-visible autosave indicator for the whole canvas; also owns
          the cross-device conflict banner + refresh-on-focus check (ADR-134). */}
      <SaveStatusIndicator itemId={item.id} loadedAt={item.updatedAt.toISOString()} />
      {/* Live editing context (ADR-162): report the open item + text selection so
          Claude can resolve "this note"/"this sentence" over MCP. Opt-in, and
          never for a template prototype (that's authoring, not the live note). */}
      {settings.liveContextEnabled && !item.isTemplate && (
        <ActiveContextTracker itemId={item.id} title={item.title} />
      )}
    </>
  );
}

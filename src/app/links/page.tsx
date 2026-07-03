// Links list (PRD §4.2): the destination host shown and clickable straight to
// the outside URL; the title opens the item canvas. Now carries the
// customizable tab strip ("list lenses") every type's list shows — sort lenses
// order this plain list; a view ("widget") lens renders its saved view.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListLenses from "@/components/lists/ListLenses";
import ListPage from "@/components/lists/ListPage";
import LoadMore from "@/components/lists/LoadMore";
import ViewLensBody from "@/components/lists/ViewLensBody";
import NewItemButton from "@/components/home/NewItemButton";
import RowMenu from "@/components/lists/RowMenu";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import { bulkConfigForType } from "@/lib/bulk-config";
import { lensesForType, resolveLensSort, selectLens } from "@/lib/list-lenses";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { APP_TIMEZONE } from "@/lib/today";
import { getType } from "@/lib/types";
import { resolveViewLens } from "@/lib/view-render";
import { countViewItems, parseListWindow, queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function Links({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const sp = await searchParams;
  const settings = await getSettings(owner.id);
  const lenses = lensesForType(settings, "link");
  const active = selectLens(lenses, typeof sp.lens === "string" ? sp.lens : undefined);
  const reversed = sp.rev === "1";

  const viewData =
    active.kind === "view" ? await resolveViewLens(owner.id, active.viewId, "link") : null;

  // Sort-lens path: a window of rows (Load-more grows it) plus the true count.
  const show = parseListWindow(sp.show);
  let links: Awaited<ReturnType<typeof queryViewItems>> = [];
  let count: number;
  if (viewData) {
    count = viewData.count;
  } else {
    const filter = { type: "link" };
    [links, count] = await Promise.all([
      queryViewItems(owner.id, filter, resolveLensSort(active, reversed) ?? undefined, show),
      countViewItems(owner.id, filter),
    ]);
  }

  return (
    <ListPage
      tab="links"
      title="Links"
      subtitle={`${count} link${count === 1 ? "" : "s"}`}
      actions={<NewItemButton type="link" />}
      width="list"
    >
      <ListLenses
        lenses={lenses}
        activeId={active.id}
        reversed={reversed}
        basePath="/links"
        params={sp}
        editHref="/build/types/link/edit"
      />
      {viewData ? (
        <ViewLensBody data={viewData} bulkConfig={bulkConfigForType(await getType("link"))} ownerId={owner.id} />
      ) : links.length > 0 ? (
        <SelectionProvider ids={links.map((link) => link.id)}>
          <SelectModeToggle />
          <ul className="mt-4">
            {links.map((link) => (
              <RowMenu
                key={link.id}
                id={link.id}
                label={link.title || "Untitled"}
                className="group flex items-center gap-2.5 rounded px-2 py-1.5 hover:bg-surface-2"
              >
                <SelectCheckbox id={link.id} />
                <Link
                  href={`/items/${link.id}`}
                  data-peek-row
                  className={`ui-row min-w-0 flex-1 truncate ${
                    link.title ? "text-ink" : "text-ink-subtle"
                  }`}
                >
                  {link.title || "Untitled"}
                </Link>
                {link.url && (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-40 shrink-0 truncate rounded bg-surface-2 px-1.5 text-xs text-[var(--accent)] hover:brightness-110"
                    title={link.url}
                  >
                    {hostOf(link.url)} ↗
                  </a>
                )}
                <span className="ui-meta shrink-0 tabular-nums">
                  {dateFmt.format(link.updatedAt)}
                </span>
              </RowMenu>
            ))}
          </ul>
          <LoadMore shown={links.length} total={count} basePath="/links" params={sp} />
          <BulkActionBar {...bulkConfigForType(await getType("link"))} />
        </SelectionProvider>
      ) : (
        <p className="ui-row mt-6 px-2 text-ink-subtle">No links yet.</p>
      )}
    </ListPage>
  );
}

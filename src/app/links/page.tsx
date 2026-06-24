// Links list (PRD §4.2): the destination host shown and clickable straight to
// the outside URL; the title opens the item canvas. Now carries the
// customizable tab strip ("list lenses") every type's list shows — sort lenses
// order this plain list; a view ("widget") lens renders its saved view.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListLenses from "@/components/lists/ListLenses";
import ListPage from "@/components/lists/ListPage";
import ViewLensBody from "@/components/lists/ViewLensBody";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { lensesForType, resolveLensSort, selectLens } from "@/lib/list-lenses";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { APP_TIMEZONE } from "@/lib/today";
import { resolveViewLens } from "@/lib/view-render";
import { queryViewItems } from "@/lib/views";

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
  const links = viewData
    ? []
    : await queryViewItems(owner.id, { type: "link" }, resolveLensSort(active, reversed) ?? undefined);
  const count = viewData ? viewData.count : links.length;

  return (
    <ListPage
      tab="links"
      title="Links"
      subtitle={`${count} link${count === 1 ? "" : "s"}`}
      actions={<NewItemButton type="link" />}
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
        <ViewLensBody data={viewData} />
      ) : links.length > 0 ? (
        <ul className="mt-4">
          {links.map((link) => (
            <li
              key={link.id}
              className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
            >
              <Link
                href={`/items/${link.id}`}
                className={`min-w-0 flex-1 truncate text-sm ${
                  link.title ? "text-neutral-200" : "text-neutral-500"
                }`}
              >
                {link.title || "Untitled"}
              </Link>
              {link.url && (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-40 shrink-0 truncate rounded bg-neutral-800 px-1.5 text-xs text-[var(--accent)] hover:brightness-110"
                  title={link.url}
                >
                  {hostOf(link.url)} ↗
                </a>
              )}
              <span className="shrink-0 text-xs text-neutral-600">
                {dateFmt.format(link.updatedAt)}
              </span>
              <RowAction id={link.id} action="trash" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 px-2 text-sm text-neutral-600">No links yet.</p>
      )}
    </ListPage>
  );
}

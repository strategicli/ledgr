// Notes list (PRD §4.2): a recency-ordered list, now carrying the customizable
// tab strip ("list lenses") every type's list shows — sort lenses order this
// plain list; a view ("widget") lens renders its saved view via ViewRenderer.
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

// note_date is a calendar day stored UTC-midnight (ADR-110), so format it in UTC
// (not the app zone) or an evening-saved day would render as the day before.
const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export default async function Notes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const sp = await searchParams;
  const settings = await getSettings(owner.id);
  const lenses = lensesForType(settings, "note");
  const active = selectLens(lenses, typeof sp.lens === "string" ? sp.lens : undefined);
  const reversed = sp.rev === "1";

  const viewData =
    active.kind === "view" ? await resolveViewLens(owner.id, active.viewId, "note") : null;
  const notes = viewData
    ? []
    : await queryViewItems(owner.id, { type: "note" }, resolveLensSort(active, reversed) ?? undefined);
  const count = viewData ? viewData.count : notes.length;

  return (
    <ListPage
      tab="notes"
      title="Notes"
      subtitle={`${count} note${count === 1 ? "" : "s"}`}
      actions={<NewItemButton type="note" />}
    >
      <ListLenses
        lenses={lenses}
        activeId={active.id}
        reversed={reversed}
        basePath="/notes"
        params={sp}
        editHref="/build/types/note/edit"
      />
      {viewData ? (
        <ViewLensBody data={viewData} />
      ) : notes.length > 0 ? (
        <ul className="mt-4">
          {notes.map((note) => (
            <li
              key={note.id}
              className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
            >
              <Link
                href={`/items/${note.id}`}
                className={`min-w-0 flex-1 truncate text-sm ${
                  note.title ? "text-neutral-200" : "text-neutral-500"
                }`}
              >
                {note.title || "Untitled"}
              </Link>
              <span
                className="shrink-0 text-xs text-neutral-600"
                title={note.noteDate ? "Date taken" : "Last edited"}
              >
                {note.noteDate ? dayFmt.format(note.noteDate) : dateFmt.format(note.updatedAt)}
              </span>
              <RowAction id={note.id} action="trash" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 px-2 text-sm text-neutral-600">No notes yet.</p>
      )}
    </ListPage>
  );
}

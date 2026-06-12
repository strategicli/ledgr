// Notes list (PRD §4.2): a simple recency-ordered list. Notes have no hot
// fields beyond the shared set, so there's no filter bar until the view
// builder (Phase 2) brings property filters.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { resolveOwner } from "@/lib/owner";
import { APP_TIMEZONE } from "@/lib/today";
import { queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});

export default async function Notes() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const notes = await queryViewItems(owner.id, { type: "note" });

  return (
    <ListPage
      tab="notes"
      title="Notes"
      subtitle={`${notes.length} note${notes.length === 1 ? "" : "s"}`}
      actions={<NewItemButton type="note" />}
    >
      {notes.length > 0 ? (
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
              <span className="shrink-0 text-xs text-neutral-600">
                {dateFmt.format(note.updatedAt)}
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

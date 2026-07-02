// Meeting Notes panel (Tyler, 2026-07-01): jot notes ON a meeting. Each note is
// a `note` item filed as a home-contained child of the meeting AND — via the
// contain route — related to the meeting's project, so the same note also shows
// in that project's Docs box. Server component; one owner-scoped, body-free
// query for the meeting's notes, mirroring MeetingPrep's CanvasSection shape.
import Link from "next/link";
import CanvasSection from "@/components/canvas/CanvasSection";
import AddContainedItemButton from "@/components/canvas/widgets/AddContainedItemButton";
import NavGlyph from "@/components/nav/NavGlyph";
import { queryViewItems } from "@/lib/views";

export default async function MeetingNotes({
  ownerId,
  itemId,
  // A single grid card (ADR-069): drop the per-section card chrome so the list
  // stacks inside the one grid card, matching MeetingPrep/MeetingTranscripts.
  bare = false,
}: {
  ownerId: string;
  itemId: string;
  bare?: boolean;
}) {
  const notes = await queryViewItems(
    ownerId,
    { type: "note", relatedTo: itemId },
    { field: "updatedAt", dir: "desc" },
    50
  );

  return (
    <CanvasSection bare={bare} icon="notes" title="Notes" count={notes.length}>
      <ul className="canvas-rows empty:hidden">
        {notes.map((n) => (
          <li
            key={n.id}
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-800/50"
          >
            <NavGlyph icon="notes" size={14} className="shrink-0 text-neutral-600" />
            <Link
              href={`/items/${n.id}`}
              className="min-w-0 flex-1 truncate text-neutral-200 hover:underline"
            >
              {n.title || "Untitled note"}
            </Link>
          </li>
        ))}
      </ul>
      <div className="px-1 pt-1">
        <AddContainedItemButton recordId={itemId} type="note" label="Add note" />
      </div>
    </CanvasSection>
  );
}

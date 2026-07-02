"use client";

// Mindmap widget body (Tyler, 2026-07-01): the project's contained mindmap(s).
// "+ Add mindmap" creates a mindmap associated with this project (via the
// contain route → home edge) and opens it in the mindmap canvas; back on the
// page each row shows a mindmap glyph + its title, linking to the mindmap. A
// mindmap is a full canvas, so the card is a launcher (list + add), not an
// inline editor — mirrors the Docs/Links widgets.
import Link from "next/link";
import AddContainedItemButton from "@/components/canvas/widgets/AddContainedItemButton";
import NavGlyph from "@/components/nav/NavGlyph";

type Row = { id: string; title: string };

export default function MindmapWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 empty:hidden">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <NavGlyph icon="mindmap" size={15} className="shrink-0 text-neutral-500" />
            <Link href={`/items/${m.id}`} className="min-w-0 flex-1 truncate text-neutral-200 hover:text-neutral-100">
              {m.title || "Untitled mindmap"}
            </Link>
          </li>
        ))}
      </ul>
      <AddContainedItemButton recordId={recordId} type="mindmap" label="Add mindmap" />
    </div>
  );
}

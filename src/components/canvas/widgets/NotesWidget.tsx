"use client";

// Docs widget body (Project Type, Tyler 2026-07-01): the project's contained
// notes. "+ Add note" creates a note associated with this project and opens it
// in the note editor modal (AddContainedItemButton); back on the page each note
// shows a note icon + its title, linking to the note.
import Link from "next/link";
import AddContainedItemButton from "@/components/canvas/widgets/AddContainedItemButton";

type Row = { id: string; title: string };

const NoteIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </svg>
);

export default function NotesWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 empty:hidden">
        {items.map((n) => (
          <li key={n.id} className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-neutral-500">{NoteIcon}</span>
            <Link href={`/items/${n.id}`} className="min-w-0 flex-1 truncate text-neutral-200 hover:text-neutral-100">
              {n.title || "Untitled note"}
            </Link>
          </li>
        ))}
      </ul>
      <AddContainedItemButton recordId={recordId} type="note" label="Add note" />
    </div>
  );
}

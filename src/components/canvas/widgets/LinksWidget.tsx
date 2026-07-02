"use client";

// Links widget body (Project Type, Tyler 2026-07-01): the project's contained
// links / resources. "+ Add link" creates a link associated with this project
// and opens it in the link editor modal (where the URL is set); back on the page
// each row shows a link icon + its title, and the title itself is the outbound
// link. A link with no URL yet (just created, still blank) links to the item so
// it can be finished.
import Link from "next/link";
import AddContainedItemButton from "@/components/canvas/widgets/AddContainedItemButton";
import NavGlyph from "@/components/nav/NavGlyph";

type Row = { id: string; title: string; url: string | null };

export default function LinksWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 empty:hidden">
        {items.map((l) => (
          <li key={l.id} className="flex items-center gap-2 text-sm">
            <NavGlyph icon="external-link" size={15} className="shrink-0 text-neutral-500" />
            {l.url ? (
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-neutral-200 hover:text-[var(--accent)]"
              >
                {l.title || l.url}
              </a>
            ) : (
              <Link href={`/items/${l.id}`} className="min-w-0 flex-1 truncate text-neutral-400 hover:text-neutral-200">
                {l.title || "Untitled link"}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <AddContainedItemButton recordId={recordId} type="link" label="Add link" />
    </div>
  );
}

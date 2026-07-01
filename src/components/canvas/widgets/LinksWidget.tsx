"use client";

// Links widget body (Project Type, Tyler 2026-07-01): the project's contained
// links / resources. "+ Add link" creates a link associated with this project
// and opens it in the link editor modal (where the URL is set); back on the page
// each row shows a link icon + its title, and the title itself is the outbound
// link. A link with no URL yet (just created, still blank) links to the item so
// it can be finished.
import Link from "next/link";
import AddContainedItemButton from "@/components/canvas/widgets/AddContainedItemButton";

type Row = { id: string; title: string; url: string | null };

// External-link glyph (box + outbound arrow) — reads as "opens the link out"
// (Tyler, 2026-07-01), better than the chain for outbound resources.
const LinkIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </svg>
);

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
            <span className="shrink-0 text-neutral-500">{LinkIcon}</span>
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

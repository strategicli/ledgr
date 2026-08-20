// The link row list, shared by the Links tool (card) and the full collection
// page (2026-08-17: the full page carries the tool's capability). The title
// itself is the outbound link; a link with no URL yet (just created, still
// blank) links to the item so it can be finished. No "use client" directive:
// stateless, so it renders on the server page and inside the client widget
// alike. `selectable` adds the ADR-118 SelectCheckbox at the leading edge (the
// collection page wraps this in a SelectionProvider).
import Link from "next/link";
import NavGlyph from "@/components/nav/NavGlyph";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SmartHref from "@/components/ui/SmartHref";

export type LinkRow = { id: string; title: string; url: string | null };

export default function LinkList({
  items,
  selectable = false,
}: {
  items: LinkRow[];
  selectable?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1 empty:hidden">
      {items.map((l) => (
        <li key={l.id} className="flex items-center gap-2 text-sm">
          {selectable && <SelectCheckbox id={l.id} />}
          <NavGlyph icon="external-link" size={15} className="shrink-0 text-neutral-500" />
          {l.url ? (
            // SmartHref: a file:// URL can't be opened from a web page, so the
            // click copies it instead (with a toast); normal URLs open as ever.
            <SmartHref
              href={l.url}
              className="min-w-0 flex-1 truncate text-neutral-200 hover:text-[var(--accent)]"
            >
              {l.title || l.url}
            </SmartHref>
          ) : (
            <Link href={`/items/${l.id}`} className="min-w-0 flex-1 truncate text-neutral-400 hover:text-neutral-200">
              {l.title || "Untitled link"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

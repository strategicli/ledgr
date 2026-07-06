// The passage page (ADR-143, decision pt 5): a VIRTUAL view, not a stored item.
// The [ref] segment is the canonical `<start>[-<end>]` slug (passageSlug); the
// page decodes it against the static canon for the heading and runs one overlap
// query (itemsTouchingPassage) for the body — that same query IS the passage's
// backlinks. Nothing is seeded, trashed, or exported. Owner-scoped; body-free.
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import { resolveOwner } from "@/lib/owner";
import { bookByNum } from "@/lib/passages/canon";
import {
  decodeRef,
  formatPassageRef,
  parsePassageSlug,
} from "@/lib/passages/ref";
import { itemsTouchingPassage, type PassageBacklink } from "@/lib/passages/refs";

export const dynamic = "force-dynamic";

export default async function PassagePage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { ref } = await params;
  const passage = parsePassageSlug(decodeURIComponent(ref));
  if (!passage) notFound();

  const book = bookByNum(decodeRef(passage.startRef).book);
  const [backlinks, typeRows] = await Promise.all([
    itemsTouchingPassage(owner.id, passage),
    getDb().select({ key: types.key, label: types.label }).from(types),
  ]);
  const typeLabels = new Map(typeRows.map((t) => [t.key, t.label]));

  // One edge per row from the query; group by item so an item citing this
  // passage twice shows once, with each cited range beside it.
  const byItem = new Map<string, { title: string; type: string; refs: PassageBacklink[] }>();
  for (const b of backlinks) {
    const entry = byItem.get(b.itemId);
    if (entry) entry.refs.push(b);
    else byItem.set(b.itemId, { title: b.title, type: b.type, refs: [b] });
  }
  const grouped = [...byItem.entries()];

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          {book ? book.name : "Passage"}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {formatPassageRef(passage.startRef, passage.endRef)}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {grouped.length === 0
            ? "Nothing references this passage yet."
            : `${grouped.length} item${grouped.length === 1 ? "" : "s"} reference this passage.`}
        </p>

        {grouped.length > 0 && (
          <ul className="mt-6 divide-y divide-line">
            {grouped.map(([id, entry]) => (
              <li key={id} className="py-2">
                <a href={`/items/${id}`} className="text-ink hover:underline">
                  {entry.title || "Untitled"}
                </a>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  <span className="uppercase tracking-wide">
                    {typeLabels.get(entry.type) ?? entry.type}
                  </span>
                  {entry.refs.map((r) => (
                    <span key={`${r.startRef}-${r.endRef}`} className="text-ink-faint">
                      {formatPassageRef(r.startRef, r.endRef)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

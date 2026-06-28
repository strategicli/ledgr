// The Related Explorer (Discover, ADR-127 Phase 2): a focused, full-page map of
// everything related to one item — existing links and discovered candidates —
// score-sorted, with one-click Link and "Explore →" to re-anchor on any row and
// keep following the thread. A breadcrumb trail (?trail) remembers where you
// came from, so a loosely-related item becomes a launching point toward the one
// you're hunting for; the tail escalates into full search. Body-free and
// owner-scoped (exploreNeighborhood).
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { resolveOwner } from "@/lib/owner";
import { exploreNeighborhood } from "@/lib/discovery/explore";
import ExploreRow from "@/components/relations/ExploreRow";

export const dynamic = "force-dynamic";

const TRAIL_MAX = 6;

export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trail?: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { id } = await params;
  const { trail: trailRaw } = await searchParams;

  // Anchor: title + ownership + live check, body-free (never load the body here).
  const anchorRows = await getDb()
    .select({ id: items.id, title: items.title, deletedAt: items.deletedAt })
    .from(items)
    .where(and(eq(items.id, id), eq(items.ownerId, owner.id)));
  if (anchorRows.length === 0 || anchorRows[0].deletedAt) notFound();
  const anchor = anchorRows[0];
  const anchorTitle = anchor.title || "Untitled";

  const rows = await exploreNeighborhood(owner.id, id);

  // Breadcrumb trail (capped); resolve titles for the visited anchors.
  const trailIds = (trailRaw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-TRAIL_MAX);
  const trailTitles = trailIds.length
    ? await getDb()
        .select({ id: items.id, title: items.title })
        .from(items)
        .where(and(inArray(items.id, trailIds), eq(items.ownerId, owner.id)))
    : [];
  const titleById = new Map(trailTitles.map((t) => [t.id, t.title]));
  const nextTrail = [...trailIds, id].join(",");

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <Link href={`/items/${id}`} className="text-xs text-neutral-500 hover:text-neutral-300">
          ← Back to item
        </Link>

        {trailIds.length > 0 && (
          <nav className="mt-3 flex flex-wrap items-center gap-1 text-sm text-neutral-500">
            {trailIds.map((tid, i) => (
              <span key={tid} className="flex items-center gap-1">
                <Link
                  href={`/items/${tid}/explore?trail=${encodeURIComponent(
                    trailIds.slice(0, i).join(",")
                  )}`}
                  className="max-w-[12rem] truncate hover:text-neutral-300"
                >
                  {titleById.get(tid) || "Untitled"}
                </Link>
                <span className="text-neutral-700">›</span>
              </span>
            ))}
            <span className="max-w-[16rem] truncate font-semibold text-neutral-200">
              {anchorTitle}
            </span>
          </nav>
        )}

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-100">
          Explore related
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Everything related to “{anchorTitle}”, most-connected first. Open a row, or
          explore from it to keep following the thread.
        </p>

        {rows.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-600">
            Nothing related yet.{" "}
            <Link
              href={`/search?q=${encodeURIComponent(anchorTitle)}`}
              className="text-neutral-400 hover:text-neutral-200 hover:underline"
            >
              Search everything →
            </Link>
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-neutral-900">
            {rows.map((r) => (
              <ExploreRow
                key={r.id}
                anchorId={id}
                nextTrail={nextTrail}
                row={{
                  id: r.id,
                  type: r.type,
                  title: r.title,
                  score: r.score,
                  signals: r.signals,
                  linked: r.linked,
                }}
              />
            ))}
          </ul>
        )}

        <div className="mt-6">
          <Link
            href={`/search?q=${encodeURIComponent(anchorTitle)}`}
            className="text-xs text-neutral-600 hover:text-neutral-300"
          >
            Search everything about this →
          </Link>
        </div>
      </div>
    </main>
  );
}

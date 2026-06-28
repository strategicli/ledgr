// Loose Ends — Build › MAINTAIN (Discover, ADR-127 Phase 3): the relatedness
// engine inverted across the corpus. Under-connected items with their top
// suggested links inline, one-click to connect. Renders inside the Build
// sidebar shell (isBuildPath). Owner-scoped + body-free via findLooseEnds.
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { findLooseEnds } from "@/lib/discovery/loose-ends";
import LooseEndCard from "@/components/relations/LooseEndCard";

export const dynamic = "force-dynamic";

export default async function LooseEndsPage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const ends = await findLooseEnds(owner.id);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Loose Ends</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Under-connected items with a likely link or two. Connecting them grows the
          graph — and every link you make sharpens future suggestions.
        </p>

        {ends.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-neutral-800 p-5 text-sm text-neutral-500">
            Nothing loose right now — your items are well connected, or newer ones
            haven&rsquo;t surfaced a confident suggestion yet. Freshly added and
            imported items show up here as candidates to link.
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {ends.map((e) => (
              <LooseEndCard key={e.id} {...e} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

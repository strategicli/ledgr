// Search (PRD §4.2): full-text across titles and bodies, filtered by type,
// related person, and updated date. The server side only gathers the filter
// options; querying is client-driven through GET /api/search.
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import SearchClient from "@/components/search/SearchClient";
import { resolveOwner } from "@/lib/owner";
import { compareTypeKeys } from "@/lib/type-order";
import { listPersonOptions } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Search() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [typeRows, people] = await Promise.all([
    getDb().select({ key: types.key, label: types.label }).from(types),
    listPersonOptions(owner.id),
  ]);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Search
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Words, &quot;quoted phrases&quot;, OR, and -exclusions all work.
        </p>
        <div className="mt-6">
          <SearchClient
            types={typeRows.map((t) => ({ value: t.key, label: t.label }))}
            people={people.map((p) => ({
              value: p.id,
              label: p.title || "Untitled",
            }))}
          />
        </div>
      </div>
    </main>
  );
}

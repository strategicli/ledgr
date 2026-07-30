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

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  // Prefill from ?q= for the Discover "Search everything about this" handoff
  // (ADR-127).
  const initialQuery = (await searchParams).q ?? "";

  const [typeRows, people] = await Promise.all([
    getDb()
      .select({ key: types.key, label: types.label, propertySchema: types.propertySchema })
      .from(types),
    listPersonOptions(owner.id),
  ]);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));

  // Date-kind custom fields, offered alongcreated/updated as the "which date" a
  // fuzzy When criterion measures (ADR-172): an event's own date or a sermon's
  // preach date is often the thing you half-remember, not when you last touched
  // the row. Deduped by key across types, since two types can share a field name
  // and the criterion targets items.properties[key] regardless of type.
  const dateProps = new Map<string, string>();
  for (const t of typeRows) {
    for (const p of (t.propertySchema ?? []) as { key: string; label: string; kind: string }[]) {
      if (p.kind === "date" && p.key && !dateProps.has(p.key)) {
        dateProps.set(p.key, p.label || p.key);
      }
    }
  }

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
            initialQuery={initialQuery}
            types={typeRows.map((t) => ({ value: t.key, label: t.label }))}
            people={people.map((p) => ({
              value: p.id,
              label: p.title || "Untitled",
            }))}
            dateProps={[...dateProps].map(([value, label]) => ({ value, label }))}
          />
        </div>
      </div>
    </main>
  );
}

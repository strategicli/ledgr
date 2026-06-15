// The Build home is the System Overview (= the "Model Overview" entry in the
// sidebar's MAINTAIN group — same page, ADR-063). You enter Build, land here on a
// bird's-eye view of your system, and navigate via the left sidebar (the old
// card-grid navigation is retired — the sidebar does that job now).
//
// v1 is informational: counts and a "Needs attention" seed. The hygiene *actions*
// (cleaning up unused structure) land when /build/hygiene is built for real; this
// is the dashboard of the model, not the tools.
import Link from "next/link";
import { redirect } from "next/navigation";
import { itemCountsByType } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { listTemplates } from "@/lib/templates";
import { listTypes } from "@/lib/types";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 p-4">
      <div className="text-2xl font-bold tracking-tight text-neutral-100">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export default async function BuildHome() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [types, views, templates, counts] = await Promise.all([
    listTypes(),
    listViews(owner.id),
    listTemplates(owner.id),
    itemCountsByType(owner.id),
  ]);

  const customTypes = types.filter((t) => !t.isSystem).length;
  const totalItems = Object.values(counts).reduce((a, b) => a + b, 0);
  const pinnedViews = views.filter((v) => v.dashboardOrder != null).length;
  const zeroItemTypes = types.filter((t) => (counts[t.key] ?? 0) === 0);

  const templatesByType = new Map<string, number>();
  for (const t of templates) {
    templatesByType.set(t.type, (templatesByType.get(t.type) ?? 0) + 1);
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Model Overview
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          A bird&rsquo;s-eye view of your system. Build and maintain it from the
          sidebar.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={types.length} label={`Types${customTypes ? ` · ${customTypes} custom` : ""}`} />
          <Stat value={totalItems} label="Items" />
          <Stat value={views.length} label={`Views${pinnedViews ? ` · ${pinnedViews} on Work` : ""}`} />
          <Stat value={templates.length} label="Templates" />
        </div>

        {/* Types with item counts */}
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Types
            </h2>
            <Link href="/build/types" className="text-xs text-neutral-500 hover:text-neutral-300">
              Manage →
            </Link>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {types.map((t) => {
              const n = counts[t.key] ?? 0;
              return (
                <li
                  key={t.key}
                  className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-neutral-800/60"
                >
                  <Link
                    href={`/list/${t.key}`}
                    className="min-w-0 flex-1 truncate text-sm text-neutral-200 hover:text-neutral-100"
                  >
                    {t.label}
                  </Link>
                  {!t.isSystem && (
                    <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                      custom
                    </span>
                  )}
                  {templatesByType.get(t.key) ? (
                    <span className="shrink-0 text-xs text-neutral-600">
                      {templatesByType.get(t.key)} template
                      {templatesByType.get(t.key) === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      n === 0 ? "text-neutral-600" : "text-neutral-400"
                    }`}
                  >
                    {n}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Views, and which are surfaced on Work */}
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Views
            </h2>
            <Link href="/build/views" className="text-xs text-neutral-500 hover:text-neutral-300">
              Manage →
            </Link>
          </div>
          {views.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {views.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-neutral-800/60"
                >
                  <Link
                    href={`/views/${v.id}`}
                    className="min-w-0 flex-1 truncate text-sm text-neutral-200 hover:text-neutral-100"
                  >
                    {v.name}
                  </Link>
                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {v.layout}
                  </span>
                  {v.dashboardOrder != null && (
                    <span className="shrink-0 text-xs text-[var(--accent)]">on Work</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 px-2 text-sm text-neutral-600">
              No views yet.{" "}
              <Link href="/build/views" className="text-neutral-400 hover:text-neutral-200">
                Build one
              </Link>
              .
            </p>
          )}
        </section>

        {/* Needs attention — the seed of Data Hygiene */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Needs attention
          </h2>
          {zeroItemTypes.length > 0 ? (
            <div className="mt-2 rounded-xl border border-neutral-800 p-4">
              <p className="text-sm text-neutral-300">
                {zeroItemTypes.length} type{zeroItemTypes.length === 1 ? "" : "s"} with
                no items yet:
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {zeroItemTypes.map((t) => t.label).join(", ")}
              </p>
              <p className="mt-2 text-xs text-neutral-600">
                Cleaning up unused structure (empty types, views that return
                nothing, templates never applied) is{" "}
                <Link href="/build/hygiene" className="text-neutral-400 hover:text-neutral-200">
                  Data Hygiene
                </Link>{" "}
                — coming soon.
              </p>
            </div>
          ) : (
            <p className="mt-2 px-2 text-sm text-neutral-600">
              Nothing flagged. Every type has at least one item.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

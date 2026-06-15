// The Build surface home (PRD §4.10): the configuration side of Ledgr, where
// the building blocks are made — custom types & properties, views — and later
// wired into the Work surface (dashboard widgets, nav slots). Work is the
// daily-use side; Build holds the structures that feed it. Reached by the
// floating Build toggle (BuildModeButton); this page is just the landing menu.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { listTemplates } from "@/lib/templates";
import { listTypes } from "@/lib/types";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

function BuildCard({
  href,
  title,
  description,
  badge,
  soon,
  highlight,
}: {
  href?: string;
  title: string;
  description: string;
  badge?: string;
  soon?: boolean;
  highlight?: boolean;
}) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        {badge && (
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
            {badge}
          </span>
        )}
        {soon && (
          <span className="shrink-0 text-xs text-neutral-600">soon</span>
        )}
      </div>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
    </>
  );
  const border = highlight
    ? "border-[var(--accent)] shadow-[0_0_18px_-2px_var(--accent)]"
    : "border-neutral-800";
  const base = `block rounded-xl border ${border} p-4 text-left transition-colors`;
  if (soon || !href) {
    return <div className={`${base} opacity-60`}>{inner}</div>;
  }
  return (
    <Link href={href} className={`${base} hover:bg-neutral-900 ${highlight ? "" : "hover:border-neutral-700"}`}>
      {inner}
    </Link>
  );
}

export default async function BuildHome() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [types, views, templates] = await Promise.all([
    listTypes(),
    listViews(owner.id),
    listTemplates(owner.id),
  ]);
  const userTypes = types.filter((t) => !t.isSystem).length;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Build
          </h1>
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Back to Work
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          The configuration side: make the structures here, then surface the
          ones you use on Work.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BuildCard
            href="/build/types"
            title="Types & properties"
            description="Define custom item types and the fields they carry."
            badge={`${types.length} types${userTypes ? ` · ${userTypes} custom` : ""}`}
          />
          <BuildCard
            href="/views"
            title="Views"
            description="Saved ways to slice your items: list, table, board, calendar, agenda."
            badge={`${views.length}`}
          />
          <BuildCard
            href="/build/templates"
            title="Item templates"
            description="Reusable starting points for new tasks, meetings, and notes: preset fields and starter content."
            badge={templates.length ? `${templates.length}` : undefined}
          />
          <BuildCard
            href="/build/new"
            title="Workflows & wikis"
            description="Guided 'New Workflow' / 'New Wiki' creation that generates a type, its properties, and starter views."
          />
          <BuildCard
            href="/build/surface"
            title="Work surface"
            description="Choose which views become dashboard widgets and navigation slots."
          />
          <BuildCard
            href="/build/tools"
            title="Bespoke tools"
            description="Add a specialized capability (chord charts, a paper workspace) to a type you name yourself."
            highlight
          />
        </div>
      </div>
    </main>
  );
}

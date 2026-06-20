// Item templates index (ADR-093): the owner's per-type starting points, grouped
// by type. Each is backed by a real prototype item — the name links into that
// prototype's canvas to edit it; Delete trashes the prototype and drops the
// registry row. "New template" creates an empty one and opens its canvas.
import Link from "next/link";
import { redirect } from "next/navigation";
import DeleteTemplateButton from "@/components/build/DeleteTemplateButton";
import { resolveOwner } from "@/lib/owner";
import { listTemplates } from "@/lib/templates";
import { listTypes } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TemplatesIndex() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [templates, types] = await Promise.all([
    listTemplates(owner.id),
    listTypes(),
  ]);
  const labelFor = (key: string) =>
    types.find((t) => t.key === key)?.label ?? key;

  // Group by type, type order following the registry (system first).
  const byType = new Map<string, typeof templates>();
  for (const t of templates) {
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type)!.push(t);
  }
  const groups = types
    .map((t) => t.key)
    .filter((k) => byType.has(k))
    .map((k) => ({ key: k, label: labelFor(k), items: byType.get(k)! }));

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Item templates
          </h1>
          <div className="flex items-center gap-3">
            <Link href="/build" className="text-sm text-neutral-500 hover:text-neutral-300">
              ← Build
            </Link>
            <Link
              href="/build/templates/new"
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
            >
              New template
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Reusable starting points for new items. A template is a real item you
          author in the normal canvas; pick one from the “+ New” menu on any list.
        </p>

        {groups.length > 0 ? (
          <div className="mt-6 flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {group.label}
                </h2>
                <ul className="mt-1 flex flex-col gap-1">
                  {group.items.map((t) => (
                    <li
                      key={t.id}
                      className="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-neutral-800/60"
                    >
                      <Link
                        href={`/items/${t.prototypeItemId}`}
                        className="min-w-0 flex-1 truncate text-sm text-neutral-200 hover:text-white"
                      >
                        {t.name}
                      </Link>
                      {t.isDefault && (
                        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                          Default
                        </span>
                      )}
                      <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                        <DeleteTemplateButton id={t.id} name={t.name} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="mt-8 px-2 text-sm text-neutral-600">
            No templates yet. Create one to start new tasks, meetings, or notes
            from a preset.
          </p>
        )}
      </div>
    </main>
  );
}

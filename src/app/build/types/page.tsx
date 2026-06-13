// Types index (slice 33, PRD §3.6/§4.10): the type registry, system rows first
// then custom, each linking into its builder. Part of the Build surface.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { listTypes } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BuildTypes() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const types = await listTypes();

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Types
          </h1>
          <div className="flex items-center gap-3">
            <Link
              href="/build"
              className="text-sm text-neutral-500 hover:text-neutral-300"
            >
              ← Build
            </Link>
            <Link
              href="/build/types/new"
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
            >
              New type
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          The shapes your items take. Each type carries its own custom fields.
        </p>

        <ul className="mt-6 flex flex-col gap-1">
          {types.map((t) => {
            const count = t.propertySchema.length;
            return (
              <li key={t.key}>
                <Link
                  href={`/build/types/${t.key}/edit`}
                  className="group flex items-center gap-3 rounded px-2 py-2 hover:bg-neutral-800/60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    {t.label}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-neutral-600">
                    {t.key}
                  </span>
                  {count > 0 && (
                    <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                      {count} field{count === 1 ? "" : "s"}
                    </span>
                  )}
                  {t.isSystem && (
                    <span className="shrink-0 text-xs text-neutral-600">
                      system
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

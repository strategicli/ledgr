// Work surface wiring (slice 35, PRD §4.10/§4.14): choose which views appear on
// Work. The dashboard-widget half is real today — pin/unpin reuses the slice-29
// machinery (PinButton → /api/dashboard). Navigation slots are shown read-only
// (the nav is still the hardcoded NAV_SLOTS stand-in; making it data-driven is
// its own slice). "Surface it, then retire it" = pin here, unpin to retire —
// the data always stays.
import Link from "next/link";
import { redirect } from "next/navigation";
import PinButton from "@/components/views/PinButton";
import { NAV_SLOTS } from "@/lib/nav";
import { resolveOwner } from "@/lib/owner";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function WorkSurface() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const views = await listViews(owner.id);
  const pinned = views.filter((v) => v.dashboardOrder != null).length;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Work surface
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/build" className="text-neutral-500 hover:text-neutral-300">
              ← Build
            </Link>
            <Link href="/dashboard" className="text-neutral-500 hover:text-neutral-300">
              Dashboard →
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Choose what appears on Work. Pinned views become dashboard widgets;
          unpinning retires one without touching its data.
        </p>

        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Dashboard widgets{pinned ? ` · ${pinned} pinned` : ""}
          </h2>
          {views.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {views.map((view) => (
                <li
                  key={view.id}
                  className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-neutral-800/60"
                >
                  <Link
                    href={`/views/${view.id}`}
                    className="min-w-0 flex-1 truncate text-sm text-neutral-200 hover:text-neutral-100"
                  >
                    {view.name}
                  </Link>
                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {view.layout}
                  </span>
                  <PinButton viewId={view.id} pinned={view.dashboardOrder != null} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 px-2 text-sm text-neutral-600">
              No views yet.{" "}
              <Link href="/views/new" className="text-neutral-400 hover:text-neutral-200">
                Build one
              </Link>{" "}
              or generate a{" "}
              <Link href="/build/new" className="text-neutral-400 hover:text-neutral-200">
                workflow
              </Link>
              .
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Navigation slots
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            The bottom-bar slots, in order. Editing these from Build is a later
            slice; for now they’re the built-in set.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {NAV_SLOTS.map((slot) => (
              <li
                key={slot.key}
                className="rounded border border-neutral-800 px-2.5 py-1 text-sm text-neutral-400"
              >
                {slot.label}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

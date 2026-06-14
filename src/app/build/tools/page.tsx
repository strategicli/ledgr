// The Bespoke tools catalog (SPIKE — bespoke-tool catalog, next_steps.md:94).
// Lists the specialized capabilities the modules we've built offer up — a chord
// chart, a paper workspace — with what each does and how it can be used. The
// user picks one and builds a type *under their own name* that borrows it, so
// the behavior isn't locked to our `song`/`paper` keys (a "Worship Set" type can
// still get the ChordPro canvas). The decoupling lives in the module registry
// (modules.ts `attachableCapabilities` / capability-aware resolvers); this page
// is the storefront.
import Link from "next/link";
import { redirect } from "next/navigation";
import { attachableCapabilities } from "@/lib/modules";
import { resolveOwner } from "@/lib/owner";
// Side-effect: register the workflow modules so their capabilities show here.
import "@/lib/modules/register";

export const dynamic = "force-dynamic";

export default async function BespokeTools() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  // Owner-aware so a disabled module's capabilities drop out (same seam as types).
  const capabilities = attachableCapabilities(owner.id);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Bespoke tools
          </h1>
          <Link
            href="/build"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← Back to Build
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Specialized capabilities you can attach to a type you create. Name the
          type whatever fits your work; the tool rides underneath.
        </p>

        {capabilities.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-600">
            No bespoke tools are available yet.
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {capabilities.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-neutral-800 p-4"
              >
                <h2 className="text-sm font-semibold text-neutral-100">
                  {c.label}
                </h2>
                <p className="mt-1 text-sm text-neutral-400">{c.description}</p>
                <p className="mt-1 text-sm text-neutral-500">{c.usage}</p>
                <Link
                  href={`/build/types/new?capability=${encodeURIComponent(c.id)}`}
                  className="mt-3 inline-block rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
                >
                  Build a type with this →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

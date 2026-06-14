// Edit type (slice 33): the builder seeded with an existing type. notFound()
// for an unknown key. System types load here too (extendable, not deletable).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import TypeBuilder from "@/components/build/TypeBuilder";
import { capabilityById } from "@/lib/modules";
import { resolveOwner } from "@/lib/owner";
import { getType } from "@/lib/types";
import { ItemError } from "@/lib/items";

export const dynamic = "force-dynamic";

export default async function EditType({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { key } = await params;
  const type = await getType(key).catch((err) => {
    if (err instanceof ItemError && err.code === "not_found") notFound();
    throw err;
  });

  // SPIKE (bespoke-tool catalog): resolve any attached capability to its label
  // for the builder's banner.
  const cap = type.capability
    ? capabilityById(type.capability, owner.id)
    : undefined;
  const attached = cap ? { id: cap.id, label: cap.label } : null;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            {type.label}
          </h1>
          <Link
            href="/build/types"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← All types
          </Link>
        </div>
        <TypeBuilder initial={type} attached={attached} />
      </div>
    </main>
  );
}

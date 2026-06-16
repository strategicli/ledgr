// New type (slice 33): the builder with no initial definition. Static segment,
// so it wins over /build/types/[key] for the literal "new".
import Link from "next/link";
import { redirect } from "next/navigation";
import TypeBuilder from "@/components/build/TypeBuilder";
import { capabilityById } from "@/lib/modules";
import { resolveOwner } from "@/lib/owner";
import { listTypes } from "@/lib/types";
// Side-effect: register the workflow modules so a capability id resolves here.
import "@/lib/modules/register";

export const dynamic = "force-dynamic";

export default async function NewType({
  searchParams,
}: {
  searchParams: Promise<{ capability?: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  // SPIKE (bespoke-tool catalog): arriving from /build/tools carries the chosen
  // capability id; resolve it to {id, label} for the builder's banner + payload.
  // An unknown/absent id just builds a plain type.
  const { capability } = await searchParams;
  const cap = capability ? capabilityById(capability, owner.id) : undefined;
  const attached = cap ? { id: cap.id, label: cap.label } : null;

  // Live types feed a relation field's target-type dropdown (ADR-067).
  const availableTypes = (await listTypes()).map((t) => ({
    key: t.key,
    label: t.label,
  }));

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            New type
          </h1>
          <Link
            href="/build/types"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← All types
          </Link>
        </div>
        <TypeBuilder attached={attached} availableTypes={availableTypes} />
      </div>
    </main>
  );
}

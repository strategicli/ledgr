// New view (slice 27): the builder with no initial definition. Static segment,
// so it wins over /views/[id] for the literal "new".
import Link from "next/link";
import { redirect } from "next/navigation";
import ViewBuilder from "@/components/views/ViewBuilder";
import { resolveOwner } from "@/lib/owner";
import { listTypes } from "@/lib/types";
import { listPersonOptions } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function NewView() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [people, types] = await Promise.all([
    listPersonOptions(owner.id),
    listTypes(),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            New view
          </h1>
          <Link href="/views" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← All views
          </Link>
        </div>
        <ViewBuilder
          people={people.map((p) => ({ id: p.id, title: p.title }))}
          types={types.map((t) => ({
            key: t.key,
            label: t.label,
            propertySchema: t.propertySchema,
            statusMode: t.statusMode,
          }))}
        />
      </div>
    </main>
  );
}

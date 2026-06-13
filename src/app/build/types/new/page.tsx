// New type (slice 33): the builder with no initial definition. Static segment,
// so it wins over /build/types/[key] for the literal "new".
import Link from "next/link";
import { redirect } from "next/navigation";
import TypeBuilder from "@/components/build/TypeBuilder";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

export default async function NewType() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

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
        <TypeBuilder />
      </div>
    </main>
  );
}

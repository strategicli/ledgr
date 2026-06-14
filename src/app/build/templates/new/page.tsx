// New item template (slice 34): the builder with no initial template. An
// optional ?type= preselects which type it creates (the "+ New" menu and the
// type page link here with it set). Static segment, so it wins over [id].
import Link from "next/link";
import { redirect } from "next/navigation";
import TemplateBuilder from "@/components/build/TemplateBuilder";
import { resolveOwner } from "@/lib/owner";
import { listTypes } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewTemplate({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [{ type }, types] = await Promise.all([searchParams, listTypes()]);
  const defaultType = type && types.some((t) => t.key === type) ? type : undefined;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            New template
          </h1>
          <Link
            href="/build/templates"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← All templates
          </Link>
        </div>
        <TemplateBuilder types={types} defaultType={defaultType} />
      </div>
    </main>
  );
}

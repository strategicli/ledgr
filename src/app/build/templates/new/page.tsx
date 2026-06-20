// New item template (ADR-093): a minimal name + type form. An optional ?type=
// preselects which type it creates (the "+ New" menu links here with it set).
// Static segment, so it wins over [id]. The actual content is authored in the
// prototype's canvas, which the form opens on create.
import Link from "next/link";
import { redirect } from "next/navigation";
import NewTemplateForm from "@/components/build/NewTemplateForm";
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
        <NewTemplateForm types={types} defaultType={defaultType} />
      </div>
    </main>
  );
}

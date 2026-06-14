// Edit item template (slice 34): the builder seeded with an existing template.
// notFound() for an unknown/foreign id (getTemplate is owner-scoped).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import TemplateBuilder from "@/components/build/TemplateBuilder";
import { ItemError } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getTemplate } from "@/lib/templates";
import { listTypes } from "@/lib/types";
import { listEntityOptions } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function EditTemplate({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { id } = await params;
  const [template, types, entities] = await Promise.all([
    getTemplate(owner.id, id).catch((err) => {
      if (err instanceof ItemError && err.code === "not_found") notFound();
      throw err;
    }),
    listTypes(),
    listEntityOptions(owner.id),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            {template.name}
          </h1>
          <Link
            href="/build/templates"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← All templates
          </Link>
        </div>
        <TemplateBuilder types={types} entities={entities} initial={template} />
      </div>
    </main>
  );
}

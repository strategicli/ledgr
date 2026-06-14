// Workflows & wikis (slice 35, PRD §4.14): the template-driven creation surface.
// One query-driven page — with no `kind` it shows the chooser ("New Workflow" /
// "New Wiki" plus a few named presets, the "small set of big, obvious starting
// buttons"); with `kind` set it shows the guided StructureBuilder, optionally
// prefilled from a `preset`. The generator (the API) turns the answers into a
// type + properties + starter views.
import Link from "next/link";
import { redirect } from "next/navigation";
import StructureBuilder from "@/components/build/StructureBuilder";
import { resolveOwner } from "@/lib/owner";
import {
  presetById,
  STRUCTURE_PRESETS,
  type StructureKind,
} from "@/lib/structure-templates";

export const dynamic = "force-dynamic";

const KIND_BLURB: Record<StructureKind, string> = {
  workflow:
    "A step-based process: records move through stages on a board. Hiring, content production, anything with a pipeline.",
  wiki:
    "Interconnected reference entries, cross-linked with @-mentions and written inside each. Trip archives, campaign notes, reading lists.",
};

function Card({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-neutral-800 p-4 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900"
    >
      <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
    </Link>
  );
}

export default async function NewStructure({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; preset?: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { kind, preset } = await searchParams;

  // --- Guided form mode ---
  if (kind === "workflow" || kind === "wiki") {
    const chosen = preset ? presetById(preset) : undefined;
    const presetForKind = chosen && chosen.kind === kind ? chosen : null;
    const heading = kind === "workflow" ? "New workflow" : "New wiki";

    return (
      <main className="min-h-screen">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
              {heading}
            </h1>
            <Link
              href="/build/new"
              className="text-sm text-neutral-500 hover:text-neutral-300"
            >
              ← Back
            </Link>
          </div>
          <p className="mt-1 text-sm text-neutral-500">{KIND_BLURB[kind]}</p>
          <StructureBuilder kind={kind} preset={presetForKind} />
        </div>
      </main>
    );
  }

  // --- Chooser mode ---
  const workflows = STRUCTURE_PRESETS.filter((p) => p.kind === "workflow");
  const wikis = STRUCTURE_PRESETS.filter((p) => p.kind === "wiki");

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Workflows & wikis
          </h1>
          <Link href="/build" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Build
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Spin up a whole structured area in one step: a guided form generates
          the type, its fields, and starter views. Start blank or from a preset.
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-neutral-200">Workflows</h2>
          <p className="mt-0.5 text-sm text-neutral-500">{KIND_BLURB.workflow}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card
              href="/build/new?kind=workflow"
              title="＋ New workflow"
              description="Start blank: name it, define the stages and fields."
            />
            {workflows.map((p) => (
              <Card
                key={p.id}
                href={`/build/new?kind=workflow&preset=${p.id}`}
                title={p.label}
                description={p.description}
              />
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-neutral-200">Wikis</h2>
          <p className="mt-0.5 text-sm text-neutral-500">{KIND_BLURB.wiki}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card
              href="/build/new?kind=wiki"
              title="＋ New wiki"
              description="Start blank: name it and define the fields each entry carries."
            />
            {wikis.map((p) => (
              <Card
                key={p.id}
                href={`/build/new?kind=wiki&preset=${p.id}`}
                title={p.label}
                description={p.description}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

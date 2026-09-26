// The Present control in Export & sharing, shown only while the presentations
// module is on. Core canvases reach it through src/lib/module-panels.tsx.
import { moduleOnFor } from "@/lib/modules/enabled";
import { resolveOwner } from "@/lib/owner";

export default async function PresentPanel({ itemId }: { itemId: string }) {
  const owner = await resolveOwner();
  if (!owner || !(await moduleOnFor(owner.id, "presentations"))) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={`/present/${itemId}`}
        target="_blank"
        rel="noopener"
        className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
      >
        Present
      </a>
      <span className="group relative text-xs text-ink-subtle">
        <span className="cursor-help underline decoration-dotted decoration-neutral-600 underline-offset-2">
          what this does
        </span>
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 w-72 rounded border border-neutral-700 bg-neutral-900 p-2 text-xs normal-case text-neutral-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          Opens this item as a slideshow in a new tab, with your notes, the next
          slide and a timer. Use <strong>Open audience window</strong> for the
          projector. Slides come from <strong>slide marks</strong>, or from{" "}
          <strong>---</strong> lines when nothing is marked. Comments become
          speaker notes.
        </span>
      </span>
    </div>
  );
}

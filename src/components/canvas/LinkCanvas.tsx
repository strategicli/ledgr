// The `link` type's bespoke canvas — core's own use of the per-type canvas seam
// (ADR-041), now resolved through the module boundary (M6, ADR-043: `link`'s
// canvasId is declared on coreModule). A link item is really a URL plus a note
// about it, so this foregrounds the URL as a click-through affordance, then
// delegates everything else to the default markdown canvas. It's the pattern a
// real module canvas follows — add a bespoke surface, reuse the standard canvas
// underneath. Point coreModule's `link` type back at the default canvas and
// links fall straight back; nothing else depends on this.
import MarkdownCanvas from "@/components/canvas/MarkdownCanvas";
import type { CanvasProps } from "@/lib/modules";

export default function LinkCanvas(props: CanvasProps) {
  const { item } = props;
  return (
    <>
      {item.url && (
        <div className="mx-auto w-full max-w-3xl px-12 pt-6">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-full items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-sky-400 hover:border-neutral-600 hover:text-sky-300"
            title={item.url}
          >
            <span className="truncate">{item.url}</span>
            <span aria-hidden className="shrink-0 text-neutral-500">
              ↗
            </span>
          </a>
        </div>
      )}
      <MarkdownCanvas {...props} />
    </>
  );
}

// The `song` type's canvas (Song module). S2 is the read-only chart preview —
// it proves the canvas dispatch (canvasIdForType "song" → "chord" → here) and
// the chordpro renderer end to end. S3 replaces this body with the Edit ⇄
// Preview editor + the shared CanvasPanels; the chart render shown here is
// exactly what Preview / print / share produce (one renderer, render.ts).
import { bodyMarkdown } from "@/lib/body";
import { CHART_CSS } from "@/lib/chordpro/chart-css";
import { chordProToHtml } from "@/lib/chordpro/render";
import type { CanvasProps } from "@/lib/modules";

export default function ChordCanvas({ item }: CanvasProps) {
  const source = bodyMarkdown(item.body); // returns body.text for any {format,text}
  const html = chordProToHtml(source);
  return (
    <div className="mx-auto w-full max-w-3xl px-12 py-6">
      <style>{CHART_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

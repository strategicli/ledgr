// The wiring half of the module-registration boundary (M6, ADR-043) — the one
// thing that can't be pure: a canvas id → its React component. The *policy*
// (which canvas id a type uses) lives in `modules.ts`, kept pure so it stays
// node-testable; this file maps those ids to the actual components, so a verify
// script (or any pure import of the registry) never drags the editor bundle in.
// The two halves are linked by the `canvasId` string a module declares on its
// type. A `?? MarkdownCanvas` fallback keeps a policy/wiring drift (an id with no
// component) from crashing the page.
//
// A workflow module adds its canvas component here (a chord grid, a paper
// workspace); core wires the two it ships — the default markdown canvas and the
// `link` URL chip (ADR-041).
import ChordCanvas from "@/components/canvas/ChordCanvas";
import LinkCanvas from "@/components/canvas/LinkCanvas";
import MarkdownCanvas from "@/components/canvas/MarkdownCanvas";
import PaperCanvas from "@/components/canvas/PaperCanvas";
import { DEFAULT_CANVAS, type CanvasComponent } from "@/lib/modules";
// Side-effect import: registers the workflow modules (Songs, …) onto core so a
// `song` resolves its `chord` canvas. This is the canvas-dispatch path
// (ItemCanvas imports this file), so registration happens before any render.
import "@/lib/modules/register";

const CANVAS_COMPONENTS: Record<string, CanvasComponent> = {
  [DEFAULT_CANVAS]: MarkdownCanvas,
  link: LinkCanvas,
  chord: ChordCanvas,
  paper: PaperCanvas,
};

// Resolve a canvas id (from `canvasIdForType`) to its component. Anything
// unwired falls back to the default markdown canvas.
export function canvasComponentFor(canvasId: string): CanvasComponent {
  return CANVAS_COMPONENTS[canvasId] ?? MarkdownCanvas;
}

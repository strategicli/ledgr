// The Mindmap module (bespoke tool; on the M6 boundary, ADR-042 — modules sit on
// core, "move fast, solo" per CLAUDE.md). Pure manifest: it declares the
// `mindmap` type as markdown-canonical with its own `mindmap` canvas, imports no
// React component (the canvas is wired by id in module-wiring.tsx) and nothing
// heavy, so it stays node-pure like the rest of the registry.
//
// No exporter is declared: a mindmap IS a markdown nested list, so the standard
// markdown/OneDrive export already emits the `.md` (PRD §6) — there's no derived
// artifact to render. See explorations/mindmap-tool-prd.md.
import { MARKDOWN_FORMAT } from "@/lib/body";
import type { ModuleManifest } from "@/lib/modules";

export const mindmapModule: ModuleManifest = {
  id: "mindmap",
  label: "Mindmap",
  enabledByDefault: true,
  types: [
    {
      key: "mindmap",
      label: "Mindmap",
      icon: "network",
      canonicalFormat: MARKDOWN_FORMAT,
      canvasId: "mindmap",
    },
  ],
  exporters: [],
  // The bespoke-tool catalog (SPIKE): the mindmap canvas offered up for
  // attachment to a user-named type, so the map isn't locked to the `mindmap`
  // key — a user's "Brainstorm" or "Project Map" type can adopt it. Because the
  // body is a markdown nested list, the canonical format is plain markdown, so an
  // attached type round-trips and exports like any other markdown item.
  capabilities: [
    {
      id: "mindmap-canvas",
      label: "Mindmap",
      description:
        "A central node with spokes, and spokes off those spokes — an expand/collapse map you edit in place.",
      usage:
        "Brainstorm outward from one idea: a sermon spray, a project breakdown, a topic map. Saved as a plain markdown nested list you can export or hand-edit.",
      canvasId: "mindmap",
      canonicalFormat: MARKDOWN_FORMAT,
    },
  ],
};

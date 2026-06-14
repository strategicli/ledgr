// The Papers module (Tyler's lane, on the M6 boundary; ADR-042 — modules sit on
// core). Pure manifest: it declares the `paper` type as markdown-canonical with
// its own `paper` canvas (the Quote Bank · Outline · Draft workspace), imports no
// React component (the canvas is wired by id in module-wiring.tsx) and nothing
// heavy, so it stays node-pure like the rest of the registry.
//
// No exporter is declared here on purpose: the paper's deliverable is an MSM
// .docx, a *binary* render, and ExporterDef.render returns a string. The docx
// ships through a dedicated route (app/api/items/[id]/render-docx) instead of the
// exporter slot, which keeps the core module contract untouched (a both-builder
// concern). The citation engine + docx renderer are the module's real work and
// live in src/lib/papers/.
import { MARKDOWN_FORMAT } from "@/lib/body";
import type { ModuleManifest } from "@/lib/modules";

export const paperModule: ModuleManifest = {
  id: "papers",
  label: "Papers",
  enabledByDefault: true,
  types: [
    {
      key: "paper",
      label: "Paper",
      icon: "file-text",
      canonicalFormat: MARKDOWN_FORMAT,
      canvasId: "paper",
    },
  ],
  exporters: [],
};

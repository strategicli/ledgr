// The Songs module (Tyler's lane, on top of the M6 boundary; ADR-042 — modules
// sit on core). Pure manifest: it declares the `song` type with ChordPro as its
// canonical body format and the `chord` canvas, but imports no React component
// (the canvas is wired by id in module-wiring.tsx) and nothing heavy, so it
// stays node-pure like the rest of the registry. Exporters (ChordPro→chart PDF,
// transposed chart) and a Planning Center integration are deferred (the plan's
// out-of-branch list); the slots are here when they land.
import { toPlanningCenterChordPro } from "@/lib/chordpro/export";
import { parseChordPro } from "@/lib/chordpro/parse";
import { CHORDPRO_FORMAT } from "@/lib/chordpro/types";
import type { ModuleManifest } from "@/lib/modules";

export const songModule: ModuleManifest = {
  id: "songs",
  label: "Songs",
  enabledByDefault: true,
  types: [
    {
      key: "song",
      label: "Song",
      icon: "music",
      canonicalFormat: CHORDPRO_FORMAT,
      canvasId: "chord",
    },
  ],
  // Portable ChordPro for Planning Center's Lyrics & Chords editor (copy/paste;
  // the canvas "Copy for Planning Center" button uses the same renderer live).
  exporters: [
    {
      id: "song-chordpro-pco",
      label: "ChordPro (Planning Center)",
      forType: "song",
      fileExtension: "cho",
      render: (body) => toPlanningCenterChordPro(parseChordPro(body.text)),
    },
  ],
  // SPIKE (bespoke-tool catalog, next_steps.md:94): offer the chord behavior up
  // for attachment to a user-named type. The chord chart isn't locked to the
  // `song` key — someone can make a "Worship Set" or "Music" type and still get
  // the ChordPro canvas, transpose, and the Planning Center export underneath.
  capabilities: [
    {
      id: "chord-chart",
      label: "Chord Chart",
      description:
        "A ChordPro chart editor: chords sit above the lyrics, with transpose and a Planning Center copy button.",
      usage:
        "Use it for a song, but also for a worship set, a setlist, or any sheet where you want to see and shift chords over words.",
      canvasId: "chord",
      canonicalFormat: CHORDPRO_FORMAT,
    },
  ],
};

// Client half of the song canvas (S3): owns the ChordChart AST, the Edit ⇄
// Preview toggle, and autosave. Edit mode is the WYSIWYG ChordEditor; Preview
// is the finished chart from the shared renderer — byte-for-byte what print and
// share produce. Lifting the AST here lets both modes read the same live state.
"use client";

import { useMemo, useState } from "react";
import { bodyMarkdown } from "@/lib/body";
import { CHART_CSS } from "@/lib/chordpro/chart-css";
import { toPlanningCenterChordPro } from "@/lib/chordpro/export";
import { parseChordPro, serializeChordChart } from "@/lib/chordpro/parse";
import { chartToHtml } from "@/lib/chordpro/render";
import { CHORDPRO_FORMAT, type ChordChart } from "@/lib/chordpro/types";
import ChordEditor from "@/components/chord-editor/ChordEditor";
import TransposeControl from "@/components/chord-editor/TransposeControl";
import { updateMeta } from "@/components/chord-editor/chordpro-edit";
import { useItemAutosave } from "@/components/chord-editor/useItemAutosave";

type Props = { itemId: string; initialTitle: string; initialBody: unknown };

const STATUS: Record<string, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed, retrying",
};

export default function ChordCanvasClient({ itemId, initialTitle, initialBody }: Props) {
  const [chart, setChart] = useState<ChordChart>(() => parseChordPro(bodyMarkdown(initialBody)));
  const [title, setTitle] = useState(initialTitle);
  // Songs open in Preview (v5) — you read/perform far more than you edit.
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [copied, setCopied] = useState(false);
  const { patch, saveState } = useItemAutosave(itemId);

  const copyForPCO = async () => {
    try {
      await navigator.clipboard.writeText(toPlanningCenterChordPro(chart));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const commitChart = (next: ChordChart) => {
    setChart(next);
    patch({ body: { format: CHORDPRO_FORMAT, text: serializeChordChart(next) } });
  };

  const commitTitle = (t: string) => {
    setTitle(t);
    const next = updateMeta(chart, { title: t });
    setChart(next);
    patch({ title: t, body: { format: CHORDPRO_FORMAT, text: serializeChordChart(next) } });
  };

  const previewHtml = useMemo(() => chartToHtml(chart), [chart]);

  return (
    <div className="w-full">
      <style>{CHART_CSS}</style>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-6 pt-4">
        <div className="inline-flex overflow-hidden rounded-md border border-neutral-700 text-xs">
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 capitalize ${
                mode === m ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className={`text-xs ${saveState === "error" ? "text-red-400" : "text-neutral-500"}`}>
          {STATUS[saveState]}
        </span>
        <button
          onClick={() => void copyForPCO()}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          title="Copy ChordPro to paste into Planning Center's Lyrics & Chords editor"
        >
          {copied ? "Copied ✓" : "Copy for Planning Center"}
        </button>
        <div className="ml-auto">
          <TransposeControl chart={chart} onChange={commitChart} />
        </div>
      </div>

      {mode === "edit" ? (
        <ChordEditor chart={chart} onChange={commitChart} title={title} onTitleChange={commitTitle} />
      ) : (
        <div className="cc-canvas mx-auto w-full max-w-6xl px-8 py-6">
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}
    </div>
  );
}

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
import { appendLyrics, chartToLyricsMarkdown } from "@/lib/chordpro/lyrics";
import { chartToHtml } from "@/lib/chordpro/render";
import { CHORDPRO_FORMAT, type ChordChart } from "@/lib/chordpro/types";
import ChordEditor from "@/components/chord-editor/ChordEditor";
import TransposeControl from "@/components/chord-editor/TransposeControl";
import { updateMeta } from "@/components/chord-editor/chordpro-edit";
import { useItemAutosave } from "@/components/chord-editor/useItemAutosave";

type Props = { itemId: string; initialTitle: string; initialBody: unknown };
type Mode = "lyrics" | "edit" | "preview";

const STATUS: Record<string, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed, retrying",
};

export default function ChordCanvasClient({ itemId, initialTitle, initialBody }: Props) {
  const [chart, setChart] = useState<ChordChart>(() => parseChordPro(bodyMarkdown(initialBody)));
  const [title, setTitle] = useState(initialTitle);
  // A song with content opens in Preview (you read/perform more than you edit);
  // an empty one opens in Lyrics so you can paste a set in to start (v5).
  const [mode, setMode] = useState<Mode>(() =>
    parseChordPro(bodyMarkdown(initialBody)).sections.length ? "preview" : "lyrics"
  );
  const [lyricsText, setLyricsText] = useState("");
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

  // Paste lyrics → sections (chorus de-dup), append to the chart, jump to Edit
  // to add chords. Non-destructive: existing sections stay.
  const addLyrics = () => {
    if (!lyricsText.trim()) return;
    commitChart(appendLyrics(chart, lyricsText));
    setLyricsText("");
    setMode("edit");
  };

  // Save the song's lyrics (chords stripped, refs expanded) as a markdown file.
  const saveLyricsMarkdown = () => {
    const url = URL.createObjectURL(new Blob([chartToLyricsMarkdown(chart)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "lyrics").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const previewHtml = useMemo(() => chartToHtml(chart), [chart]);

  return (
    <div className="w-full">
      <style>{CHART_CSS}</style>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-6 pt-4">
        <div className="inline-flex overflow-hidden rounded-md border border-neutral-700 text-xs">
          {(["lyrics", "edit", "preview"] as const).map((m) => (
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
        <button
          onClick={saveLyricsMarkdown}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          title="Save the lyrics (no chords) as a markdown file"
        >
          Save lyrics (.md)
        </button>
        <div className="ml-auto">
          <TransposeControl chart={chart} onChange={commitChart} />
        </div>
      </div>

      {mode === "lyrics" ? (
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          <p className="mb-2 text-sm text-neutral-500">
            Paste a full set of lyrics. Section headers (Verse 1, Chorus, Bridge, [Tag]…) start a section; every
            other line is a lyric line. A repeated section name is recalled, not duplicated, so a chorus isn&apos;t
            repeated &mdash; label it &ldquo;Chorus 2&rdquo; for a different one. Add to the song, then add chords in Edit.
          </p>
          <textarea
            value={lyricsText}
            onChange={(e) => setLyricsText(e.target.value)}
            placeholder={"VERSE 1\nBy faith they held the promise\n…\n\nCHORUS\nThey were waiting for heaven\n…"}
            className="min-h-[16rem] w-full resize-y rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-[var(--accent)] placeholder:text-neutral-700"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={addLyrics}
              disabled={!lyricsText.trim()}
              className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              Add to song
            </button>
          </div>
        </div>
      ) : mode === "edit" ? (
        <ChordEditor chart={chart} onChange={commitChart} title={title} onTitleChange={commitTitle} />
      ) : (
        <div className="cc-canvas mx-auto w-full max-w-6xl px-8 py-6">
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}
    </div>
  );
}

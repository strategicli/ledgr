// M2 scratch harness (ADR-038): the Tiptap markdown editor in the shape the
// product will actually use — a WordPress-style Visual / Markdown toggle.
//  - Visual: the WYSIWYG (toolbar + keyboard shortcuts; Ctrl+B bolds, etc.).
//  - Markdown: the raw canonical source in an editable textarea.
// Switching Markdown → Visual re-renders the editor from the edited source via
// setContent({contentType:"markdown"}); switching back shows editor.getMarkdown().
// That toggle round-trip IS the M2 proof. Isolated: localStorage only, no items
// table, no BlockNote. A dev surface, not a product screen — deleted at M4/M5.
"use client";

import { useEffect, useState } from "react";
import LazyMarkdownEditor from "@/components/markdown-editor/LazyMarkdownEditor";

const STORAGE_KEY = "ledgr.scratch.editor.md";

const SAMPLE = `# Sermon working notes

A line with **bold**, *italic*, and a <span style="color:#e03e3e">red phrase</span> plus a <mark class="hl-yellow" style="background-color:#fbf3db">highlighted</mark> one.

## Points

- First, the covenant
- Second, the call

> "For by grace you have been saved."

Prep with [@Elder meeting](ledgr://item/00000000-0000-0000-0000-000000000000).
`;

type Mode = "visual" | "markdown";

export default function ScratchEditorClient() {
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>("visual");
  // The single source of truth: the current markdown. Visual edits push here
  // via onChange; markdown-mode edits write it directly.
  const [markdown, setMarkdown] = useState("");
  // The document handed to the Tiptap editor; bumping `epoch` remounts it so a
  // mode switch / reload / reset re-parses the markdown cleanly.
  const [seed, setSeed] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Client-only init: localStorage is unavailable during SSR, so read it on
  // mount, behind the "Loading…" gate below, to avoid a hydration mismatch.
  // The setState batch is the whole point here (a deliberate deferral), so the
  // effect-setState rule doesn't apply.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial = stored ?? SAMPLE;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSeed(initial);
    setMarkdown(initial);
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Re-seed the visual editor from the latest markdown (after editing source).
  const reseedVisual = () => {
    setSeed(markdown);
    setEpoch((n) => n + 1);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "visual") reseedVisual(); // apply any raw-source edits
    setMode(next);
  };

  const save = () => {
    window.localStorage.setItem(STORAGE_KEY, markdown);
    setSavedAt(new Date().toLocaleTimeString());
  };

  const reloadFromSaved = () => {
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? SAMPLE;
    setMarkdown(stored);
    setSeed(stored);
    setEpoch((n) => n + 1);
  };

  const resetToSample = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setMarkdown(SAMPLE);
    setSeed(SAMPLE);
    setEpoch((n) => n + 1);
    setSavedAt(null);
  };

  if (!loaded) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* Visual / Markdown toggle */}
        <div className="inline-flex overflow-hidden rounded border border-neutral-700">
          <button
            type="button"
            onClick={() => switchMode("visual")}
            className={`px-3 py-1 text-sm ${
              mode === "visual"
                ? "bg-neutral-700 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            Visual
          </button>
          <button
            type="button"
            onClick={() => switchMode("markdown")}
            className={`px-3 py-1 text-sm ${
              mode === "markdown"
                ? "bg-neutral-700 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            Markdown
          </button>
        </div>

        <span className="h-5 w-px bg-neutral-800" />

        <button
          type="button"
          onClick={save}
          className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white hover:brightness-110"
        >
          Save
        </button>
        <button
          type="button"
          onClick={reloadFromSaved}
          className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Reload from saved
        </button>
        <button
          type="button"
          onClick={resetToSample}
          className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
        >
          Reset to sample
        </button>
        {savedAt && (
          <span className="text-xs text-neutral-500">Saved {savedAt}</span>
        )}
      </div>

      {mode === "visual" ? (
        <LazyMarkdownEditor
          key={epoch}
          initialMarkdown={seed}
          onChange={setMarkdown}
        />
      ) : (
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          spellCheck={false}
          className="h-[32rem] w-full rounded border border-neutral-800 bg-neutral-950 p-4 font-mono text-sm leading-relaxed text-neutral-200 outline-none"
        />
      )}
    </div>
  );
}

// Inline edit (ADR-271, Feature 2): the popover under a selection. Type an
// instruction (or tap a chip, or "/" a prompt), see Claude's rewrite as a
// word-level diff, then Accept (Enter), Reject (Esc), Retry, or Refine. Accept
// is one editor transaction, so one Ctrl+Z restores the original.
//
// Stale guard: if the selected range is edited while Claude works, the
// proposal is marked stale and never applied over the new text.
"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { diffWords } from "@/lib/diff";
import AgentInput, { type Submit } from "./AgentInput";

const CHIPS: { label: string; instruction: string; voice?: boolean }[] = [
  { label: "Tighten", instruction: "Tighten this: cut filler, keep the meaning." },
  { label: "Fix grammar", instruction: "Fix grammar, spelling, and punctuation only. Don't change the meaning or the wording beyond that." },
  { label: "My voice", instruction: "Rewrite this in my voice.", voice: true },
  { label: "Warmer", instruction: "Make this warmer and more personal." },
  { label: "Simplify", instruction: "Simplify this into plain language." },
  { label: "Bullets", instruction: "Turn this into a bulleted list." },
  { label: "Expand", instruction: "Expand this with a little more detail." },
];

type Serializer = { serialize(json: unknown): string };

// The selection as stored markdown (color spans and all), so the model edits
// exactly what's saved.
function sliceMarkdown(editor: Editor, from: number, to: number): string {
  if (from === to) return "";
  const md = (editor as unknown as { markdown?: Serializer }).markdown;
  const cut = editor.state.doc.cut(from, to);
  return md ? md.serialize(cut.toJSON()).trim() : editor.state.doc.textBetween(from, to, "\n");
}

type Result = { proposalId: string; text: string; formattingWarning: boolean };

export default function InlineEdit({
  editor,
  itemId,
  onClose,
}: {
  editor: Editor;
  itemId?: string;
  onClose: () => void;
}) {
  const [range] = useState(() => ({ from: editor.state.selection.from, to: editor.state.selection.to }));
  const [original] = useState(() => sliceMarkdown(editor, range.from, range.to));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [stale, setStale] = useState(false);
  const [last, setLast] = useState<{ instruction: string; voice: boolean; promptId: string | null } | null>(null);
  const live = useRef({ ...range, touched: false });
  const abort = useRef<AbortController | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Place under the selection; follow it on scroll.
  useEffect(() => {
    const place = () => {
      try {
        const c = editor.view.coordsAtPos(live.current.to);
        setPos({ top: c.bottom + 8, left: Math.max(8, Math.min(c.left - 40, window.innerWidth - 440)) });
      } catch {
        setPos(null);
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [editor]);

  // Track the range through edits; any step touching it makes a result stale.
  useEffect(() => {
    const onTr = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      if (!transaction.docChanged) return;
      const r = live.current;
      transaction.mapping.maps.forEach((m) =>
        m.forEach((oldStart, oldEnd) => {
          if (oldStart <= r.to && oldEnd >= r.from) r.touched = true;
        })
      );
      r.from = transaction.mapping.map(r.from, -1);
      r.to = transaction.mapping.map(r.to, 1);
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
  }, [editor]);

  const record = (status: "accepted" | "rejected" | "stale") => {
    if (result) void fetch(`/api/agent/inline/${result.proposalId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  };

  async function ask(instruction: string, voice: boolean, promptId: string | null) {
    setBusy(true);
    setError(null);
    setResult(null);
    setStale(false);
    setLast({ instruction, voice, promptId });
    live.current.touched = false;
    const doc = editor.state.doc;
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await fetch("/api/agent/inline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({
          itemId,
          instruction,
          voice,
          commandPromptId: promptId,
          selected: original,
          before: doc.textBetween(Math.max(0, range.from - 1500), range.from, "\n"),
          after: doc.textBetween(range.to, Math.min(doc.content.size, range.to + 1500), "\n"),
        }),
      });
      const d = (await r.json()) as Result & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setResult(d);
      if (live.current.touched) {
        setStale(true);
        void fetch(`/api/agent/inline/${d.proposalId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "stale" }) });
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function accept() {
    if (!result || stale || live.current.touched) return;
    const { from, to } = live.current;
    editor.chain().focus().insertContentAt({ from, to }, result.text, { contentType: "markdown" } as never).run();
    record("accepted");
    onClose();
  }
  function reject() {
    abort.current?.abort();
    record("rejected");
    onClose();
    editor.commands.focus();
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        reject();
      } else if (
        result &&
        !stale &&
        (e.key === "Enter" || e.key === "Tab") &&
        !e.shiftKey &&
        // An empty refine box means "accept"; typed text there is a refinement.
        !(e.target instanceof HTMLTextAreaElement && e.target.value.trim())
      ) {
        e.preventDefault();
        accept();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const onSubmit = (s: Submit) => {
    if (result && last && s.text && !s.prompt) {
      // Refine: build on the last attempt rather than starting over.
      void ask(`${last.instruction}\n\nYour previous attempt was:\n${result.text}\n\nNow: ${s.text}`, last.voice, last.promptId);
      return;
    }
    void ask(s.text || s.prompt?.title || "Improve this", false, s.prompt?.id ?? null);
  };

  const wide = typeof window !== "undefined" && window.innerWidth >= 640;
  return (
    <div
      role="dialog"
      aria-label="Edit with Claude"
      style={wide && pos ? { top: pos.top, left: pos.left } : undefined}
      className={`fixed z-[65] flex max-h-[70vh] flex-col gap-2 overflow-auto rounded-card border border-line-strong bg-surface-2 p-2 shadow-2xl ${
        wide ? "w-[26rem]" : "inset-x-2 bottom-2"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-ink-subtle">
        <span>{original ? "Edit with Claude" : "Write with Claude at the cursor"}</span>
        <button type="button" onClick={reject} aria-label="Close" className="px-1 hover:text-ink">
          ✕
        </button>
      </div>
      {!result && !busy && (
        <div className="flex flex-wrap gap-1">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => void ask(c.instruction, !!c.voice, null)}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span className="animate-pulse">Claude is writing…</span>
          <button type="button" onClick={() => abort.current?.abort()} className="underline">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
      {result && (
        <>
          <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface-0 p-2 text-sm leading-relaxed text-ink-muted">
            {diffWords(original, result.text).map((s, i) =>
              s.op === "eq" ? (
                <span key={i}>{s.text}</span>
              ) : s.op === "del" ? (
                <span key={i} className="text-red-300 line-through decoration-red-400/70">{s.text}</span>
              ) : (
                <span key={i} className="text-emerald-300 underline decoration-emerald-400/70">{s.text}</span>
              )
            )}
          </div>
          {result.formattingWarning && !stale && (
            <p className="rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200">
              Formatting changed (colors, highlights, or links). Review before accepting.
            </p>
          )}
          {stale && (
            <p className="rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200">
              That text changed while Claude was working, so this can&apos;t be applied. Retry to edit the new text.
            </p>
          )}
          <div className="flex gap-1.5 text-xs">
            <button type="button" disabled={stale} onClick={accept} className="rounded bg-[color:var(--accent)] px-2.5 py-1 font-medium text-white disabled:opacity-40">
              Accept <kbd className="opacity-70">↵</kbd>
            </button>
            <button type="button" onClick={reject} className="rounded border border-line-strong px-2.5 py-1 text-ink hover:bg-surface-3">
              Reject <kbd className="opacity-70">Esc</kbd>
            </button>
            <button
              type="button"
              onClick={() => last && void ask(last.instruction, last.voice, last.promptId)}
              className="rounded border border-line-strong px-2.5 py-1 text-ink hover:bg-surface-3"
            >
              Retry
            </button>
          </div>
        </>
      )}
      <AgentInput
        scope="inline"
        mentions={false}
        busy={busy}
        autoFocus
        placeholder={result ? "Refine: shorter, keep the second sentence…" : original ? "What should change?" : "What should Claude write here?"}
        onSubmit={onSubmit}
      />
    </div>
  );
}

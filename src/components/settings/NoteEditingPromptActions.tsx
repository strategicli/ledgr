// Actions for the seeded "Note Editing Partner" prompt (ADR-162), shown in the
// Live editing context settings section when the feature is on: open the
// editable prompt item, or revert its text to the repo-canonical default. Kept
// as its own small client component so SettingsForm doesn't grow more state.
"use client";

import { useState } from "react";

export default function NoteEditingPromptActions() {
  const [busy, setBusy] = useState<null | "open" | "revert">(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function open() {
    setBusy("open");
    setMsg(null);
    try {
      const res = await fetch("/api/active-context/prompt");
      if (!res.ok) throw new Error();
      const { id } = (await res.json()) as { id: string };
      window.location.href = `/items/${id}`;
    } catch {
      setMsg("Couldn't open the prompt. Try again.");
      setBusy(null);
    }
  }

  async function revert() {
    setBusy("revert");
    setMsg(null);
    try {
      const res = await fetch("/api/active-context/prompt", { method: "POST" });
      if (!res.ok) throw new Error();
      setMsg("Reverted to the default prompt.");
    } catch {
      setMsg("Couldn't revert. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy !== null}
        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy === "open" ? "Opening…" : "Open the prompt"}
      </button>
      <button
        type="button"
        onClick={() => void revert()}
        disabled={busy !== null}
        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy === "revert" ? "Reverting…" : "Revert to default"}
      </button>
      {msg && <span className="text-xs text-neutral-500">{msg}</span>}
    </div>
  );
}

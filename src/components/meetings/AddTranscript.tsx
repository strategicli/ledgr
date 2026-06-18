// Paste a transcript onto a meeting (meeting recording v1a, ADR-087). The
// primary v1a capture path: transcribe locally (Apple Voice Memos & friends do
// it free), paste the text here, save. Collapsed by default so it doesn't crowd
// the panel; expands to an optional name + a paste box. On save it POSTs to
// /api/meetings/[id]/transcripts (which writes the child + the meeting edge),
// then refreshes so the new transcript shows in the list to open and edit.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AddTranscript({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  function reset() {
    setTitle("");
    setText("");
    setState("idle");
    setOpen(false);
  }

  async function submit() {
    if (!text.trim()) {
      reset();
      return;
    }
    setState("busy");
    try {
      const res = await fetch(`/api/meetings/${meetingId}/transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || undefined, text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      reset();
      router.refresh();
    } catch {
      setState("error");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
      >
        + Paste a transcript
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={state === "busy"}
        placeholder="Name (optional, e.g. Session 1)"
        className="w-full max-w-sm rounded border border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") reset();
        }}
        disabled={state === "busy"}
        rows={6}
        placeholder="Paste the transcript text here…"
        className="w-full rounded border border-neutral-700 bg-transparent px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={state === "busy"}
          className="rounded bg-neutral-200 px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {state === "busy" ? "Saving…" : "Save transcript"}
        </button>
        <button
          onClick={reset}
          disabled={state === "busy"}
          className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
        >
          Cancel
        </button>
        {state === "error" && (
          <span className="text-xs text-red-400">Save failed, try again</span>
        )}
      </div>
    </div>
  );
}

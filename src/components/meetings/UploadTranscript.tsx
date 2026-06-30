// Upload a text transcript file onto a meeting (meeting recording v1a, ADR-087).
// Recording/transcription apps hand back the transcript as a .txt; this is the
// paste path (AddTranscript) minus the highlight-thousands-of-words copy/paste.
// The file never needs to be stored: we read its text in the browser and POST
// the same {title, text} to /api/meetings/[id]/transcripts (which writes the
// child + the meeting edge), so the text lands exactly where a pasted transcript
// would — editable, searchable, exportable. The filename (sans extension) seeds
// the transcript name. Compact button; mirrors AudioUpload's placement/style.
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "busy" | "error";

// Filename → a sensible transcript name: drop the extension, tidy separators.
function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return base || "Transcript";
}

export default function UploadTranscript({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setPhase("busy");
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("that file looks empty");

      const res = await fetch(`/api/meetings/${meetingId}/transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleFromFilename(file.name), text }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `upload rejected (${res.status})`);
      }
      setPhase("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
      setPhase("error");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.text,.md,.markdown,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={phase === "busy"}
        className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-50"
      >
        {phase === "busy" ? "Uploading…" : "↑ Upload a transcript file"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

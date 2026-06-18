// Upload audio/video to a meeting to auto-transcribe it (meeting recording v1b,
// ADR-088). The upload IS the intent — no separate "transcribe" button. Reuses
// the presigned-upload handshake (POST /api/attachments → PUT to R2, bytes never
// proxy the app server), then POSTs /api/meetings/[id]/transcribe to create the
// transcript child + submit the audio. Only rendered when transcription is
// configured (getTranscription() != null on the server).
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "uploading" | "starting" | "error";

export default function AudioUpload({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setPhase("uploading");
    try {
      // 1. Presign + create the attachment row.
      const presign = await fetch("/api/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: meetingId,
          filename: file.name || "recording",
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      if (!presign.ok) {
        const d = await presign.json().catch(() => null);
        throw new Error(d?.error ?? `upload rejected (${presign.status})`);
      }
      const { uploadUrl, id: attachmentId } = await presign.json();

      // 2. Bytes straight to R2.
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`storage upload failed (${put.status})`);

      // 3. Create the transcript child + submit for transcription.
      setPhase("starting");
      const start = await fetch(`/api/meetings/${meetingId}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId }),
      });
      if (!start.ok) {
        const d = await start.json().catch(() => null);
        throw new Error(d?.error ?? `could not start transcription (${start.status})`);
      }
      setPhase("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
      setPhase("error");
    }
  }

  const busy = phase === "uploading" || phase === "starting";

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-50"
      >
        {phase === "uploading"
          ? "Uploading…"
          : phase === "starting"
            ? "Starting transcription…"
            : "↑ Upload audio to transcribe"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

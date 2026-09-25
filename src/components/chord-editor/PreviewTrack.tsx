// The song's preview track: one audio file attached to the song and pointed at
// by properties.previewAudio (src/lib/preview-audio.ts). It plays here on the
// canvas and above the chart on the song's share page, so a shared song carries
// the chords and a recording of it together. Upload reuses the presigned
// handshake (POST /api/attachments → PUT straight to R2); the parent persists
// the pointer through its autosave as a per-key propertyPatch. Replacing or
// removing the track deletes the old file so it doesn't linger in storage.
"use client";

import { useRef, useState } from "react";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { attachmentUrl } from "@/lib/attachment-url";

type Props = {
  itemId: string;
  trackId: string | null;
  onChange: (id: string | null) => void;
};

const BUTTON =
  "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-40";

async function deleteAttachment(id: string) {
  const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`could not delete the file (${res.status})`);
}

export default function PreviewTrack({ itemId, trackId, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const type = file.type || "audio/mpeg";
      const presign = await fetch("/api/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, filename: file.name || "track", contentType: type, sizeBytes: file.size }),
      });
      if (!presign.ok) {
        const d = await presign.json().catch(() => null);
        throw new Error(d?.error ?? `upload rejected (${presign.status})`);
      }
      const { uploadUrl, id } = await presign.json();
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": type }, body: file });
      if (!put.ok) throw new Error(`storage upload failed (${put.status})`);
      const previous = trackId;
      onChange(id);
      // Best-effort: the new track is already in place, so a failed cleanup of
      // the old file is not worth an error (it still shows under the item's files).
      if (previous) void deleteAttachment(previous).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-6 pt-3">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <span className="group relative cursor-help text-xs text-neutral-500">
        <span className="underline decoration-neutral-600 decoration-dotted underline-offset-2">Preview track</span>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs normal-case text-neutral-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          A recording of the song. It plays here and above the chart on the song&apos;s share link, so whoever you
          share it with gets the chords and the music together.
        </span>
      </span>
      {trackId ? (
        <>
          <audio controls preload="metadata" src={attachmentUrl(trackId)} className="h-8 min-w-0 flex-1 basis-64" />
          <button onClick={() => inputRef.current?.click()} disabled={busy} className={BUTTON}>
            {busy ? "Uploading…" : "Replace"}
          </button>
          <ConfirmButton
            title="Remove the preview track?"
            description="The audio file is deleted and the share link stops playing it."
            confirmLabel="Remove"
            align="right"
            trigger="Remove"
            triggerClassName={BUTTON}
            disabled={busy}
            onConfirm={async () => {
              await deleteAttachment(trackId);
              onChange(null);
            }}
          />
        </>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={busy} className={BUTTON}>
          {busy ? "Uploading…" : "Add audio file"}
        </button>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

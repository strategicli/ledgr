// The presigned-upload handshake (PRD §3.4), shared by every browser surface
// that adds a file to an item: a metadata row + URL from our API, the bytes
// PUT straight to R2 (they never proxy through the app server), the stable
// /files/<id> address back. Any file type — callers decide what to do with the
// address (embed an image, insert a link, or nothing when the panel lists it).
// Extracted from ItemEditor (2026-08-29) so the editor, the file canvas, and
// the Files card all ride one implementation.
"use client";

import { showToast } from "@/components/ui/ActionToast";

export type UploadedAttachment = {
  id: string;
  filename: string;
  // The stable /files/<id> address (ADR-228) — what belongs in a body.
  fileUrl: string;
};

export async function uploadAttachment(
  itemId: string,
  file: File
): Promise<UploadedAttachment> {
  const res = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId,
      filename:
        file.name ||
        (file.type.startsWith("image/") ? "pasted-image.png" : "pasted-file"),
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `upload rejected (${res.status})`);
  }
  const { id, filename, uploadUrl, fileUrl, usage } = await res.json();
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`storage upload failed (${put.status})`);
  // The storage warning (ADR-231) rides the upload response; until 2026-08-29
  // the UI dropped it on the floor. Fired after the PUT so it can't outrank a
  // failure.
  if (usage?.message) showToast(usage.message);
  return { id, filename, fileUrl };
}

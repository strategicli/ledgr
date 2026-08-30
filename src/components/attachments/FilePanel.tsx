// The item's files, as a panel (Files as a first-class citizen, ADR-236): one
// row per attachment — filename opens the file in a new tab (/files/<id>; HTML
// and PDFs render, everything else downloads), a Share button copies a public
// link gated by the item's share token, and Remove deletes it (ConfirmButton,
// the project standard). "+ Add file" uploads through the shared presign
// handshake. One component serves both homes: the `file` type's canvas
// (FileCanvas) and the Files record card (WidgetCanvas), so the two can't
// drift — the LinkList/MilestoneList pattern.
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachmentUrl, attachmentUrlWithShare } from "@/lib/attachment-url";
import { showToast } from "@/components/ui/ActionToast";
import {
  announceAttachmentRemoved,
  uploadAttachment,
  FILE_DRAG_MIME,
  type FileDragPayload,
} from "@/components/attachments/upload";
import ConfirmButton from "@/components/ui/ConfirmButton";
import NavGlyph from "@/components/nav/NavGlyph";
import { formatBytes } from "@/lib/format-count";

export type FileRow = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  // When present (the per-item Files section): does anything in the parent item
  // still point at this file? false renders the "not linked" chip; absent (the
  // file canvas / Files card, where the panel itself is the home) shows none.
  referenced?: boolean;
};


// Mint-or-reuse the ITEM's share token, then compose the file's public address
// (ADR-231: a token is scoped to the attachment's parent item, so when the item
// is the file — the `file` type — sharing the file and sharing the item are the
// same act; on a many-file item the same token opens its siblings too).
async function copyFileShareLink(itemId: string, attachmentId: string) {
  const listed = await fetch(`/api/items/${itemId}/share`);
  if (!listed.ok) throw new Error("couldn't read share links");
  const tokens: { token: string; revokedAt: string | null }[] =
    (await listed.json()).tokens ?? [];
  let token = tokens.find((t) => !t.revokedAt)?.token;
  if (!token) {
    const created = await fetch(`/api/items/${itemId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!created.ok) throw new Error("couldn't create a share link");
    token = (await created.json()).token as string;
  }
  await navigator.clipboard.writeText(
    `${window.location.origin}${attachmentUrlWithShare(attachmentId, token)}`
  );
}

export default function FilePanel({
  itemId,
  initial,
}: {
  itemId: string;
  initial: FileRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<FileRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = async (files: File[]) => {
    setBusy(true);
    try {
      for (const file of files) {
        const up = await uploadAttachment(itemId, file);
        setRows((prev) => [
          ...prev,
          {
            id: up.id,
            filename: up.filename,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
        ]);
      }
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`delete failed (${res.status})`);
    setRows((prev) => prev.filter((r) => r.id !== id));
    announceAttachmentRemoved({ itemId, id });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="text-sm text-ink-subtle">No files yet.</p>
      )}
      <ul className="flex flex-col gap-1">
        {rows.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-sm">
            <NavGlyph icon="document" size={14} className="shrink-0 text-ink-subtle" />
            <a
              href={attachmentUrl(f.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${f.filename} in a new tab — or drag it into the body to link it there`}
              className="truncate text-ink hover:text-[var(--accent)]"
              draggable
              // Dragging the row into the editor links the EXISTING file (the
              // editor reads FILE_DRAG_MIME); the text/plain fallback pastes
              // the markdown link anywhere else.
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  FILE_DRAG_MIME,
                  JSON.stringify({ id: f.id, filename: f.filename } satisfies FileDragPayload)
                );
                e.dataTransfer.setData(
                  "text/plain",
                  `[${f.filename.replace(/([[\]])/g, "\\$1")}](${attachmentUrl(f.id)})`
                );
              }}
            >
              {f.filename}
            </a>
            <span className="shrink-0 text-xs text-ink-faint">{formatBytes(f.sizeBytes)}</span>
            {f.referenced === false && (
              <span
                title="Nothing in this item's body or fields points at this file anymore. Copy link puts it back; it counts against your storage either way."
                className="shrink-0 cursor-help rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-ink-subtle"
              >
                not linked
              </span>
            )}
            {/* Always visible, not hover-revealed: hover-only actions never show
                on touch and hid Delete from the first real user (Tyler,
                2026-08-29) — "scope the UI" (Brandon, 2026-06-21). */}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="Copy a markdown link to this file — paste it anywhere in a body"
                className="rounded px-1.5 py-0.5 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink"
                onClick={() =>
                  navigator.clipboard
                    .writeText(`[${f.filename.replace(/([[\]])/g, "\\$1")}](${attachmentUrl(f.id)})`)
                    .then(() => showToast("Markdown link copied — paste it into a body"))
                    .catch(() => showToast("Couldn't copy the link"))
                }
              >
                Copy link
              </button>
              <button
                type="button"
                title="Copy a public link to this file (anyone with the link can open it — it also unlocks this item's share page and its other files)"
                className="rounded px-1.5 py-0.5 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink"
                onClick={() =>
                  copyFileShareLink(itemId, f.id)
                    .then(() => showToast("Public file link copied"))
                    .catch(() => showToast("Couldn't copy a share link"))
                }
              >
                Share
              </button>
              <ConfirmButton
                title="Delete this file?"
                description="Deletes it from storage for good — links to it stop working."
                confirmLabel="Delete"
                trigger={<span aria-hidden>Delete</span>}
                triggerLabel={`Delete ${f.filename}`}
                triggerClassName="rounded px-1.5 py-0.5 text-xs text-ink-subtle hover:bg-surface-2 hover:text-red-400"
                align="right"
                onConfirm={() => remove(f.id)}
              />
            </span>
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="text-left text-sm text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
        >
          {busy ? "Uploading…" : "+ Add file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void add(files);
          }}
        />
      </div>
    </div>
  );
}

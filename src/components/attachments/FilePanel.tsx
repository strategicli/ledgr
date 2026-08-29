// The item's files, as a panel (Files as a first-class citizen, ADR-232): one
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
import { uploadAttachment } from "@/components/attachments/upload";
import ConfirmButton from "@/components/ui/ConfirmButton";
import NavGlyph from "@/components/nav/NavGlyph";

export type FileRow = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="text-sm text-ink-subtle">No files yet.</p>
      )}
      <ul className="flex flex-col gap-1">
        {rows.map((f) => (
          <li key={f.id} className="group flex items-center gap-2 text-sm">
            <NavGlyph icon="document" size={14} className="shrink-0 text-ink-subtle" />
            <a
              href={attachmentUrl(f.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${f.filename} in a new tab`}
              className="truncate text-ink hover:text-[var(--accent)]"
            >
              {f.filename}
            </a>
            <span className="shrink-0 text-xs text-ink-faint">{fmtBytes(f.sizeBytes)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="Copy a public link to this file (anyone with the link can open it — it also unlocks this item's share page and its other files)"
                className="rounded px-1.5 py-0.5 text-xs text-ink-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                onClick={() =>
                  copyFileShareLink(itemId, f.id)
                    .then(() => showToast("Public file link copied"))
                    .catch(() => showToast("Couldn't copy a share link"))
                }
              >
                Share
              </button>
              <ConfirmButton
                title="Remove this file?"
                description="Deletes it from storage for good — links to it stop working."
                confirmLabel="Remove"
                trigger={<span aria-hidden>✕</span>}
                triggerLabel={`Remove ${f.filename}`}
                triggerClassName="rounded px-1.5 py-0.5 text-xs text-ink-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
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

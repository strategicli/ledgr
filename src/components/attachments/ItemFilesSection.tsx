// The per-item Files section (ADR-233 addendum 2/3): a collapsible
// canvas-section like Export & sharing and Version History, rendered ONLY when
// the item actually has files. Client-side and event-fed, because the footer
// is server-rendered and an editor upload doesn't refresh the route — without
// this, a first upload's Files section only appeared after a reload (Tyler,
// 2026-08-29). uploadAttachment announces adds; FilePanel announces removes;
// this listens and keeps the list (and the summary count) live.
"use client";

import { useEffect, useState } from "react";
import FilePanel, { type FileRow } from "@/components/attachments/FilePanel";
import {
  ATTACHMENT_ADDED_EVENT,
  ATTACHMENT_REMOVED_EVENT,
  type AttachmentAddedDetail,
  type AttachmentRemovedDetail,
} from "@/components/attachments/upload";

export default function ItemFilesSection({
  itemId,
  initial,
  bare = false,
}: {
  itemId: string;
  initial: FileRow[];
  // The arrange-grid "Files" card (MarkdownCanvas): the card frame already
  // provides the header and placement, so render just the live panel — always,
  // even empty, since the owner placed the card deliberately and its empty
  // state carries the "+ Add file" affordance.
  bare?: boolean;
}) {
  const [rows, setRows] = useState<FileRow[]>(initial);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const d = (e as CustomEvent<AttachmentAddedDetail>).detail;
      if (d.itemId !== itemId) return;
      setRows((prev) =>
        prev.some((r) => r.id === d.id)
          ? prev
          : [
              ...prev,
              {
                id: d.id,
                filename: d.filename,
                contentType: d.contentType,
                sizeBytes: d.sizeBytes,
                // Freshly uploaded — whether the body links it isn't knowable
                // client-side, so no chip until the next server render.
                referenced: undefined,
              },
            ]
      );
    };
    const onRemove = (e: Event) => {
      const d = (e as CustomEvent<AttachmentRemovedDetail>).detail;
      if (d.itemId !== itemId) return;
      setRows((prev) => prev.filter((r) => r.id !== d.id));
    };
    window.addEventListener(ATTACHMENT_ADDED_EVENT, onAdd as EventListener);
    window.addEventListener(ATTACHMENT_REMOVED_EVENT, onRemove as EventListener);
    return () => {
      window.removeEventListener(ATTACHMENT_ADDED_EVENT, onAdd as EventListener);
      window.removeEventListener(ATTACHMENT_REMOVED_EVENT, onRemove as EventListener);
    };
  }, [itemId]);

  if (bare) {
    return (
      <FilePanel
        key={rows.map((r) => r.id).join(",")}
        itemId={itemId}
        initial={rows}
      />
    );
  }
  if (rows.length === 0) return null;
  return (
    <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
      <details className="canvas-section">
        {/* Same summary shape as Discover related: label + the count chip. */}
        <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--cs-label)] hover:text-neutral-300">
          <span>Files</span>
          <span className="canvas-section-count">{rows.length}</span>
        </summary>
        <div className="mt-2">
          {/* Keyed on the row set so an event-driven change re-seeds FilePanel's
              own optimistic state instead of fighting it. */}
          <FilePanel key={rows.map((r) => r.id).join(",")} itemId={itemId} initial={rows} />
        </div>
      </details>
    </div>
  );
}

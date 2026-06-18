// Title + body editing with debounced autosave against PATCH /api/items/:id.
// The editing core the item canvas (PRD §4.13) wraps with modal chrome and
// field zones; kept free of layout opinions for that reason. The body is
// canonical markdown (ADR-037/ADR-040): the markdown editor reads the body's
// text and emits markdown on every edit, which we wrap back into the
// { format, text } shape the API and DB store.
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { beginSave, endSave } from "@/lib/save-status";
import LazyMarkdownEditor from "./LazyMarkdownEditor";
import type { PromotedRefs } from "./block-anchor-extension";

const SAVE_DEBOUNCE_MS = 1500;

// Presigned-upload flow (PRD §3.4): a metadata row + URL from our API, the
// bytes straight to R2, the public CDN URL back into the markdown. Re-wired for
// the Tiptap canvas after the M3 cutover dropped BlockNote's file blocks.
async function uploadImage(itemId: string, file: File): Promise<string> {
  const res = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId,
      filename: file.name || "pasted-image.png",
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `upload rejected (${res.status})`);
  }
  const { uploadUrl, publicUrl } = await res.json();
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`storage upload failed (${put.status})`);
  return publicUrl;
}

export type ItemEditorProps = {
  item: { id: string; title: string; body: unknown };
  // Canvas top strip (PRD §4.13), rendered between the title and the body.
  fields?: React.ReactNode;
  // Which block to render (ADR-069 field-level canvas cards). "full" is the
  // classic stacked editor (title + fields + body). "title"/"body" render just
  // that block, bare (no canvas chrome), so each can live in its own grid card;
  // each instance keeps its own debounced autosave for the field it owns.
  slot?: "full" | "title" | "body";
  // When this item is a meeting (ADR-090): enable the body editor's per-line
  // "→ task" promote affordance, posting to this meeting's promote endpoint.
  promoteToMeetingId?: string;
  // blockRef → promoted task (ADR-090), so already-promoted lines show a badge.
  promotedRefs?: PromotedRefs;
};

export default function ItemEditor({
  item,
  fields,
  slot = "full",
  promoteToMeetingId,
  promotedRefs,
}: ItemEditorProps) {
  const [title, setTitle] = useState(item.title);
  const pending = useRef<{ title?: string; body?: unknown }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    if (Object.keys(patch).length === 0 || inFlight.current) return;
    pending.current = {};
    inFlight.current = true;
    // Report to the app-wide save signal (the floating SaveStatusIndicator);
    // the per-editor "Saved" badge was retired for it (Brandon, 2026-06-17).
    beginSave();
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
    } catch {
      // Re-queue what failed under anything newer, retry on the next tick.
      pending.current = { ...patch, ...pending.current };
      endSave(false);
    } finally {
      inFlight.current = false;
      if (Object.keys(pending.current).length) schedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Title wraps and grows with content (Brandon, 2026-06-17): keep the textarea's
  // height matched to its content after every edit, so a long title shows in full
  // instead of scrolling in one line.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // A tab close inside the debounce window shouldn't lose the last edit.
  useEffect(() => {
    const onHide = () => {
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      // keepalive lets the PATCH outlive the page (sendBeacon is POST-only).
      void fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [item.id]);

  // Closing the canvas modal (or any client-side nav away) unmounts the
  // editor; edits still inside the debounce window must not be lost.
  useEffect(() => {
    return () => {
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      void fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      });
    };
  }, [item.id]);

  const titleInput = (
    <textarea
      ref={titleRef}
      rows={1}
      className="w-full resize-none overflow-hidden bg-transparent text-3xl font-bold leading-tight text-neutral-100 outline-none placeholder:text-neutral-600"
      placeholder="Untitled"
      value={title}
      onChange={(e) => {
        setTitle(e.target.value);
        pending.current.title = e.target.value;
        schedule();
      }}
      // A title is one logical line that wraps; Enter commits (blurs) rather than
      // inserting a newline.
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
  const bodyEditor = (
    <LazyMarkdownEditor
      itemId={item.id}
      initialMarkdown={bodyMarkdown(item.body)}
      uploadImage={(file) => uploadImage(item.id, file)}
      onChange={(markdown) => {
        pending.current.body = makeMarkdownBody(markdown);
        schedule();
      }}
      promoteToMeetingId={promoteToMeetingId}
      promotedRefs={promotedRefs}
      // The promote flow flushes the body save first, so the line's ^id anchor
      // is persisted before the task is created and the page refreshes.
      onRequestSave={flush}
    />
  );

  // Field-level cards (ADR-069): render just the title or just the body, bare,
  // so each sits in its own grid cell with its own autosave.
  if (slot === "title") return titleInput;
  if (slot === "body") return bodyEditor;

  // Classic stacked editor (the default canvas, unchanged).
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="px-12 pt-8 pb-2">{titleInput}</div>
      {fields}
      <div className="px-12 pt-2">{bodyEditor}</div>
    </div>
  );
}

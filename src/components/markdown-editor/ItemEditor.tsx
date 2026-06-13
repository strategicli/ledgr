// Title + body editing with debounced autosave against PATCH /api/items/:id.
// The editing core the item canvas (PRD §4.13) wraps with modal chrome and
// field zones; kept free of layout opinions for that reason. The body is
// canonical markdown (ADR-037/ADR-040): the markdown editor reads the body's
// text and emits markdown on every edit, which we wrap back into the
// { format, text } shape the API and DB store.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import LazyMarkdownEditor from "./LazyMarkdownEditor";

const SAVE_DEBOUNCE_MS = 1500;

type SaveState = "saved" | "dirty" | "saving" | "error";

export type ItemEditorProps = {
  item: { id: string; title: string; body: unknown };
  // Canvas top strip (PRD §4.13), rendered between the title and the body.
  fields?: React.ReactNode;
};

export default function ItemEditor({ item, fields }: ItemEditorProps) {
  const [title, setTitle] = useState(item.title);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const pending = useRef<{ title?: string; body?: unknown }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    if (Object.keys(patch).length === 0 || inFlight.current) return;
    pending.current = {};
    inFlight.current = true;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Edits made while the request was out stay queued; pick them up.
      setSaveState(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch {
      // Re-queue what failed under anything newer, retry on the next tick.
      pending.current = { ...patch, ...pending.current };
      setSaveState("error");
    } finally {
      inFlight.current = false;
      if (Object.keys(pending.current).length) schedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const schedule = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

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

  const statusLabel = {
    saved: "Saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    error: "Save failed, retrying",
  }[saveState];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-baseline justify-between px-12 pt-8 pb-2">
        <input
          className="w-full bg-transparent text-3xl font-bold text-neutral-100 outline-none placeholder:text-neutral-600"
          placeholder="Untitled"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            pending.current.title = e.target.value;
            schedule();
          }}
        />
        <span
          className={`shrink-0 pl-4 text-xs ${
            saveState === "error" ? "text-red-400" : "text-neutral-500"
          }`}
        >
          {statusLabel}
        </span>
      </div>
      {fields}
      <div className="px-12 pt-2">
        <LazyMarkdownEditor
          itemId={item.id}
          initialMarkdown={bodyMarkdown(item.body)}
          onChange={(markdown) => {
            pending.current.body = makeMarkdownBody(markdown);
            schedule();
          }}
        />
      </div>
    </div>
  );
}

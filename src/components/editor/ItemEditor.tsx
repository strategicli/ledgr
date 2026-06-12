// Title + body editing with debounced autosave against PATCH /api/items/:id.
// This is the editing core the item canvas (PRD §4.13, its own slice) will
// wrap with the modal chrome and field zones; kept free of layout opinions
// for that reason.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LazyEditor from "./LazyEditor";

const SAVE_DEBOUNCE_MS = 1500;

type SaveState = "saved" | "dirty" | "saving" | "error";

export type ItemEditorProps = {
  item: { id: string; title: string; body: unknown };
};

export default function ItemEditor({ item }: ItemEditorProps) {
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
          className="w-full bg-transparent text-3xl font-bold outline-none placeholder:text-gray-300"
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
            saveState === "error" ? "text-red-500" : "text-gray-400"
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <LazyEditor
        itemId={item.id}
        initialBody={item.body}
        onBodyChange={(document) => {
          pending.current.body = document;
          schedule();
        }}
      />
    </div>
  );
}

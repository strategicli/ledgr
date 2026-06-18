// The promote-to-task popup (ADR-090). Opened when a checkbox line's "→ task"
// button is clicked: pre-filled with the line's text as the title and its
// sub-bullets as the body, both editable, so promotion is "confirm + tweak" not
// "fill a form." Submitting hands the values back to the editor host, which
// persists the line's anchor, POSTs the promotion, and refreshes. A small
// centered modal (matches the app's other lightweight dialogs).
"use client";

import { useEffect, useRef, useState } from "react";

export type PromoteDraft = { title: string; body: string };

export default function PromoteLinePopup({
  initialTitle,
  initialBody,
  onSubmit,
  onCancel,
}: {
  initialTitle: string;
  initialBody: string;
  onSubmit: (draft: PromoteDraft) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // Esc closes anywhere in the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    if (busy) return;
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    onSubmit({ title: t, body: body.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[18vh]"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Promote to task
        </h2>
        <label className="mt-3 block text-xs text-neutral-500">Task</label>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className="mt-1 w-full rounded border border-neutral-700 bg-transparent px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          placeholder="Task title"
        />
        <label className="mt-3 block text-xs text-neutral-500">
          Details{" "}
          <span className="text-neutral-600">(pulled from sub-bullets, editable)</span>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="mt-1 w-full resize-y rounded border border-neutral-700 bg-transparent px-2 py-1.5 text-sm text-neutral-300 focus:border-neutral-500 focus:outline-none"
          placeholder="Optional details for the task"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !title.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Create task
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline subtask capture (Notion-default: add in place, don't navigate
// away). Click reveals an input; Enter creates the task and keeps the input
// open for rapid entry; Escape or an empty blur closes it.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AddSubtask({ parentId }: { parentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setOpen(false);
      return;
    }
    setState("busy");
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task", parentId, title: trimmed }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setTitle("");
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
      >
        + Add subtask
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!title.trim() && state !== "busy") setOpen(false);
        }}
        disabled={state === "busy"}
        placeholder="Subtask title, Enter to add"
        className="w-full max-w-sm rounded border border-neutral-700 bg-transparent px-2 py-0.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />
      {state === "error" && (
        <span className="text-xs text-red-400">Failed, Enter to retry</span>
      )}
    </div>
  );
}

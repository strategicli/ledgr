"use client";

// Minimal create input, shared by the desktop Work screens. Creates an item of
// `type` through the seam (POST /api/items → on desktop, IPC → @/lib → PGlite;
// on cloud, fetch → the route). Calls onCreated so the list reloads. ADR-139.
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";

export default function QuickAddItem({
  type,
  placeholder = "Add…",
  onCreated,
}: {
  type: string;
  placeholder?: string;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await apiRequest("/api/items", { method: "POST", body: { type, title: t } });
      setTitle("");
      onCreated?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex gap-2">
      <input
        className="flex-1 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-1.5 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        value={title}
        placeholder={placeholder}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void add();
        }}
      />
      <button
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        onClick={() => void add()}
        disabled={busy || !title.trim()}
      >
        Add
      </button>
    </div>
  );
}

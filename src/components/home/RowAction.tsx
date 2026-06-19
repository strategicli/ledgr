// Trash / restore button for a list row; refreshes the server-rendered list
// on success so the row moves between sections.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ACTIONS = {
  trash: { label: "Trash", method: "DELETE", path: (id: string) => `/api/items/${id}` },
  restore: { label: "Restore", method: "POST", path: (id: string) => `/api/items/${id}/restore` },
} as const;

export default function RowAction({
  id,
  action,
}: {
  id: string;
  action: keyof typeof ACTIONS;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const { label, method, path } = ACTIONS[action];

  async function run() {
    setState("busy");
    try {
      const res = await fetch(path(id), { method });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={run}
      disabled={state === "busy"}
      // Hover-reveal on desktop, always visible on phones (no hover on touch,
      // so an invisible trash/restore would be unreachable). Soft-delete makes
      // an accidental tap recoverable from Trash.
      className="rounded px-2 py-0.5 text-xs text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-50"
    >
      {state === "error" ? "Failed, retry?" : label}
    </button>
  );
}

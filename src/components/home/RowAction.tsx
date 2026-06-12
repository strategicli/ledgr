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
      className="rounded px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
    >
      {state === "error" ? "Failed, retry?" : label}
    </button>
  );
}

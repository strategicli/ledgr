// Creates an empty item of the given type, then jumps into its editor.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewItemButton({ type }: { type: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function create() {
    setState("busy");
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { item } = await res.json();
      router.push(`/items/${item.id}`);
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={create}
      disabled={state === "busy"}
      className="rounded px-2 py-0.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
    >
      {state === "error" ? "Failed, retry?" : "+ New"}
    </button>
  );
}

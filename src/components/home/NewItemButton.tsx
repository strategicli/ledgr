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
      // The list page stays mounted under the intercepting modal, so this
      // button never remounts on its own — reset it here, or it stays
      // disabled ("busy") and a second "+ New" does nothing until a refresh.
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={create}
      disabled={state === "busy"}
      className="rounded px-2 py-0.5 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
    >
      {state === "error" ? "Failed, retry?" : "+ New"}
    </button>
  );
}
